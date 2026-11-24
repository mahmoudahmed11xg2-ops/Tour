/**
 * TourGuide — Firebase Project Configuration
 *
 * Replace all YOUR_FIREBASE_* placeholders below with the Web App
 * configuration from your new Firebase Console project:
 *   Firebase Console -> Project Settings -> Your apps -> SDK setup and configuration
 */

export const firebaseConfig = {
  apiKey: "AIzaSyBNFWIV3QFvPdOsf4-4o0Db5zmC8L9hyiM",
  authDomain: "tour-9cbd0.firebaseapp.com",
  projectId: "tour-9cbd0",
  storageBucket: "tour-9cbd0.firebasestorage.app",
  messagingSenderId: "294571131800",
  appId: "1:294571131800:web:c0732e6d4eb7118d2a21ed",
  measurementId: "G-Z2WXFYR2NS"
};

/**
 * Verify whether valid Firebase credentials have been provided.
 * Prevents network calls against placeholder values before setup.
 */
export function isFirebaseConfigured() {
  const requiredKeys = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId'
  ];
  return requiredKeys.every((key) => {
    const val = firebaseConfig[key];
    return typeof val === 'string' && val.trim().length > 0 && !val.includes('YOUR_FIREBASE_');
  });
}
