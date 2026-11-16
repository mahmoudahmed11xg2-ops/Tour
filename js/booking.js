/**
 * TourGuide — Real Booking Lifecycle, Dispatch & State Machine Engine
 * Strictly Firestore-backed with conflict checking, guide accept/decline,
 * instant fallback dispatch, and role-enforced operational progression.
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
  where,
  onSnapshot
} from 'firebase/firestore';
import {
  checkGuideAvailability,
  computeTimeWindow,
  syncBusySlotForBooking,
  releaseBusySlotForBooking
} from './availability.js';
import { matchGuides } from './matching.js';
import { createEscrowPayment, updatePaymentStatusForBooking } from './payments.js';
import { sendNotification } from './notifications.js';
import { getTodayISODate, getCurrentTimeHHMM } from './utils.js';

export const BOOKING_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  CONFIRMED: 'confirmed',
  GUIDE_ARRIVING: 'guide_arriving',
  MEETING_STARTED: 'meeting_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  REFUNDED: 'refunded',
  DISPUTED: 'disputed'
};

export const TERMINAL_BOOKING_STATUSES = [
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.CANCELLED,
  BOOKING_STATUS.REJECTED,
  BOOKING_STATUS.EXPIRED,
  BOOKING_STATUS.REFUNDED
];

export const ACTIVE_OPERATIONAL_STATUSES = [
  BOOKING_STATUS.ACCEPTED,
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.GUIDE_ARRIVING,
  BOOKING_STATUS.MEETING_STARTED,
  BOOKING_STATUS.IN_PROGRESS
];

export const ALLOWED_GUIDE_TRANSITIONS = {
  [BOOKING_STATUS.ACCEPTED]: BOOKING_STATUS.CONFIRMED,
  [BOOKING_STATUS.CONFIRMED]: BOOKING_STATUS.GUIDE_ARRIVING,
  [BOOKING_STATUS.GUIDE_ARRIVING]: BOOKING_STATUS.MEETING_STARTED,
  [BOOKING_STATUS.MEETING_STARTED]: BOOKING_STATUS.IN_PROGRESS,
  [BOOKING_STATUS.IN_PROGRESS]: BOOKING_STATUS.COMPLETED
};

export const CANCELLATION_POLICY_STANDARD =
  'Free cancellation up to 2 hours before start time. 100% refund if guide declines or cannot attend.';

/**
 * Create a real booking in Firestore.
 * Always creates with status = 'pending' and validates guide availability first.
 */
