/**
 * TourGuide — Real Firebase & Cloud Firestore Infrastructure
 * Initializes Firebase Web SDK with real Authentication & Cloud Firestore.
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  addDoc, 
  collection, 
  getDocs, 
  query, 
  where, 
  orderBy,
  getDocFromServer,
  deleteDoc
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Auth & Firestore with specific firestoreDatabaseId
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

/**
 * Firestore Helper Abstractions for robust collection and document operations
 */
export async function getCollectionDocs(collName) {
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
  try {
    const docRef = await addDoc(collection(db, collName), data);
    return { id: docRef.id, ...data };
  } catch (err) {
    handleFirestoreError(err, 'create', collName);
    return null;
  }
}

export async function updateDocument(collName, docId, updates) {
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
  try {
    await deleteDoc(doc(db, collName, docId));
    return true;
  } catch (err) {
    handleFirestoreError(err, 'delete', `${collName}/${docId}`);
    return false;
  }
}

// Bind methods to db instance
db.getCollection = getCollectionDocs;
db.getDocument = getDocument;
db.addDocument = addDocument;
db.updateDocument = updateDocument;
db.deleteDocument = deleteDocument;

// Collection Names Constants
export const COLLECTIONS = {
  USERS: 'users',
  GUIDES: 'guides',
  TOURISTS: 'tourists',
  COMPANIES: 'companies',
  SERVICES: 'services',
  TOURS: 'tours',
  LOCATIONS: 'locations',
  AVAILABILITY: 'availability',
  GUIDE_BUSY_SLOTS: 'guideBusySlots',
  BOOKINGS: 'bookings',
  PAYMENTS: 'payments',
  PAYOUTS: 'payouts',
  REVIEWS: 'reviews',
  MESSAGES: 'messages',
  NOTIFICATIONS: 'notifications',
  DISPUTES: 'disputes',
  AUDIT_LOGS: 'auditLogs',
};

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
  throw new Error(error.message || 'Database operation failed');
}

/**
 * Validate Connection to Firestore on startup
 */
export async function validateFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'users', 'health_check'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore is running in offline mode. Please check connection.');
    }
  }
}

// Auto-run connection check
validateFirestoreConnection();
