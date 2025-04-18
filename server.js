require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { TwitterApi } = require('twitter-api-v2');
const Filter = require('bad-words');
const admin = require('firebase-admin');

// Initialize Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Initialize Twitter client
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET
});

// Initialize profanity filter
const filter = new Filter();
filter.addWords('specific', 'words', 'to', 'add');

const app = express();
const PORT = process.env.PORT || 3000;
let cachedTweets = [];
let lastFetchTime = 0;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static('public'));

// Authentication middleware
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
};

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
app.post('/api/confess', authenticate, async (req, res) => {
  try {
    const { text, tags = [] } = req.body;
    const userId = req.user.uid;
    
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
    
    // Store confession in Firestore
    const confession = {
      id: tweet.data.id,
      text: tweet.data.text,
      userId,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      twitterData: tweet.data,
      tags: tags.filter(tag => tag).map(tag => tag.replace(/^#+/, '')),
      likeCount: 0
    };

    await db.collection('confessions').doc(tweet.data.id).set(confession);

    res.json({
      success: true,
      id: tweet.data.id,
      text: tweet.data.text,
      created_at: new Date().toISOString(),
      tags: confession.tags
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ 
      error: 'Failed to post confession',
      details: error.message
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

    // Get additional data from Firestore
    const confessionsSnapshot = await db.collection('confessions').get();
    const firestoreConfessions = {};
    confessionsSnapshot.forEach(doc => {
      firestoreConfessions[doc.id] = doc.data();
    });

    // Combine data
    const enhancedTweets = cachedTweets.map(tweet => {
      const firestoreData = firestoreConfessions[tweet.id] || {};
      return {
        ...tweet,
        tags: firestoreData.tags || [],
        likeCount: firestoreData.likeCount || 0
      };
    });

    res.json(enhancedTweets);
  } catch (error) {
    console.error("Error:", error);
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
app.post('/api/like', authenticate, async (req, res) => {
  try {
    const { confessionId } = req.body;
    const userId = req.user.uid;

    const likeRef = db.collection('likes').doc(`${confessionId}_${userId}`);
    const confessionRef = db.collection('confessions').doc(confessionId);
    
    const likeDoc = await likeRef.get();
    
    if (likeDoc.exists) {
      await likeRef.delete();
      await confessionRef.update({
        likeCount: admin.firestore.FieldValue.increment(-1)
      });
      res.json({
        success: true,
        newCount: (await confessionRef.get()).data().likeCount,
        isLiked: false
      });
    } else {
      await likeRef.set({
        confessionId,
        userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      await confessionRef.update({
        likeCount: admin.firestore.FieldValue.increment(1)
      });
      res.json({
        success: true,
        newCount: (await confessionRef.get()).data().likeCount,
        isLiked: true
      });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to update like' });
  }
});

app.get('/api/likes/:confessionId', authenticate, async (req, res) => {
  try {
    const { confessionId } = req.params;
    const userId = req.user.uid;

    const likeRef = db.collection('likes').doc(`${confessionId}_${userId}`);
    const confessionRef = db.collection('confessions').doc(confessionId);
    
    const [likeDoc, confessionDoc] = await Promise.all([
      likeRef.get(),
      confessionRef.get()
    ]);

    res.json({
      count: confessionDoc.exists ? (confessionDoc.data().likeCount || 0) : 0,
      isLiked: likeDoc.exists
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to get like status' });
  }
});

// Comments endpoints
app.post('/api/comment', authenticate, async (req, res) => {
  try {
    const { confessionId, text } = req.body;
    const userId = req.user.uid;
    
    // Moderation check
    const moderationResult = moderateContent(text);
    if (!moderationResult.isClean) {
      return res.status(400).json({ 
        error: 'Comment contains prohibited language',
        badWords: moderationResult.badWords
      });
    }

    const comment = {
      userId,
      text,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection('comments').doc().set({
      ...comment,
      confessionId
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

app.get('/api/comments/:confessionId', async (req, res) => {
  try {
    const { confessionId } = req.params;
    
    const snapshot = await db.collection('comments')
      .where('confessionId', '==', confessionId)
      .orderBy('timestamp', 'desc')
      .get();
    
    const comments = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp.toDate().toISOString()
    }));

    res.json(comments);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Bookmarks endpoints
app.post('/api/bookmark', authenticate, async (req, res) => {
  try {
    const { confessionId } = req.body;
    const userId = req.user.uid;
    
    const bookmarkRef = db.collection('bookmarks').doc(`${confessionId}_${userId}`);
    const bookmarkDoc = await bookmarkRef.get();
    
    if (bookmarkDoc.exists) {
      await bookmarkRef.delete();
      res.json({ isBookmarked: false });
    } else {
      await bookmarkRef.set({
        confessionId,
        userId,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ isBookmarked: true });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to update bookmark' });
  }
});

app.get('/api/bookmarks/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (userId !== req.user.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const snapshot = await db.collection('bookmarks')
      .where('userId', '==', userId)
      .get();
    
    const bookmarks = snapshot.docs.map(doc => doc.data().confessionId);
    
    res.json(bookmarks);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
});

// User session endpoint
app.post('/api/session', (req, res) => {
  res.json({ 
    userUUID: 'deprecated', // Not needed with Firebase Auth
    message: 'Use Firebase Authentication instead' 
  });
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