const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // Serve static files from current directory

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// Instagram video downloader endpoint
app.post('/api/download', async (req, res) => {
    try {
          const { url } = req.body;

      if (!url) {
              return res.status(400).json({
                        success: false,
                        error: 'Instagram URL is required'
              });
      }

      // Validate Instagram URL
      if (!url.includes('instagram.com')) {
              return res.status(400).json({
                        success: false,
                        error: 'Invalid Instagram URL'
              });
      }

      // Extract shortcode from URL
      const shortcode = extractShortcode(url);

      if (!shortcode) {
              return res.status(400).json({
                        success: false,
                        error: 'Could not extract video ID from URL'
              });
      }

      // Method 1: Try direct Instagram embed endpoint
      try {
              const embedUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
              const response = await axios.get(embedUrl, {
                        headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                                    'Accept-Language': 'en-US,en;q=0.5',
                                    'Referer': 'https://www.instagram.com/',
                                    'X-Requested-With': 'XMLHttpRequest'
                        },
                        timeout: 10000
              });

            if (response.data && response.data.items) {
                      const item = response.data.items[0];
                      const videoUrl = item.video_versions?.[0]?.url || item.carousel_media?.[0]?.video_versions?.[0]?.url;

                if (videoUrl) {
                            return res.json({
                                          success: true,
                                          videoUrl: videoUrl,
                                          thumbnail: item.image_versions2?.candidates?.[0]?.url,
                                          username: item.user?.username,
                                          caption: item.caption?.text
                            });
                }
            }
      } catch (embedError) {
              console.log('Embed method failed, trying alternative...');
      }

      // Method 2: Use oEmbed API (public endpoint)
      try {
              const oembedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
              const oembedResponse = await axios.get(oembedUrl, {
                        headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        timeout: 10000
              });

            // Parse the HTML response for video URL
            const html = oembedResponse.data;
              const videoMatch = html.match(/"video_url":"([^"]+)"/);

            if (videoMatch && videoMatch[1]) {
                      const videoUrl = videoMatch[1].replace(/\\u0026/g, '&');
                      return res.json({
                                  success: true,
                                  videoUrl: videoUrl
                      });
            }
      } catch (oembedError) {
              console.log('oEmbed method failed');
      }

      // If all methods fail, return helpful error
      return res.status(503).json({
              success: false,
              error: 'Unable to download video at this time',
              message: 'This tool requires an API key for reliable downloads. Contact the developer for setup.',
              needsApiKey: true
      });

    } catch (error) {
          console.error('Download error:', error.message);
          res.status(500).json({
                  success: false,
                  error: 'Failed to download video',
                  details: error.message
          });
    }
});

// Helper function to extract shortcode from Instagram URL
function extractShortcode(url) {
    const patterns = [
          /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
          /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
          /instagram\.com\/tv\/([A-Za-z0-9_-]+)/
        ];

  for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
                return match[1];
        }
  }
    return null;
}

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
