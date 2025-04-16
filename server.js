// Add these to your existing server.js (replace the entire file)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { TwitterApi } = require('twitter-api-v2');
const app = express();
const PORT = process.env.PORT || 3000;
let cachedTweets = [];
let lastFetchTime = 0;

// Initialize Twitter client
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET
});

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// In-memory stores
const confessionsDB = [];
const commentsDB = {};
const likesDB = {};
const bookmarksDB = {};
const usersDB = {}; // Store usernames and UIDs

// Generate ghost username
function generateGhostName() {
  const adjectives = ['Ghost', 'Phantom', 'Shadow', 'Spirit', 'Specter', 'Wraith'];
  const numbers = Math.floor(100 + Math.random() * 900);
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${numbers}`;
}

// Routes
app.post('/api/confess', async (req, res) => {
  try {
    const { text, tags = [] } = req.body; // Add tags
        
    // Include tags in the tweet
    const tweetText = tags.length > 0 
      ? `${text}\n\n${tags.map(t => `#${t}`).join(' ')}`
      : text;

    const tweet = await twitterClient.v2.tweet(tweetText);
    
    const confession = {
      id: tweet.data.id,
      text: tweet.data.text,
      created_at: new Date().toISOString(),
      tags, // Store tags
      twitterData: tweet.data
    };
    confessionsDB.push(confession);

    res.json({
      success: true,
      id: tweet.data.id,
      text: tweet.data.text,
      tags, // Return tags
      created_at: confession.created_at
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
    if (Date.now() - lastFetchTime < 300000 && cachedTweets.length > 0) {
      return res.json(cachedTweets.map(tweet => ({
        ...tweet,
        likes: likesDB[tweet.id]?.size || 0,
        comments: commentsDB[tweet.id]?.length || 0
      })));
    }

    const timeline = await twitterClient.v2.userTimeline(
      process.env.TWITTER_USER_ID,
      { 
        max_results: 20,
        'tweet.fields': ['created_at']
      }
    );

    cachedTweets = timeline.data.data || [];
    lastFetchTime = Date.now();

    const enhancedTweets = cachedTweets.map(tweet => {
      const localData = confessionsDB.find(c => c.id === tweet.id);
      return {
        ...tweet,
        tags: localData?.tags || [],
        likes: likesDB[tweet.id]?.size || 0,
        comments: commentsDB[tweet.id]?.length || 0,
        userUUID: localData?.userUUID
      };
    });

    res.json(enhancedTweets);
  } catch (error) {
    console.error("Twitter API Error:", error);
    if (cachedTweets.length > 0) {
      res.json(cachedTweets);
    } else {
      res.status(500).json({ 
        error: "Failed to fetch confessions",
        details: error.message 
      });
    }
  }
});

// Likes endpoints
app.post('/api/like', (req, res) => {
  const { confessionId, userUUID } = req.body;
  
  if (!likesDB[confessionId]) {
    likesDB[confessionId] = new Set();
  }
  
  if (likesDB[confessionId].has(userUUID)) {
    likesDB[confessionId].delete(userUUID);
  } else {
    likesDB[confessionId].add(userUUID);
  }
  
  res.json({
    success: true,
    count: likesDB[confessionId].size
  });
});

app.get('/api/likes/:confessionId', (req, res) => {
  res.json({
    count: likesDB[req.params.confessionId]?.size || 0
  });
});

// Comments endpoints
app.post('/api/comment', (req, res) => {
  const { confessionId, userUUID, text } = req.body;
  
  if (!commentsDB[confessionId]) {
    commentsDB[confessionId] = [];
  }
  
  const comment = {
    userUUID,
    text,
    timestamp: new Date().toISOString(),
    username: usersDB[userUUID] || 'Ghost'
  };
  
  commentsDB[confessionId].push(comment);
  res.json({ success: true });
});

app.get('/api/comments/:confessionId', (req, res) => {
  res.json(commentsDB[req.params.confessionId] || []);
});

// Bookmarks endpoints
app.post('/api/bookmark', (req, res) => {
  const { confessionId, userUUID } = req.body;
  
  if (!bookmarksDB[userUUID]) {
    bookmarksDB[userUUID] = new Set();
  }
  
  if (bookmarksDB[userUUID].has(confessionId)) {
    bookmarksDB[userUUID].delete(confessionId);
    res.json({ isBookmarked: false });
  } else {
    bookmarksDB[userUUID].add(confessionId);
    res.json({ isBookmarked: true });
  }
});

app.get('/api/bookmarks/:userUUID', (req, res) => {
  const userUUID = req.params.userUUID;
  const bookmarks = bookmarksDB[userUUID] ? Array.from(bookmarksDB[userUUID]) : [];
  res.json(bookmarks);
});

// User endpoints
app.post('/api/session', (req, res) => {
  const userUUID = 'user-' + Math.random().toString(36).substring(2, 15);
  const ghostName = generateGhostName();
  usersDB[userUUID] = ghostName;
  res.json({ userUUID, ghostName });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});