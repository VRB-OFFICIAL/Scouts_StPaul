// ------------------------------------------------------------------
// Firebase configuration — Scouts-StPaul
// ------------------------------------------------------------------
// It is normal and safe for this apiKey/config to be public in a
// client-side web app hosted on GitHub Pages. Firebase apps are NOT
// secured by hiding this file — they are secured by the Firestore
// Rules (see firestore.rules) and by requiring users to be
// signed in (this app signs everyone in anonymously). Do not rely on
// this file being secret.
// ------------------------------------------------------------------

const firebaseConfig = {
  apiKey: "AIzaSyBMUCPt7XLgJRwrjGnS1g4miCZUtFce4-Y",
  authDomain: "scouts-stpaul.firebaseapp.com",
  projectId: "scouts-stpaul",
  storageBucket: "scouts-stpaul.firebasestorage.app",
  messagingSenderId: "4457333750",
  appId: "1:4457333750:web:5ef6911eecfcb76aedbdd7"
};

firebase.initializeApp(firebaseConfig);
