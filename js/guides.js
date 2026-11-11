/**
 * TourGuide — Guides Service Module
 * Directly connects to Cloud Firestore 'guides' collection.
 */

import { 
  db, 
  COLLECTIONS, 
  handleFirestoreError 
} from './firebase.js';
import { 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  addDoc 
} from 'firebase/firestore';

/**
 * Fetch guides from Firestore with filtering
 */
export async function fetchGuides(filters = {}) {
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.GUIDES));
    const guides = [];
    snap.forEach(d => {
      guides.push({ id: d.id, ...d.data() });
    });

    return guides.filter(guide => {
      // Verified only for public marketplace
      if (filters.verifiedOnly && guide.verificationStatus !== 'approved') {
        return false;
      }

      // City filter
      if (filters.city && filters.city !== 'all') {
        if (guide.city && guide.city.toLowerCase() !== filters.city.toLowerCase()) {
          return false;
        }
      }

      // Language filter
      if (filters.language && filters.language !== 'all') {
        if (!guide.languages || !guide.languages.some(l => l.toLowerCase() === filters.language.toLowerCase())) {
          return false;
        }
      }

      // Specialty category filter
      if (filters.specialty && filters.specialty !== 'all') {
        if (!guide.specialties || !guide.specialties.includes(filters.specialty)) {
          return false;
        }
      }

      // Online instant request filter
      if (filters.onlineOnly && !guide.isOnline) {
        return false;
      }

      // Max price
      if (filters.maxPrice && guide.hourlyRate > filters.maxPrice) {
        return false;
      }

      return true;
    });
  } catch (err) {
    handleFirestoreError(err, 'list', COLLECTIONS.GUIDES);
    return [];
  }
}

/**
 * Get single guide by ID from Firestore
 */
export async function getGuideById(guideId) {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.GUIDES, guideId));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() };
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, 'get', `${COLLECTIONS.GUIDES}/${guideId}`);
    return null;
  }
}

/**
 * Update Guide Online/Offline status tied to current guide
 */
export async function updateGuideOnlineStatus(guideId, isOnline) {
  try {
    const guideRef = doc(db, COLLECTIONS.GUIDES, guideId);
    await updateDoc(guideRef, { 
      isOnline,
      updatedAt: new Date().toISOString()
    });
    return isOnline;
  } catch (err) {
    handleFirestoreError(err, 'update', `${COLLECTIONS.GUIDES}/${guideId}`);
    return !isOnline;
  }
}

/**
 * Update Guide Verification status (Admin action)
 */
export async function updateGuideVerification(guideId, status, notes = '') {
  try {
    const verified = status === 'approved';
    const guideRef = doc(db, COLLECTIONS.GUIDES, guideId);
    
    await updateDoc(guideRef, {
      verificationStatus: status,
      verified,
      verificationNotes: notes,
      verifiedAt: verified ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString()
    });

    // Write immutable record in auditLogs
    await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
      action: `GUIDE_VERIFICATION_${status.toUpperCase()}`,
      targetId: guideId,
      timestamp: new Date().toISOString(),
      notes
    });

    return true;
  } catch (err) {
    handleFirestoreError(err, 'update', `${COLLECTIONS.GUIDES}/${guideId}`);
    return false;
  }
}
