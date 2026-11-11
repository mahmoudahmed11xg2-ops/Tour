/**
 * TourGuide — Booking Lifecycle & Cloud Firestore Persistence
 * Manages ride states and reads/writes to Cloud Firestore.
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

export const BOOKING_STATES = [
  'Finding a Guide',
  'Guide Found',
  'Guide Confirmed',
  'Guide Arriving',
  'Meeting Started',
  'Tour in Progress',
  'Tour Completed'
];

/**
 * Create a new booking in Firestore
 */
export async function createBooking({
  guideId,
  guideName,
  touristId,
  touristName,
  location,
  date,
  time,
  durationHours = 2,
  language = 'English',
  guests = 1,
  service = 'Standard Walking Tour',
  hourlyRate = 25,
  type = 'instant'
}) {
  const price = hourlyRate * durationHours;
  const platformFee = Math.round(price * 0.15 * 10) / 10;
  const total = price + platformFee;
  const bookingId = `BK-${Date.now().toString().slice(-6)}`;

  const newBooking = {
    id: bookingId,
    guideId,
    guideName,
    touristId,
    touristName,
    location,
    date: date || 'Today',
    time: time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    duration: `${durationHours} hours`,
    language,
    guests: Number(guests),
    service,
    price,
    platformFee,
    total,
    status: type === 'instant' ? 'Finding a Guide' : 'Guide Confirmed',
    type,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    await setDoc(doc(db, COLLECTIONS.BOOKINGS, bookingId), newBooking);

    // Audit Log
    await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
      action: 'BOOKING_CREATED',
      bookingId,
      touristId,
      guideId,
      timestamp: new Date().toISOString()
    });

    return newBooking;
  } catch (err) {
    handleFirestoreError(err, 'create', `${COLLECTIONS.BOOKINGS}/${bookingId}`);
    return null;
  }
}

/**
 * Get active booking for tourist
 */
export async function getActiveBookingForTourist(touristId) {
  try {
    const q = query(
      collection(db, COLLECTIONS.BOOKINGS),
      where('touristId', '==', touristId)
    );
    const snap = await getDocs(q);
    const bookings = [];
    snap.forEach(d => bookings.push({ id: d.id, ...d.data() }));

    return bookings.reverse().find(
      b => b.status !== 'Tour Completed' && b.status !== 'Cancelled'
    ) || null;
  } catch (err) {
    handleFirestoreError(err, 'list', COLLECTIONS.BOOKINGS);
    return null;
  }
}

/**
 * Get all bookings for tourist
 */
export async function getBookingsForTourist(touristId) {
  try {
    const q = query(
      collection(db, COLLECTIONS.BOOKINGS),
      where('touristId', '==', touristId)
    );
    const snap = await getDocs(q);
    const bookings = [];
    snap.forEach(d => bookings.push({ id: d.id, ...d.data() }));
    return bookings.reverse();
  } catch (err) {
    handleFirestoreError(err, 'list', COLLECTIONS.BOOKINGS);
    return [];
  }
}

/**
 * Get bookings for guide
 */
export async function getBookingsForGuide(guideId) {
  try {
    const q = query(
      collection(db, COLLECTIONS.BOOKINGS),
      where('guideId', '==', guideId)
    );
    const snap = await getDocs(q);
    const bookings = [];
    snap.forEach(d => bookings.push({ id: d.id, ...d.data() }));
    return bookings.reverse();
  } catch (err) {
    handleFirestoreError(err, 'list', COLLECTIONS.BOOKINGS);
    return [];
  }
}

/**
 * Advance booking status (Ride-tracking state machine)
 */
export async function advanceBookingStatus(bookingId) {
  try {
    const ref = doc(db, COLLECTIONS.BOOKINGS, bookingId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;

    const data = snap.data();
    const currentIndex = BOOKING_STATES.indexOf(data.status);
    if (currentIndex < BOOKING_STATES.length - 1) {
      const nextStatus = BOOKING_STATES[currentIndex + 1];
      await updateDoc(ref, { 
        status: nextStatus,
        updatedAt: new Date().toISOString()
      });
      return nextStatus;
    }
    return data.status;
  } catch (err) {
    handleFirestoreError(err, 'update', `${COLLECTIONS.BOOKINGS}/${bookingId}`);
    return null;
  }
}

/**
 * Cancel a booking
 */
export async function cancelBooking(bookingId, reason = 'Tourist cancelled') {
  try {
    const ref = doc(db, COLLECTIONS.BOOKINGS, bookingId);
    await updateDoc(ref, { 
      status: 'Cancelled',
      cancelReason: reason,
      updatedAt: new Date().toISOString()
    });

    await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
      action: 'BOOKING_CANCELLED',
      bookingId,
      timestamp: new Date().toISOString(),
      reason
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, 'update', `${COLLECTIONS.BOOKINGS}/${bookingId}`);
    return false;
  }
}
