/* =========================================================
   GeoTrack Pro – Firebase Configuration
   public/firebase-config.js

   HOW TO SET UP (takes ~5 minutes):

   1. Go to https://console.firebase.google.com
   2. Click "Add project" → name it (e.g. "geotrack-pro") → Continue
   3. Disable Google Analytics → Create project
   4. Click "Build" → "Realtime Database" → "Create database"
   5. Choose a location (e.g. us-central1) → "Start in test mode" → Enable
   6. Go to Project Settings (gear icon ⚙) → "Your apps" → click </> (web)
   7. Register app name → copy the firebaseConfig object
   8. Paste those values below, replacing each "REPLACE_ME" string
   9. In Realtime Database → Rules tab → paste these rules and Publish:
      {
        "rules": {
          "devices": {
            "$deviceId": {
              ".read":  true,
              ".write": "$deviceId === auth.uid || auth === null"
            }
          }
        }
      }
      (For the assignment, test mode allows open read/write for 30 days.)
   ========================================================= */

const FIREBASE_CONFIG = {
  apiKey:            "REPLACE_ME",           // e.g. "AIzaSyABC123..."
  authDomain:        "REPLACE_ME",           // e.g. "my-project.firebaseapp.com"
  databaseURL:       "REPLACE_ME",           // e.g. "https://my-project-default-rtdb.firebaseio.com"
  projectId:         "REPLACE_ME",           // e.g. "my-project"
  storageBucket:     "REPLACE_ME",           // e.g. "my-project.appspot.com"
  messagingSenderId: "REPLACE_ME",           // e.g. "123456789"
  appId:             "REPLACE_ME"            // e.g. "1:123:web:abc..."
};

// ---- Detect whether Firebase has been configured ----
const FIREBASE_READY = Object.values(FIREBASE_CONFIG).every(v => v !== "REPLACE_ME");

// ---- Expose globally for app.js ----
window.FIREBASE_CONFIG = FIREBASE_CONFIG;
window.FIREBASE_READY  = FIREBASE_READY;

if (!FIREBASE_READY) {
  console.warn(
    '[GeoTrack] Firebase is not configured. ' +
    'Open public/firebase-config.js and fill in your project values. ' +
    'All features except multi-device sharing will still work.'
  );
}
