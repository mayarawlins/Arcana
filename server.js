require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { TwitterApi } = require('twitter-api-v2');
const Filter = require('bad-words');
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

// Initialize profanity filter
const filter = new Filter();
filter.addWords('specific', 'words', 'to', 'add'); // Add any additional words

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.static('public')); // Serve static files from public directory

// In-memory stores (for demo purposes - consider using a database for production)
const confessionsDB = [];
const commentsDB = {};
const likesDB = {};
const bookmarksDB = {};

// Generate a simple user UUID for session
function generateUserUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Moderation helper
function moderateContent(text) {
  if (filter.isProfane(text)) {
    return {
      isClean: false,
      cleanText: null,
      badWords: filter.listBadWords(text).map(match => match.word)
    };
  }
  return { isClean: true, cleanText: text, badWords: [] };
}

// Routes
app.post('/api/confess', async (req, res) => {
  try {
    const { text, tags = [] } = req.body;
    
    // Moderation check
    const moderationResult = moderateContent(text);
    if (!moderationResult.isClean) {
      return res.status(400).json({ 
        error: 'Content contains prohibited language',
        badWords: moderationResult.badWords
      });
    }

    if (!text || text.length > 280) {
      return res.status(400).json({ error: 'Confession must be 1-280 characters' });
    }

    // Post to Twitter
    const tweet = await twitterClient.v2.tweet(text);
    
    // Store confession internally
    const confession = {
      id: tweet.data.id,
      text: tweet.data.text,
      created_at: new Date().toISOString(),
      twitterData: tweet.data,
      tags: tags.filter(tag => tag).map(tag => tag.replace(/^#+/, ''))
    };
    confessionsDB.push(confession);

    res.json({
      success: true,
      id: tweet.data.id,
      text: tweet.data.text,
      created_at: confession.created_at,
      tags: confession.tags
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
    // Use cache if available and not stale (5 minutes)
    if (Date.now() - lastFetchTime < 300000 && cachedTweets.length > 0) {
      return res.json(cachedTweets);
    }

    // Fetch from Twitter
    const timeline = await twitterClient.v2.userTimeline(
      process.env.TWITTER_USER_ID,
      { 
        max_results: 20,
        'tweet.fields': ['created_at']
      }
    );

    cachedTweets = timeline.data.data || [];
    lastFetchTime = Date.now();

    // Combine with local data
    const enhancedTweets = cachedTweets.map(tweet => {
      const localData = confessionsDB.find(c => c.id === tweet.id);
      return {
        ...tweet,
        tags: localData?.tags || []
      };
    });

    res.json(enhancedTweets);
  } catch (error) {
    console.error("Twitter API Error:", error);
    // Return cached data if available, even if stale
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
    res.json({
      success: true,
      newCount: likesDB[confessionId].size,
      isLiked: false
    });
  } else {
    likesDB[confessionId].add(userUUID);
    res.json({
      success: true,
      newCount: likesDB[confessionId].size,
      isLiked: true
    });
  }
});

app.get('/api/likes/:confessionId', (req, res) => {
  const userUUID = req.query.userUUID;
  const confessionId = req.params.confessionId;
  
  const likeSet = likesDB[confessionId] || new Set();
  res.json({
    count: likeSet.size,
    isLiked: userUUID ? likeSet.has(userUUID) : false
  });
});

// Comments endpoints
app.post('/api/comment', (req, res) => {
  const { confessionId, userUUID, text } = req.body;
  
  // Moderation check
  const moderationResult = moderateContent(text);
  if (!moderationResult.isClean) {
    return res.status(400).json({ 
      error: 'Comment contains prohibited language',
      badWords: moderationResult.badWords
    });
  }

  if (!commentsDB[confessionId]) {
    commentsDB[confessionId] = [];
  }
  
  const comment = {
    userUUID,
    text,
    timestamp: new Date().toISOString()
  };
  
  commentsDB[confessionId].push(comment);
  res.json({ success: true });
});

app.get('/api/comments/:confessionId', (req, res) => {
  res.json(commentsDB[req.params.confessionId] || []);
});

app.get('/api/comments/count/:confessionId', (req, res) => {
  res.json({
    count: commentsDB[req.params.confessionId]?.length || 0
  });
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

// User session endpoint
app.post('/api/session', (req, res) => {
  const userUUID = generateUserUUID();
  res.json({ userUUID });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export the Express app for Vercel
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;