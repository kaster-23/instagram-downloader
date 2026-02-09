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

            // API returns: { success, message, data: { url, medias: [{ url, type, quality, ... }], thumbnail, ... } }
            if (response.data && response.data.success && response.data.data) {
                          const videoData = response.data.data;

                        // Find the video media from the medias array
                        let videoUrl = null;
                          if (videoData.medias && videoData.medias.length > 0) {
                                          const videoMedia = videoData.medias.find(m => m.type === 'video');
                                          if (videoMedia) {
                                                            videoUrl = videoMedia.url;
                                          }
                          }

                        if (videoUrl) {
                                        return res.json({
                                                          success: true,
                                                          videoUrl: videoUrl,
                                                          thumbnail: videoData.thumbnail,
                                                          username: videoData.author || videoData.owner?.username,
                                                          caption: videoData.title
                                        });
                        } else {
                                        return res.status(503).json({
                                                          success: false,
                                                          error: 'No video found in the response',
                                                          message: 'The API did not return a video download URL'
                                        });
                        }
            } else {
                          return res.status(503).json({
                                          success: false,
                                          error: 'Unable to download video at this time',
                                          message: 'The API did not return valid data'
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
