// auth.js - Common authentication functions
function checkAuth() {
    return localStorage.getItem('isLoggedIn') === 'true';
  }
  
  function getCurrentUser() {
    return localStorage.getItem('username');
  }
  
  function requireAuth() {
    if (!checkAuth()) {
      window.location.href = 'login.html';
    }
  }
  
  export { checkAuth, getCurrentUser, requireAuth };