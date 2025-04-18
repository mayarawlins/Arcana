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
const profanityFilter = new Filter();
// Add custom words if needed
profanityFilter.addWords('specific', 'slurs', 'you', 'want', 'to', 'add');

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.static('public'));

// In-memory stores
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

// Content moderation function
function moderateContent(text) {
  if (profanityFilter.isProfane(text)) {
    return {
      isClean: false,
      cleanText: null,
      badWords: profanityFilter.listBadWords(text)
    };
  }
  return {
    isClean: true,
    cleanText: text,
    badWords: []
  };
}

// Routes
app.post('/api/confess', async (req, res) => {
  try {
    const { text, tags = [] } = req.body;
    
    // Content moderation
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

// [Keep all other existing routes the same, but add moderation to the comment endpoint]

app.post('/api/comment', (req, res) => {
  const { confessionId, userUUID, text } = req.body;
  
  // Content moderation
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

// [Keep all other existing routes exactly the same]

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export the Express app for Vercel
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;