require('dotenv').config();
const express = require('express');
const { TwitterApi } = require('twitter-api-v2');
const app = express();
const PORT = 3000;

// Initialize Twitter client
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET
});
// Add this middleware to server.js
app.use((req, res, next) => {
    // Skip auth check for login/signup pages
    if (req.path === '/login.html' || req.path === '/signup.html') {
      return next();
    }
    
    // For API routes, check Authorization header
    if (req.path.startsWith('/api')) {
      const authHeader = req.headers['authorization'];
      if (!authHeader || authHeader !== 'Bearer '+process.env.API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    next();
  });

app.use(express.json());

// Post confession to your Twitter
app.post('/api/confess', async (req, res) => {
  try {
    const { text } = req.body;
    const tweet = await twitterClient.v2.tweet(text);
    res.json({ success: true, id: tweet.data.id });
  } catch (error) {
    console.error("Twitter error:", error);
    res.status(500).json({ error: 'Failed to post confession' });
  }
});

// Get confessions from your Twitter
app.get('/api/confessions', async (req, res) => {
  try {
    const timeline = await twitterClient.v2.userTimeline('arcanaconfess', {
      max_results: 20,
      'tweet.fields': ['created_at']
    });
    res.json(timeline.data.data || []);
  } catch (error) {
    console.error("Twitter error:", error);
    res.status(500).json({ error: 'Failed to fetch confessions' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));