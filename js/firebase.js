// ============================================================================
// UB3 — Firebase initialization
// Uses the Firebase v10 modular SDK loaded directly from the CDN, so this
// project needs NO build step and NO npm install — it deploys as-is on
// Vercel, GitHub Pages, Netlify, or any static host.
//
// SETUP (required before the site will work):
// 1. Go to https://console.firebase.google.com and create a project (e.g. "ub3-platform").
// 2. In Project settings > General > Your apps, add a "Web app" and copy the
//    firebaseConfig object it gives you into FIREBASE_CONFIG below.
// 3. Enable Authentication > Sign-in method > Email/Password.
// 4. Create a Firestore database (production mode) and deploy firestore.rules
//    (included in this project) via the Firebase console or CLI:
//        firebase deploy --only firestore:rules
// 5. Enable Storage if you want leaders to upload real profile photos.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ---- REPLACE WITH YOUR OWN PROJECT CONFIG ---------------------------------
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
// -----------------------------------------------------------------------------

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Keep leaders logged in across visits/tabs.
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Auth persistence could not be set:", err.message);
});

// ----------------------------------------------------------------------------
// Firestore collections used across this project (created automatically the
// first time a document is written to them — no manual setup needed):
//
//   leaders/{uid}        -> { name, email, position, department, bio,
//                              phone, photoURL, socials: {x, telegram},
//                              securityQuestion, updatedAt }
//
//   messages/{autoId}     -> { toLeaderId, fromName, fromEmail, subject,
//                              body, read, createdAt }
//
//   notifications/{autoId}-> { leaderId, type, text, read, createdAt }
// ----------------------------------------------------------------------------
