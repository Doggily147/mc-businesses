// Firebase configuration
// Get this from: https://console.firebase.google.com → your project → Project Settings → "Your apps" → Web app
// (See README.md → "Firebase setup" for the 5-minute walkthrough)
//
// These values are SAFE to commit publicly — Firebase web config is meant to be in browser code.
// Security comes from Firestore Security Rules (see README), NOT from hiding these keys.
window.FIREBASE_CONFIG = {
    apiKey:            "YOUR_API_KEY",
    authDomain:        "YOUR_PROJECT.firebaseapp.com",
    databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId:         "YOUR_PROJECT",
    storageBucket:     "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId:             "YOUR_APP_ID"
};

// Initialize once (compat SDK)
if (window.firebase && window.FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY") {
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    window.fbAuth = firebase.auth();
    window.fbDb = firebase.firestore();
    window.FIREBASE_READY = true;
} else {
    window.FIREBASE_READY = false;
    console.warn("[firebase-config] Not configured yet. Auth + cloud data disabled. " +
        "Edit firebase-config.js with your project keys.");
}
