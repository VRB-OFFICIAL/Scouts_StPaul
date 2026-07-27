// ------------------------------------------------------------------
// Firebase configuration
// ------------------------------------------------------------------
// Replace the values below with the config object from YOUR Firebase
// project (Project settings -> General -> Your apps -> Web app -> SDK
// setup and configuration -> Config).
//
// It is normal and safe for this apiKey/config to be public in a
// client-side web app hosted on GitHub Pages. Firebase apps are NOT
// secured by hiding this file — they are secured by the Database
// Rules (see database.rules.json) and by requiring users to be
// signed in (this app signs everyone in anonymously). Do not rely on
// this file being secret.
// ------------------------------------------------------------------

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
