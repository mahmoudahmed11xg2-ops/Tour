/**
 * TourGuide — Real Firebase & Cloud Firestore Infrastructure
 * Initializes Firebase Web SDK with real Authentication & Cloud Firestore.
 */

import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  getDocs,
  getDocFromServer,
  deleteDoc
} from 'firebase/firestore';
import { firebaseConfig, isFirebaseConfigured } from '../firebase-config.js';

export { isFirebaseConfigured };

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Auth & Firestore (uses default database unless a named databaseId is explicitly configured)
export const auth = getAuth(app);
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Initialize Analytics safely when supported
export let analytics = null;
if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
  isAnalyticsSupported()
    .then((supported) => {
      if (supported) analytics = getAnalytics(app);
    })
    .catch(() => {});
}

// Canonical 14 Production Firestore Collections
export const COLLECTIONS = {
  USERS: 'users',
  GUIDES: 'guides',
  TOURISTS: 'tourists',
  BOOKINGS: 'bookings',
  GUIDE_BUSY_SLOTS: 'guideBusySlots',
  PAYMENTS: 'payments',
  PAYOUTS: 'payouts',
  REVIEWS: 'reviews',
  MESSAGES: 'messages',
  NOTIFICATIONS: 'notifications',
  DISPUTES: 'disputes',
  AUDIT_LOGS: 'auditLogs',
  ADMINS: 'admins',
  SETTINGS: 'settings'
};

/**
 * Firestore Helper Abstractions for collection and document operations
 */
export async function getCollectionDocs(collName) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(collection(db, collName));
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return list;
  } catch (err) {
    handleFirestoreError(err, 'list', collName);
    return [];
  }
}

export async function getDocument(collName, docId) {
  if (!isFirebaseConfigured() || !docId) return null;
  try {
    const snap = await getDoc(doc(db, collName, docId));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() };
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, 'get', `${collName}/${docId}`);
    return null;
  }
}

export async function addDocument(collName, data) {
  if (!isFirebaseConfigured()) return null;
  try {
    const docRef = await addDoc(collection(db, collName), data);
    return { id: docRef.id, ...data };
  } catch (err) {
    handleFirestoreError(err, 'create', collName);
    return null;
  }
}

export async function updateDocument(collName, docId, updates) {
  if (!isFirebaseConfigured()) return false;
  try {
    await updateDoc(doc(db, collName, docId), {
      ...updates,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, 'update', `${collName}/${docId}`);
    return false;
  }
}

export async function deleteDocument(collName, docId) {
  if (!isFirebaseConfigured()) return false;
  try {
    await deleteDoc(doc(db, collName, docId));
    return true;
  } catch (err) {
    handleFirestoreError(err, 'delete', `${collName}/${docId}`);
    return false;
  }
}

// Bind convenience helpers to db instance
db.getCollection = getCollectionDocs;
db.getDocument = getDocument;
db.addDocument = addDocument;
db.updateDocument = updateDocument;
db.deleteDocument = deleteDocument;

/**
 * Standard Firestore Error Handler for Diagnostics
 */
export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || false,
      isAnonymous: auth.currentUser?.isAnonymous || false,
      providerInfo: auth.currentUser?.providerData?.map(p => ({
        providerId: p.providerId,
        email: p.email
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(error?.message || 'Database operation failed');
}

/**
 * Validate Connection to Firestore on startup (only when configured)
 */
export async function validateFirestoreConnection() {
  if (!isFirebaseConfigured()) return;
  try {
    await getDocFromServer(doc(db, COLLECTIONS.SETTINGS, 'platform'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore is running in offline mode. Please check connection.');
    }
  }
}

validateFirestoreConnection();
