// Initialize Firebase
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase and Firestore
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Generate or retrieve anonymous user ID
function getUserId() {
  let userId = localStorage.getItem("anonymousUserId");
  if (!userId) {
    userId = "user" + Math.random().toString(36).substr(2, 8);
    localStorage.setItem("anonymousUserId", userId);
  }
  return userId;
}

// Toggle like status
async function toggleLike(confessionId) {
  const userId = getUserId();
  const likesRef = db.collection("likes").doc(confessionId);

  const doc = await likesRef.get();
  const likers = doc.exists ? doc.data().users : [];

  if (likers.includes(userId)) {
    await likesRef.update({ users: firebase.firestore.FieldValue.arrayRemove(userId) });
  } else {
    await likesRef.update({ users: firebase.firestore.FieldValue.arrayUnion(userId) });
  }
  return await updateLikeCount(confessionId); // Return updated count
}

// Fetch like count for a confession
async function updateLikeCount(confessionId) {
  const doc = await db.collection("likes").doc(confessionId).get();
  return doc.exists ? doc.data().users.length : 0;
}

// Initialize all like buttons on page load
async function initLikes() {
  const confessionCards = document.querySelectorAll(".tweet-card");
  confessionCards.forEach(async (card) => {
    const confessionId = card.dataset.id;
    const likeCountElement = card.querySelector(".like-count");
    likeCountElement.textContent = await updateLikeCount(confessionId);
  });
}

// Make functions available globally
window.firebaseLikes = {
  toggleLike,
  initLikes
};