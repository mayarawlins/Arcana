require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { TwitterApi } = require('twitter-api-v2');
const app = express();
const PORT = 3000;
let cachedTweets = [];
let lastFetchTime = 0;

// Initialize Twitter client
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET
});

// Middleware - Updated CORS config
app.use(cors({
    origin: [
      'http://127.0.0.1:5500',  // Your Live Server URL
      'http://localhost:5500'   // Alternative
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
  }));


app.use(express.json());

// Routes
app.post('/api/confess', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.length > 280) {
      return res.status(400).json({ error: 'Confession must be 1-280 characters' });
    }

    const tweet = await twitterClient.v2.tweet(text);
    
    res.json({
      success: true,
      id: tweet.data.id,
      text: tweet.data.text,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Twitter Error:", error);
    res.status(500).json({ 
      error: 'Failed to post confession',
      details: error.errors ? error.errors[0].message : error.message
    });
  }
});

app.get('/api/confessions', async (req, res) => {
    try {
      const timeline = await twitterClient.v2.userTimeline(
        process.env.TWITTER_USER_ID,  // ← Verify this exists!
        { 
          max_results: 20,
          'tweet.fields': ['created_at']
        }
      );
      res.json(timeline.data.data || []);
    } catch (error) {
      console.error("Twitter API Error Details:", {
        message: error.message,
        code: error.code,
        rateLimit: error.rateLimit,  // Check if rate limited
        headers: error.headers       // Inspect Twitter's response
      });
      res.status(500).json({ 
        error: "Failed to fetch confessions",
        details: error.message 
      });
    }
    if (Date.now() - lastFetchTime < 300000) { // 5-minute cache
        return res.json(cachedTweets);
      }
      cachedTweets = timeline.data.data;
      lastFetchTime = Date.now();
  });

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('API Endpoints:');
  console.log(`- POST http://localhost:${PORT}/api/confess`);
  console.log(`- GET http://localhost:${PORT}/api/confessions`);
});