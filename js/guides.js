/**
 * TourGuide — Guides Service Module
 * Directly connects to Cloud Firestore 'guides' & 'reviews' collections.
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
  addDoc,
  query,
  where
} from 'firebase/firestore';

/**
 * Fetch guides from Firestore with marketplace filters
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
      if (filters.verifiedOnly && (guide.verificationStatus !== 'approved' || guide.verified === false)) {
        return false;
      }

      // City / Service area filter
      if (filters.city && filters.city !== 'all') {
        const target = filters.city.trim().toLowerCase();
        const cityMatch = guide.city && guide.city.toLowerCase().includes(target);
        const areaMatch = Array.isArray(guide.serviceAreas) && guide.serviceAreas.some(a => a.toLowerCase().includes(target));
        const locMatch = guide.currentLocationName && guide.currentLocationName.toLowerCase().includes(target);
        if (!cityMatch && !areaMatch && !locMatch) {
          return false;
        }
      }

      // Language filter
      if (filters.language && filters.language !== 'all') {
        const targetLang = filters.language.trim().toLowerCase();
        if (!Array.isArray(guide.languages) || !guide.languages.some(l => l.toLowerCase() === targetLang)) {
          return false;
        }
      }

      // Specialty category filter
      if (filters.specialty && filters.specialty !== 'all') {
        const targetSpec = filters.specialty.trim().toLowerCase();
        if (!Array.isArray(guide.specialties) || !guide.specialties.some(s => s.toLowerCase() === targetSpec)) {
          return false;
        }
      }

      // Online instant request filter
      if (filters.onlineOnly && (!guide.isOnline || guide.instantAvailable === false)) {
        return false;
      }

      // Max price filter
      if (filters.maxPrice && Number(filters.maxPrice) > 0 && Number(guide.hourlyRate || 0) > Number(filters.maxPrice)) {
        return false;
      }

      // Min rating filter
      if (filters.minRating && Number(filters.minRating) > 0 && Number(guide.rating || 0) < Number(filters.minRating)) {
        return false;
      }

      // Max distance filter
      if (filters.maxDistance && Number(filters.maxDistance) > 0 && Number(guide.distanceKm || 5) > Number(filters.maxDistance)) {
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
  if (!guideId) return null;
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
      isOnline: Boolean(isOnline),
      updatedAt: new Date().toISOString()
    });
    return Boolean(isOnline);
  } catch (err) {
    handleFirestoreError(err, 'update', `${COLLECTIONS.GUIDES}/${guideId}`);
    return !isOnline;
  }
}

/**
 * Update Guide weekly schedule, blocked dates & instant toggle
 */
export async function updateGuideAvailabilitySchedule(guideId, { weeklyAvailability, blockedDates, instantAvailable }) {
  try {
    const guideRef = doc(db, COLLECTIONS.GUIDES, guideId);
    const updates = {
      updatedAt: new Date().toISOString()
    };
    if (weeklyAvailability !== undefined) updates.weeklyAvailability = weeklyAvailability;
    if (blockedDates !== undefined) updates.blockedDates = blockedDates;
    if (instantAvailable !== undefined) updates.instantAvailable = Boolean(instantAvailable);

    await updateDoc(guideRef, updates);
    return true;
  } catch (err) {
    handleFirestoreError(err, 'update', `${COLLECTIONS.GUIDES}/${guideId}`);
    return false;
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

/**
 * Fetch real verified reviews for a guide from Firestore 'reviews' collection
 */
export async function getGuideReviews(guideId) {
  if (!guideId) return [];
  try {
    const q = query(
      collection(db, COLLECTIONS.REVIEWS),
      where('guideId', '==', guideId)
    );
    const snap = await getDocs(q);
    const reviews = [];
    snap.forEach(d => reviews.push({ id: d.id, ...d.data() }));
    reviews.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return reviews;
  } catch (err) {
    console.warn('Error fetching guide reviews:', err.message);
    return [];
  }
}

/**
 * Submit a real tourist review after a completed booking
 */
export async function submitReview({ bookingId, guideId, touristId, touristName, rating, comment }) {
  const numRating = Math.max(1, Math.min(5, Number(rating) || 5));
  const reviewId = `REV-${bookingId}`;
  const reviewDoc = {
    id: reviewId,
    bookingId,
    guideId,
    touristId,
    touristName: touristName || 'Traveler',
    rating: numRating,
    comment: String(comment || '').trim(),
    createdAt: new Date().toISOString()
  };

  try {
    await setDoc(doc(db, COLLECTIONS.REVIEWS, reviewId), reviewDoc);
    await updateDoc(doc(db, COLLECTIONS.BOOKINGS, bookingId), {
      reviewed: true,
      reviewRating: numRating,
      updatedAt: new Date().toISOString()
    });
    return reviewDoc;
  } catch (err) {
    handleFirestoreError(err, 'create', `${COLLECTIONS.REVIEWS}/${reviewId}`);
    return null;
  }
}
