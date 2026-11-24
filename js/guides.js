/**
 * TourGuide — Guides Service Module
 * Directly connects to Cloud Firestore 'guides', 'users', and 'reviews' collections.
 */

import {
  auth,
  db,
  COLLECTIONS,
  isFirebaseConfigured,
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
import { sendNotification } from './notifications.js';
import { t } from './utils.js';

/**
 * Fetch guides from Firestore with marketplace filters
 */
export async function fetchGuides(filters = {}) {
  if (!isFirebaseConfigured()) return [];
  try {
    const q = filters.verifiedOnly
      ? query(
          collection(db, COLLECTIONS.GUIDES),
          where('verificationStatus', '==', 'approved')
        )
      : collection(db, COLLECTIONS.GUIDES);
    const snap = await getDocs(q);
    const guides = [];
    snap.forEach(d => {
      guides.push({ id: d.id, ...d.data() });
    });

    return guides.filter(guide => {
      // Verified only for public/tourist marketplace
      if (filters.verifiedOnly && (guide.verificationStatus !== 'approved' || guide.verified !== true)) {
        return false;
      }

      // City / Service area filter
      if (filters.city && filters.city !== 'all') {
        const target = filters.city.trim().toLowerCase();
        const cityMatch = guide.city && guide.city.toLowerCase().includes(target);
        const areaMatch = Array.isArray(guide.serviceAreas) && guide.serviceAreas.some(a => a.toLowerCase().includes(target));
        const citiesMatch = Array.isArray(guide.cities) && guide.cities.some(c => c.toLowerCase().includes(target));
        const locMatch = guide.currentLocationName && guide.currentLocationName.toLowerCase().includes(target);
        if (!cityMatch && !areaMatch && !citiesMatch && !locMatch) {
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

      // Max distance filter (only applies when guide has real distanceKm)
      if (filters.maxDistance && Number(filters.maxDistance) > 0 && Number.isFinite(Number(guide.distanceKm)) && Number(guide.distanceKm) > Number(filters.maxDistance)) {
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
  if (!isFirebaseConfigured() || !guideId) return null;
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
 * Update Guide Online/Offline status (strictly requires admin approval before going online)
 */
export async function updateGuideOnlineStatus(guideId, isOnline) {
  if (!isFirebaseConfigured() || !guideId) return false;
  const desired = Boolean(isOnline);
  const guide = await getGuideById(guideId);
  if (!guide) return false;

  if (desired && (guide.verificationStatus !== 'approved' || guide.verified !== true)) {
    throw new Error(t('toasts.guideApprovalRequiredOnline'));
  }

  try {
    const guideRef = doc(db, COLLECTIONS.GUIDES, guideId);
    await updateDoc(guideRef, {
      isOnline: desired,
      updatedAt: new Date().toISOString()
    });
    return desired;
  } catch (err) {
    handleFirestoreError(err, 'update', `${COLLECTIONS.GUIDES}/${guideId}`);
    return !desired;
  }
}

/**
 * Update Guide weekly schedule, blocked dates & instant toggle
 */
export async function updateGuideAvailabilitySchedule(guideId, { weeklyAvailability, blockedDates, instantAvailable }) {
  if (!isFirebaseConfigured() || !guideId) return false;
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
 * Synchronizes guides/{guideId}, users/{guideId}.status, notification, and auditLogs.
 */
export async function updateGuideVerification(guideId, status, notes = '') {
  if (!isFirebaseConfigured() || !guideId) return false;
  try {
    const approved = status === 'approved';
    const nowIso = new Date().toISOString();
    const guideRef = doc(db, COLLECTIONS.GUIDES, guideId);

    const guideUpdates = {
      verificationStatus: status,
      verified: approved,
      isApproved: approved,
      verificationNotes: notes,
      verifiedAt: approved ? nowIso : null,
      updatedAt: nowIso
    };
    if (!approved) {
      guideUpdates.isOnline = false;
    }

    await updateDoc(guideRef, guideUpdates);

    const nextUserStatus = approved ? 'active' : status === 'suspended' ? 'suspended' : 'pending';
    await updateDoc(doc(db, COLLECTIONS.USERS, guideId), {
      status: nextUserStatus,
      updatedAt: nowIso
    });

    await sendNotification(
      guideId,
      approved ? t('notif.guideApprovedTitle') : t('notif.guideStatusTitle'),
      approved ? t('notif.guideApprovedBody') : t('notif.guideStatusBody', { status: t(`guide.${approved ? 'verifiedApprovedBadge' : status === 'rejected' || status === 'suspended' ? 'rejectedBadge' : 'pendingVerificationBadge'}`) }),
      'guide/profile.html',
      { type: 'guide_verification' }
    );

    await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
      action: `GUIDE_VERIFICATION_${status.toUpperCase()}`,
      actorId: auth.currentUser?.uid || null,
      targetId: guideId,
      timestamp: nowIso,
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
  if (!isFirebaseConfigured() || !guideId) return [];
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
 * Submit a real tourist review after a completed booking (1 review per booking enforced via deterministic ID + rules)
 */
export async function submitReview({ bookingId, guideId, touristId, touristName, rating, comment }) {
  if (!isFirebaseConfigured()) {
    throw new Error(t('auth.errFirebaseNotConfigured'));
  }
  const numRating = Math.max(1, Math.min(5, Number(rating) || 5));
  const reviewId = `REV-${bookingId}`;
  const nowIso = new Date().toISOString();
  const reviewDoc = {
    id: reviewId,
    bookingId,
    guideId,
    touristId,
    touristName: touristName || 'Traveler',
    rating: numRating,
    comment: String(comment || '').trim(),
    createdAt: nowIso
  };

  try {
    await setDoc(doc(db, COLLECTIONS.REVIEWS, reviewId), reviewDoc);
    await updateDoc(doc(db, COLLECTIONS.BOOKINGS, bookingId), {
      reviewed: true,
      reviewRating: numRating,
      updatedAt: nowIso
    });
    return reviewDoc;
  } catch (err) {
    handleFirestoreError(err, 'create', `${COLLECTIONS.REVIEWS}/${reviewId}`);
    return null;
  }
}