export async function createBooking({
  guideId,
  guideName,
  touristId,
  touristName,
  location,
  destination = '',
  date,
  startTime,
  durationHours = 2,
  language = 'English',
  specialty = 'History',
  guests = 1,
  service = 'Standard Walking Tour',
  hourlyRate = 25,
  currency = 'USD',
  bookingType = 'instant',
  candidateGuideIds = []
}) {
  if (!touristId) throw new Error('Authentication required to create a booking.');
  if (!guideId) throw new Error('No guide selected.');

  const safeDate = date || getTodayISODate();
  const safeStart = startTime || (bookingType === 'instant' ? getCurrentTimeHHMM() : '10:00');
  const win = computeTimeWindow(safeDate, safeStart, durationHours);

  // 1. Strict double-booking & schedule verification
  const availability = await checkGuideAvailability(guideId, win.date, win.startTime, win.duration);
  if (!availability.available) {
    const err = new Error('Guide is unavailable at the selected date and time.');
    err.code = availability.reason || 'conflict';
    err.availability = availability;
    throw err;
  }

  // 2. Price calculation
  const numericRate = Number(hourlyRate) || 25;
  const price = Math.round(numericRate * win.duration * 100) / 100;
  const platformFee = Math.round(price * 0.15 * 100) / 100;
  const total = Math.round((price + platformFee) * 100) / 100;

  const bookingId = `BK-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const nowIso = new Date().toISOString();

  const newBooking = {
    id: bookingId,
    touristId,
    touristName: touristName || 'Traveler',
    guideId,
    guideName: guideName || 'Certified Guide',
    bookingType,
    status: BOOKING_STATUS.PENDING,
    location: location || 'Giza',
    destination: destination || location || 'Giza',
    date: win.date,
    startTime: win.startTime,
    endTime: win.endTime,
    startMs: win.startMs,
    endMs: win.endMs,
    duration: win.duration,
    guests: Number(guests) || 1,
    language,
    specialty,
    service,
    hourlyRate: numericRate,
    price,
    platformFee,
    total,
    currency,
    cancellationPolicy: CANCELLATION_POLICY_STANDARD,
    candidateGuideIds: Array.isArray(candidateGuideIds) && candidateGuideIds.length
      ? candidateGuideIds
      : [guideId],
    declinedGuideIds: [],
    createdAt: nowIso,
    updatedAt: nowIso
  };

  try {
    // 3. Persist booking + non-PII busy slot lock
    await setDoc(doc(db, COLLECTIONS.BOOKINGS, bookingId), newBooking);
    await syncBusySlotForBooking(newBooking);

    // 4. Notify Guide + Audit log
    await sendNotification(
      guideId,
      'New Tour Request',
      `${newBooking.touristName} requested a ${win.duration}h tour in ${newBooking.location} (${win.date} ${win.startTime}).`,
      `/guide/requests.html`
    );

    await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
      action: 'BOOKING_CREATED',
      bookingId,
      touristId,
      guideId,
      bookingType,
      timestamp: nowIso
    });

    return newBooking;
  } catch (err) {
    handleFirestoreError(err, 'create', `${COLLECTIONS.BOOKINGS}/${bookingId}`);
    return null;
  }
}

/**
 * Guide Accepts a pending booking -> confirmed + escrow held
 */
export async function acceptBooking(bookingId, guideId) {
  const ref = doc(db, COLLECTIONS.BOOKINGS, bookingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Booking not found.');

  const booking = { id: snap.id, ...snap.data() };
  if (booking.guideId !== guideId) throw new Error('Unauthorized guide action.');
  if (booking.status !== BOOKING_STATUS.PENDING) {
    throw new Error(`Booking is already ${booking.status}.`);
  }

  // Re-verify no conflicting confirmed slot exists for this guide
  const check = await checkGuideAvailability(
    guideId,
    booking.date,
    booking.startTime,
    booking.duration,
    bookingId
  );
  if (!check.available) {
    throw new Error('Time slot conflicts with another booking on your calendar.');
  }

  const nowIso = new Date().toISOString();
  await updateDoc(ref, {
    status: BOOKING_STATUS.CONFIRMED,
    acceptedAt: nowIso,
    confirmedAt: nowIso,
    updatedAt: nowIso
  });

  await syncBusySlotForBooking({ ...booking, status: BOOKING_STATUS.CONFIRMED });

  await createEscrowPayment({
    bookingId,
    touristId: booking.touristId,
    guideId: booking.guideId,
    amount: booking.total,
    platformFee: booking.platformFee,
    currency: booking.currency || 'USD'
  });

  await sendNotification(
    booking.touristId,
    'Booking Confirmed',
    `${booking.guideName} accepted and confirmed your tour in ${booking.location}.`,
    `/tourist/booking.html?id=${bookingId}`
  );

  await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
    action: 'BOOKING_ACCEPTED_CONFIRMED',
    bookingId,
    guideId,
    touristId: booking.touristId,
    timestamp: nowIso
  });

  return { ...booking, status: BOOKING_STATUS.CONFIRMED };
}

/**
 * Guide Declines a pending booking.
 * For INSTANT bookings: automatically re-dispatches to the next eligible available guide.
 * If no eligible guide remains (or scheduled booking): marks 'rejected' & frees busy slot.
 */
export async function declineBooking(bookingId, guideId, reason = 'Guide declined') {
  const ref = doc(db, COLLECTIONS.BOOKINGS, bookingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Booking not found.');

  const booking = { id: snap.id, ...snap.data() };
  if (booking.guideId !== guideId) throw new Error('Unauthorized guide action.');
  if (booking.status !== BOOKING_STATUS.PENDING) {
    throw new Error(`Cannot decline booking in status ${booking.status}.`);
  }

  const nowIso = new Date().toISOString();
  const declinedSet = new Set(Array.isArray(booking.declinedGuideIds) ? booking.declinedGuideIds : []);
  declinedSet.add(guideId);
  const updatedDeclined = Array.from(declinedSet);

  // Attempt instant fallback dispatch
  if (booking.bookingType === 'instant') {
    const matches = await matchGuides({
      location: booking.location,
      language: booking.language || 'all',
      specialty: booking.specialty || 'all',
      date: booking.date,
      startTime: booking.startTime,
      durationHours: booking.duration || 2,
      isInstant: true,
      excludeGuideIds: updatedDeclined
    });

    if (matches.length > 0) {
      const next = matches[0].guide;
      const nextRate = Number(next.hourlyRate || booking.hourlyRate || 25);
      const nextPrice = Math.round(nextRate * (Number(booking.duration) || 2) * 100) / 100;
      const nextFee = Math.round(nextPrice * 0.15 * 100) / 100;
      const nextTotal = Math.round((nextPrice + nextFee) * 100) / 100;

      const updatedBooking = {
        ...booking,
        guideId: next.id,
        guideName: next.name,
        hourlyRate: nextRate,
        price: nextPrice,
        platformFee: nextFee,
        total: nextTotal,
        declinedGuideIds: updatedDeclined,
        candidateGuideIds: matches.map(m => m.guide.id),
        status: BOOKING_STATUS.PENDING,
        reassignedAt: nowIso,
        updatedAt: nowIso
      };

      await updateDoc(ref, {
        guideId: next.id,
        guideName: next.name,
        hourlyRate: nextRate,
        price: nextPrice,
        platformFee: nextFee,
        total: nextTotal,
        declinedGuideIds: updatedDeclined,
        candidateGuideIds: updatedBooking.candidateGuideIds,
        reassignedAt: nowIso,
        updatedAt: nowIso
      });

      await syncBusySlotForBooking(updatedBooking);

      await sendNotification(
        next.id,
        'New Instant Tour Request',
        `${booking.touristName} needs a guide in ${booking.location} (${booking.duration}h).`,
        `/guide/requests.html`
      );

      await sendNotification(
        booking.touristId,
        'Matching Next Available Guide',
        `Previous guide unavailable. Automatically matched with ${next.name}.`,
        `/tourist/booking.html?id=${bookingId}`
      );

      await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
        action: 'BOOKING_INSTANT_FALLBACK_REASSIGNED',
        bookingId,
        previousGuideId: guideId,
        nextGuideId: next.id,
        timestamp: nowIso
      });

      return { outcome: 'reassigned', booking: updatedBooking };
    }
  }

  // No fallback available (or scheduled booking declined)
  await updateDoc(ref, {
    status: BOOKING_STATUS.REJECTED,
    declinedGuideIds: updatedDeclined,
    rejectionReason: booking.bookingType === 'instant' ? 'no_guide_available' : reason,
    updatedAt: nowIso
  });

  await releaseBusySlotForBooking(bookingId);

  await sendNotification(
    booking.touristId,
    'No Guide Available',
    booking.bookingType === 'instant'
      ? 'No guide is available right now for your instant request. You can try again or schedule for later.'
      : `${booking.guideName} declined your scheduled request. Please choose another time or guide.`,
    `/tourist/booking.html?id=${bookingId}`
  );

  await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
    action: 'BOOKING_REJECTED',
    bookingId,
    guideId,
    reason: booking.bookingType === 'instant' ? 'no_guide_available' : reason,
    timestamp: nowIso
  });

  return { outcome: 'rejected', booking: { ...booking, status: BOOKING_STATUS.REJECTED } };
}

/**
 * Tourist retries an instant booking that ended in rejected / expired
 */
export async function retryInstantBooking(bookingId, touristId) {
  const ref = doc(db, COLLECTIONS.BOOKINGS, bookingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Booking not found.');

  const booking = { id: snap.id, ...snap.data() };
  if (booking.touristId !== touristId) throw new Error('Unauthorized.');

  const win = computeTimeWindow(getTodayISODate(), getCurrentTimeHHMM(), booking.duration || 2);
  const matches = await matchGuides({
    location: booking.location,
    language: booking.language || 'all',
    specialty: booking.specialty || 'all',
    date: win.date,
    startTime: win.startTime,
    durationHours: win.duration,
    isInstant: true
  });

  if (matches.length === 0) {
    return { outcome: 'no_guide_available', booking };
  }

  const best = matches[0].guide;
  const nowIso = new Date().toISOString();
  const nextRate = Number(best.hourlyRate || booking.hourlyRate || 25);
  const nextPrice = Math.round(nextRate * win.duration * 100) / 100;
  const nextFee = Math.round(nextPrice * 0.15 * 100) / 100;
  const nextTotal = Math.round((nextPrice + nextFee) * 100) / 100;

  const updates = {
    guideId: best.id,
    guideName: best.name,
    date: win.date,
    startTime: win.startTime,
    endTime: win.endTime,
    startMs: win.startMs,
    endMs: win.endMs,
    hourlyRate: nextRate,
    price: nextPrice,
    platformFee: nextFee,
    total: nextTotal,
    status: BOOKING_STATUS.PENDING,
    declinedGuideIds: [],
    candidateGuideIds: matches.map(m => m.guide.id),
    rejectionReason: null,
    updatedAt: nowIso
  };

  await updateDoc(ref, updates);
  const updated = { ...booking, ...updates };
  await syncBusySlotForBooking(updated);

  await sendNotification(
    best.id,
    'New Instant Tour Request',
    `${booking.touristName} requested an instant guide in ${booking.location}.`,
    `/guide/requests.html`
  );

  return { outcome: 'dispatched', booking: updated };
}

/**
 * Guide operational state transition (strict sequential state machine, never skips)
 */
export async function progressBookingStatus(bookingId, guideId, targetStatus = null) {
  const ref = doc(db, COLLECTIONS.BOOKINGS, bookingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Booking not found.');

  const booking = { id: snap.id, ...snap.data() };
  if (booking.guideId !== guideId) {
    throw new Error('Only the assigned guide can update operational tour status.');
  }

  const nextStatus = ALLOWED_GUIDE_TRANSITIONS[booking.status];
  if (!nextStatus) {
    throw new Error(`No operational transition allowed from "${booking.status}".`);
  }
  if (targetStatus && targetStatus !== nextStatus) {
    throw new Error(`Invalid transition from "${booking.status}" to "${targetStatus}".`);
  }

  const nowIso = new Date().toISOString();
  const extraFields = {};
  if (nextStatus === BOOKING_STATUS.IN_PROGRESS) extraFields.startedAt = nowIso;
  if (nextStatus === BOOKING_STATUS.COMPLETED) extraFields.completedAt = nowIso;

  await updateDoc(ref, {
    status: nextStatus,
    ...extraFields,
    updatedAt: nowIso
  });

  if (nextStatus === BOOKING_STATUS.COMPLETED) {
    await releaseBusySlotForBooking(bookingId);
    await updatePaymentStatusForBooking(bookingId, 'released_to_guide');
  } else {
    await syncBusySlotForBooking({ ...booking, status: nextStatus });
  }

  await sendNotification(
    booking.touristId,
    'Tour Status Updated',
    `Your tour status is now: ${nextStatus.replace(/_/g, ' ')}.`,
    `/tourist/booking.html?id=${bookingId}`
  );

  return nextStatus;
}

/**
 * Cancel a booking (Tourist, Guide before start, or Admin)
 */
export async function cancelBooking(bookingId, actorId = null, reason = 'Cancelled by user') {
  const ref = doc(db, COLLECTIONS.BOOKINGS, bookingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;

  const booking = snap.data();
  const nowIso = new Date().toISOString();

  await updateDoc(ref, {
    status: BOOKING_STATUS.CANCELLED,
    cancelReason: reason,
    cancelledBy: actorId,
    updatedAt: nowIso
  });

  await releaseBusySlotForBooking(bookingId);
  await updatePaymentStatusForBooking(bookingId, 'refunded');

  await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
    action: 'BOOKING_CANCELLED',
    bookingId,
    userId: actorId,
    timestamp: nowIso,
    notes: reason
  });

  return true;
}

/**
 * Open dispute on an active/completed booking
 */
export async function openDispute(bookingId, actorId, reason = 'Issue reported') {
  const ref = doc(db, COLLECTIONS.BOOKINGS, bookingId);
  const nowIso = new Date().toISOString();
  await updateDoc(ref, {
    status: BOOKING_STATUS.DISPUTED,
    disputeReason: reason,
    disputedBy: actorId,
    updatedAt: nowIso
  });

  await releaseBusySlotForBooking(bookingId);

  await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
    action: 'BOOKING_DISPUTED',
    bookingId,
    userId: actorId,
    timestamp: nowIso,
    notes: reason
  });

  return true;
}

/**
 * Queries & Real-Time Listeners
 */
export async function getBookingById(bookingId) {
  if (!bookingId) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.BOOKINGS, bookingId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (err) {
    handleFirestoreError(err, 'get', `${COLLECTIONS.BOOKINGS}/${bookingId}`);
    return null;
  }
}

export async function getActiveBookingForTourist(touristId) {
  if (!touristId) return null;
  try {
    const q = query(collection(db, COLLECTIONS.BOOKINGS), where('touristId', '==', touristId));
    const snap = await getDocs(q);
    const bookings = [];
    snap.forEach(d => bookings.push({ id: d.id, ...d.data() }));
    bookings.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    return bookings.find(b => !TERMINAL_BOOKING_STATUSES.includes(b.status)) || null;
  } catch (err) {
    handleFirestoreError(err, 'list', COLLECTIONS.BOOKINGS);
    return null;
  }
}

export async function getBookingsForTourist(touristId) {
  if (!touristId) return [];
  try {
    const q = query(collection(db, COLLECTIONS.BOOKINGS), where('touristId', '==', touristId));
    const snap = await getDocs(q);
    const bookings = [];
    snap.forEach(d => bookings.push({ id: d.id, ...d.data() }));
    bookings.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return bookings;
  } catch (err) {
    handleFirestoreError(err, 'list', COLLECTIONS.BOOKINGS);
    return [];
  }
}

export async function getBookingsForGuide(guideId) {
  if (!guideId) return [];
  try {
    const q = query(collection(db, COLLECTIONS.BOOKINGS), where('guideId', '==', guideId));
    const snap = await getDocs(q);
    const bookings = [];
    snap.forEach(d => bookings.push({ id: d.id, ...d.data() }));
    bookings.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return bookings;
  } catch (err) {
    handleFirestoreError(err, 'list', COLLECTIONS.BOOKINGS);
    return [];
  }
}

export function subscribeToBooking(bookingId, onUpdate, onError = null) {
  return onSnapshot(
    doc(db, COLLECTIONS.BOOKINGS, bookingId),
    (snap) => {
      onUpdate(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    },
    (err) => {
      console.error('Booking subscription error:', err);
      if (onError) onError(err);
    }
  );
}

export function subscribeToGuideBookings(guideId, onUpdate, onError = null) {
  const q = query(collection(db, COLLECTIONS.BOOKINGS), where('guideId', '==', guideId));
  return onSnapshot(
    q,
    (snap) => {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      onUpdate(list);
    },
    (err) => {
      console.error('Guide bookings subscription error:', err);
      if (onError) onError(err);
    }
  );
}

export function subscribeToTouristBookings(touristId, onUpdate, onError = null) {
  const q = query(collection(db, COLLECTIONS.BOOKINGS), where('touristId', '==', touristId));
  return onSnapshot(
    q,
    (snap) => {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      onUpdate(list);
    },
    (err) => {
      console.error('Tourist bookings subscription error:', err);
      if (onError) onError(err);
    }
  );
}
