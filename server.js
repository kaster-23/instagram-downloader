// ============================================================
// server.js — Instagram Video Downloader Backend
// Production-ready Node.js API
// ============================================================

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { JSDOM } from 'jsdom';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(helmet({
  contentSecurityPolicy: false, // Adjust for AdSense
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: '1kb' }));

// Rate limiting: 30 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.' },
});
app.use('/api/', limiter);

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// CORE EXTRACTION LOGIC
// ============================================================

const INSTAGRAM_URL_REGEX = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;

// Rotating User-Agent strings (browser-like)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Validates and normalizes an Instagram URL
 */
function validateUrl(url) {
  const match = url.match(INSTAGRAM_URL_REGEX);
  if (!match) return null;

  const shortcode = match[3];
  const type = match[2]; // p, reel, reels, tv

  // Normalize to canonical form
  const normalized = `https://www.instagram.com/${type}/${shortcode}/`;
  return { url: normalized, shortcode, type };
}

/**
 * Fetches the Instagram page HTML with browser-like headers
 */
async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Instagram returned ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// EXTRACTION STRATEGIES (Fallback chain)
// ============================================================

/**
 * Strategy 1: Embedded JSON (SharedData / additional_data)
 * Instagram embeds media data in script tags as JSON
 */
function extractFromEmbeddedJson(html) {
  const patterns = [
    // window._sharedData
    /window\._sharedData\s*=\s*({.+?});<\/script>/s,
    // window.__additionalDataLoaded
    /window\.__additionalDataLoaded\s*\([^,]*,\s*({.+?})\s*\);<\/script>/s,
    // Require module pattern
    /"video_url"\s*:\s*"(https?:[^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;

    // If direct video_url match
    if (pattern.source.includes('video_url')) {
      const videoUrl = match[1].replace(/\\u0026/g, '&');
      return { videoUrl, method: 'embedded_json_direct' };
    }

    // Parse JSON blob and traverse for video
    try {
      const data = JSON.parse(match[1]);
      const videoUrl = findVideoInObject(data);
      if (videoUrl) {
        return { videoUrl, method: 'embedded_json_parsed' };
      }
    } catch {}
  }

  return null;
}

/**
 * Strategy 2: Open Graph meta tags
 * Instagram includes og:video meta tags
 */
function extractFromOpenGraph(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Try og:video first (most reliable for video content)
  const ogVideo = doc.querySelector('meta[property="og:video"]')
    || doc.querySelector('meta[property="og:video:url"]')
    || doc.querySelector('meta[property="og:video:secure_url"]');

  if (ogVideo?.content) {
    return { videoUrl: ogVideo.content, method: 'opengraph' };
  }

  return null;
}

/**
 * Strategy 3: GraphQL-style media extraction
 * Search for video_url patterns in any script/JSON block
 */
function extractFromGraphQL(html) {
  // Broader regex to find any video URL in the page
  const videoPatterns = [
    /"video_url"\s*:\s*"(https?:[^"]+)"/g,
    /"contentUrl"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/g,
    /video_versions.*?"url"\s*:\s*"(https?:[^"]+)"/g,
  ];

  const candidates = [];

  for (const pattern of videoPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const url = match[1]
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/');
      candidates.push(url);
    }
  }

  if (candidates.length > 0) {
    // Pick the highest quality (longest URL usually = most params = CDN-served)
    const best = candidates.sort((a, b) => b.length - a.length)[0];
    return { videoUrl: best, method: 'graphql_regex' };
  }

  return null;
}

/**
 * Deep-traverse a JSON object to find video_url
 */
function findVideoInObject(obj, depth = 0) {
  if (depth > 15 || !obj || typeof obj !== 'object') return null;

  // Direct video_url property
  if (obj.video_url) return obj.video_url.replace(/\\u0026/g, '&');

  // video_versions array (pick highest quality)
  if (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
    const sorted = obj.video_versions.sort((a, b) => (b.width || 0) - (a.width || 0));
    return sorted[0].url?.replace(/\\u0026/g, '&');
  }

  // Recurse
  const values = Array.isArray(obj) ? obj : Object.values(obj);
  for (const val of values) {
    const found = findVideoInObject(val, depth + 1);
    if (found) return found;
  }

  return null;
}

/**
 * Main extraction pipeline — tries all strategies in order
 */
async function extractVideoUrl(instagramUrl) {
  const html = await fetchPage(instagramUrl);

  const strategies = [
    { name: 'embedded_json', fn: () => extractFromEmbeddedJson(html) },
    { name: 'opengraph', fn: () => extractFromOpenGraph(html) },
    { name: 'graphql', fn: () => extractFromGraphQL(html) },
  ];

  for (const strategy of strategies) {
    try {
      const result = strategy.fn();
      if (result?.videoUrl) {
        console.log(`[extract] Success via ${result.method}: ${instagramUrl}`);
        return result;
      }
    } catch (err) {
      console.warn(`[extract] ${strategy.name} failed:`, err.message);
    }
  }

  throw new Error('Could not extract video. The post may be private, image-only, or Instagram blocked the request.');
}

// ============================================================
// API ROUTES
// ============================================================

/**
 * POST /api/download
 * Body: { url: "https://instagram.com/reel/..." }
 * Returns: { videoUrl, method }
 */
app.post('/api/download', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required.' });
    }

    const validated = validateUrl(url);
    if (!validated) {
      return res.status(400).json({ error: 'Invalid Instagram URL. Supported: posts, reels, IGTV.' });
    }

    const result = await extractVideoUrl(validated.url);

    return res.json({
      videoUrl: result.videoUrl,
      method: result.method,
      shortcode: validated.shortcode,
      type: validated.type,
    });
  } catch (err) {
    console.error('[api/download] Error:', err.message);
    return res.status(422).json({
      error: err.message || 'Failed to extract video. Please try again.',
    });
  }
});

/**
 * GET /api/stream?url=<video_cdn_url>
 * Proxies the video download through the server (avoids CORS issues)
 * Streams the response for memory efficiency
 */
app.get('/api/stream', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url || !url.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid video URL.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const upstream = await fetch(url, {
      headers: {
        'User-Agent': getRandomUA(),
        'Referer': 'https://www.instagram.com/',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Video source unavailable.' });
    }

    // Set download headers
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="savegram-video.mp4"');

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Stream the body
    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    };

    await pump();
  } catch (err) {
    console.error('[api/stream] Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream failed.' });
    }
  }
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Fallback: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 SaveGram API running on http://localhost:${PORT}`);
});
