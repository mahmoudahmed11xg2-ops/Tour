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

// Initial seed data for production guides if collection is empty
const INITIAL_MARKETPLACE_GUIDES = [
  {
    id: 'guide_ahmed_hassan_official',
    name: 'Ahmed Hassan',
    email: 'ahmed.guide@tourguide.com',
    phone: '+20 100 123 4567',
    country: 'Egypt',
    verified: true,
    verificationStatus: 'approved',
    rating: 4.9,
    reviewsCount: 127,
    languages: ['Arabic', 'English', 'German'],
    experienceYears: 8,
    distanceKm: 2.4,
    hourlyRate: 25,
    currency: 'USD',
    city: 'Giza',
    currentLocationName: 'Giza Plateau First Gate',
    isOnline: true,
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
    specialties: ['History', 'Architecture', 'Museum'],
    about: 'Certified Egyptologist and graduate of Faculty of Archaeology, Cairo University. Over 8 years guiding travelers through the pyramids, Sphinx, and the Grand Egyptian Museum with focus on ancient architectural techniques.',
    packages: [
      { id: 'pkg1', title: 'Pyramids of Giza & Sphinx In-Depth', duration: '3 hours', price: 75 },
      { id: 'pkg2', title: 'Grand Egyptian Museum (GEM) Masterpieces', duration: '4 hours', price: 100 }
    ],
    createdAt: new Date().toISOString()
  },
  {
    id: 'guide_sarah_mansour_official',
    name: 'Dr. Sarah Mansour',
    email: 'sarah.mansour@tourguide.com',
    phone: '+20 102 987 6543',
    country: 'Egypt',
    verified: true,
    verificationStatus: 'approved',
    rating: 4.95,
    reviewsCount: 142,
    languages: ['Arabic', 'English', 'French'],
    experienceYears: 11,
    distanceKm: 3.8,
    hourlyRate: 35,
    currency: 'USD',
    city: 'Cairo',
    currentLocationName: 'Tahrir Square / Downtown',
    isOnline: true,
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80',
    specialties: ['Museum', 'History', 'Family'],
    about: 'PhD in Coptic & Islamic Heritage. Passionate about bringing ancient historical inscriptions to life for couples, solo travelers, and families with interactive storytelling.',
    packages: [
      { id: 'pkg3', title: 'Old Cairo: Hanging Church & Coptic Museum', duration: '3.5 hours', price: 110 }
    ],
    createdAt: new Date().toISOString()
  },
  {
    id: 'guide_karim_luxor_official',
    name: 'Karim El-Sayed',
    email: 'karim.luxor@tourguide.com',
    phone: '+20 111 555 4321',
    country: 'Egypt',
    verified: true,
    verificationStatus: 'approved',
    rating: 4.88,
    reviewsCount: 94,
    languages: ['Arabic', 'English', 'Spanish'],
    experienceYears: 6,
    distanceKm: 5.1,
    hourlyRate: 28,
    currency: 'USD',
    city: 'Luxor',
    currentLocationName: 'Karnak Temple',
    isOnline: false,
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
    specialties: ['Desert', 'Local Experience', 'Food'],
    about: 'Specialized in Luxor West Bank royal tombs, temple hieroglyphics, and authentic culinary trails.',
    packages: [
      { id: 'pkg4', title: 'Valley of the Kings & Karnak Expedition', duration: '4 hours', price: 95 }
    ],
    createdAt: new Date().toISOString()
  }
];

/**
 * Seed initial marketplace guides to Firestore if empty
 */
export async function seedInitialGuidesIfEmpty() {
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.GUIDES));
    if (snap.empty) {
      for (const guide of INITIAL_MARKETPLACE_GUIDES) {
        await setDoc(doc(db, COLLECTIONS.GUIDES, guide.id), guide);
      }
    }
  } catch (err) {
    console.warn('Initial guides seed notice:', err.message);
  }
}

// Auto-run connection check & seed
validateFirestoreConnection();
seedInitialGuidesIfEmpty();
