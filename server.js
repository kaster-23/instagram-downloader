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

// Instagram video downloader endpoint using RapidAPI
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

          // Call RapidAPI Instagram Reels Downloader API
          const options = {
                      method: 'GET',
                      url: 'https://instagram-reels-downloader-api.p.rapidapi.com/download',
                      params: { url: url },
                      headers: {
                                    'x-rapidapi-key': process.env.RAPIDAPI_KEY,
                                    'x-rapidapi-host': 'instagram-reels-downloader-api.p.rapidapi.com'
                      }
          };

          const response = await axios.request(options);

          console.log('API Response:', JSON.stringify(response.data));

          // API returns: { success: true, message: "success", data: { url, source, title, author, thumbnail, duration, owner } }
          if (response.data && response.data.success && response.data.data) {
                      const videoData = response.data.data;
                      return res.json({
                                    success: true,
                                    videoUrl: videoData.url,
                                    thumbnail: videoData.thumbnail,
                                    username: videoData.author || videoData.owner?.username,
                                    caption: videoData.title
                      });
          } else {
                      return res.status(503).json({
                                    success: false,
                                    error: 'Unable to download video at this time',
                                    message: 'The API did not return a valid download URL'
                      });
          }

        } catch (error) {
                  console.error('Download error:', error.response?.data || error.message);

          if (error.response?.status === 429) {
                      return res.status(429).json({
                                    success: false,
                                    error: 'Rate limit exceeded',
                                    message: 'Too many requests. Please try again later.'
                      });
          }

          res.status(500).json({
                      success: false,
                      error: 'Failed to download video',
                      details: error.message
          });
        }
});

// Start server
app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
});

module.exports = app;
