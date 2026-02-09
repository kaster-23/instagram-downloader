# SaveGram — Instagram Video Downloader

Production-ready Instagram video/Reel downloader with SEO optimization and AdSense-ready layout.

---

## Architecture

```
┌─────────────────────────────────────┐
│           Static Frontend           │
│  index.html (SSR-friendly, no JS    │
│  framework — pure vanilla for CWV)  │
│                                     │
│  ┌──────────┐  ┌─────────────────┐  │
│  │ URL Input │→│ POST /api/download│ │
│  └──────────┘  └────────┬────────┘  │
│                         │           │
│  ┌──────────────────────▼────────┐  │
│  │  Preview + Save Button        │  │
│  │  (uses /api/stream for proxy) │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│         Node.js Backend (Express)   │
│                                     │
│  POST /api/download                 │
│  ├─ Validate URL (regex)            │
│  ├─ Fetch Instagram page HTML       │
│  └─ Extract video via fallback chain│
│     ├─ 1. Embedded JSON (_sharedData│
│     │     / __additionalDataLoaded) │
│     ├─ 2. OpenGraph meta tags       │
│     └─ 3. GraphQL regex patterns    │
│                                     │
│  GET /api/stream?url=<cdn_url>      │
│  └─ Proxied streaming download      │
│     (avoids CORS, sets headers)     │
│                                     │
│  Middleware:                         │
│  ├─ Helmet (security headers)       │
│  ├─ CORS (configurable origin)      │
│  ├─ Rate Limiter (30 req/min/IP)    │
│  └─ Body parser (1kb limit)         │
└─────────────────────────────────────┘
```

---

## Extraction Logic Explained

Instagram embeds video data in multiple locations within the HTML. The extractor tries three strategies in order:

### Strategy 1: Embedded JSON
Instagram's SSR output includes `window._sharedData` or `window.__additionalDataLoaded` script blocks containing the full post data as JSON. We parse this and recursively search for `video_url` or `video_versions` arrays. This is the most reliable when available.

### Strategy 2: OpenGraph Meta Tags
Instagram sets `<meta property="og:video">` tags for video content. These are simple to extract via DOM parsing (jsdom). Less reliable for Reels but works well for standard video posts.

### Strategy 3: GraphQL Regex
Broad regex scan of the entire HTML for `video_url`, `contentUrl`, and `video_versions` patterns. This catches data embedded in inline GraphQL responses or React hydration payloads. We sort candidates by URL length (longer CDN URLs typically indicate higher quality with more params).

### Quality Selection
When `video_versions` is available, we sort by `width` descending and pick the highest resolution. Otherwise, the first valid video URL found is used.

---

## SEO & AEO Implementation

| Feature | Implementation |
|---------|---------------|
| **Title tag** | Keyword-rich, under 60 chars |
| **Meta description** | Action-oriented, under 155 chars |
| **Canonical URL** | Self-referencing |
| **Open Graph** | Full OG tags for social sharing |
| **Twitter Card** | summary_large_image |
| **Schema: WebApplication** | Signals tool to Google |
| **Schema: HowTo** | Targets featured snippets / AEO |
| **Schema: FAQPage** | Targets People Also Ask / AEO |
| **Semantic HTML** | Proper heading hierarchy, sections, nav |
| **Core Web Vitals** | No framework, minimal CSS, no layout shift |

### AEO (Answer Engine Optimization)
The HowTo and FAQ schemas are specifically designed for AI answer engines (Google SGE, Perplexity, ChatGPT search). The 3-step how-to and FAQ answers are structured to be directly quotable by AI systems.

---

## AdSense Integration

Ad placements are **outside the conversion flow** (not between input and download button):

1. **Top banner** (728×90 leaderboard) — above the hero section
2. **Bottom rectangle** (336×280) — below FAQ section

To activate, replace the placeholder `<div class="ad-slot">` content with your AdSense code:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXX" crossorigin="anonymous"></script>
<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-XXXXXXX" data-ad-slot="XXXXXXX" data-ad-format="auto" data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
```

---

## Deployment

### Quick Start
```bash
npm install
npm start
# → http://localhost:3000
```

### Production (Railway / Render / Fly.io)
```bash
# Set environment variables:
PORT=3000
ALLOWED_ORIGIN=https://yourdomain.com
NODE_ENV=production
```

### File Structure
```
public/
  index.html          ← Frontend (copy index.html here)
server.js             ← Backend API
package.json
```

Move `index.html` into a `public/` folder for Express static serving.

---

## Scaling Notes

### Current Architecture Handles
- **~50-100 concurrent users** on a single $5-10/mo VPS
- Rate limiting prevents abuse (30 req/min/IP)

### To Scale Further

| Bottleneck | Solution |
|-----------|----------|
| Instagram blocks server IP | Add rotating proxy pool (Bright Data, SmartProxy) |
| High traffic | Deploy behind Cloudflare CDN + Workers |
| Extraction reliability | Add headless browser fallback (Puppeteer) for JS-rendered pages |
| Cost | Cache extraction results in Redis (video URLs are valid ~24h) |
| Global latency | Deploy on edge (Cloudflare Workers / Fly.io multi-region) |

### Recommended Stack at Scale
```
Cloudflare CDN → Edge Cache (HTML)
       ↓
  Fly.io / Railway (Node.js API)
       ↓
  Redis (extraction cache, TTL 1h)
       ↓
  Rotating Proxy Pool (for Instagram fetching)
```

---

## Known Limitations

1. **Private accounts**: Cannot access private content (requires authentication, which violates ToS)
2. **Stories**: Not supported (ephemeral, require auth)
3. **Image-only posts**: Returns an error (no video to extract)
4. **Rate limiting by Instagram**: Instagram may block or challenge requests from server IPs. Mitigation: rotating proxies + User-Agent rotation
5. **Carousel posts**: Currently extracts the first video only. Multi-video extraction requires deeper JSON traversal
6. **CDN URL expiry**: Instagram CDN URLs expire after ~24 hours. Downloads must happen promptly
7. **Login walls**: Instagram increasingly requires login to view content. If extraction fails, a headless browser with session cookies may be needed as a future fallback
8. **Legal**: This tool is for personal use. Respect creators' rights and Instagram ToS. Include DMCA takedown process for production deployment
9. **AdSense compliance**: Ensure your site has sufficient original content (FAQ, how-to, blog posts) before applying. Google may reject sites that are purely "tool" pages

---

## Performance Budget

| Metric | Target | How |
|--------|--------|-----|
| FCP | < 1.0s | No framework, inline critical CSS |
| LCP | < 1.5s | Single font load, no hero images |
| CLS | 0 | Fixed layout, no dynamic ad injection above fold |
| TBT | < 50ms | Minimal JS, no hydration |
| TTI | < 1.5s | ~15KB total page weight |

---

## License

MIT — Use freely. Not affiliated with Instagram or Meta.
