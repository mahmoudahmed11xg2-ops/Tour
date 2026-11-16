/**
 * TourGuide — Booking-Scoped Real-Time Messaging Service
 * Backed by Cloud Firestore '/messages' with strict participant rules.
 */

import {
  collection,
  doc,
  setDoc,
  query,
  where,
  onSnapshot
} from 'firebase/firestore';
import { db, COLLECTIONS, handleFirestoreError } from './firebase.js';
import { getBookingsForTourist, getBookingsForGuide } from './booking.js';
import { t } from './utils.js';

/**
 * Subscribe to real-time messages for a specific booking
 */
export function subscribeToBookingMessages(bookingId, onUpdate, onError = null) {
  if (!bookingId) return () => {};
  const q = query(
    collection(db, COLLECTIONS.MESSAGES),
    where('bookingId', '==', bookingId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      onUpdate(list);
    },
    (err) => {
      console.error('Messages subscription error:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Send a booking-scoped message
 */
export async function sendBookingMessage({ booking, senderId, senderRole, senderName, text }) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    throw new Error(t('messages.errEmptyMessage'));
  }
  if (!booking || !booking.id) {
    throw new Error(t('booking.errNotFound'));
  }

  const messageId = `MSG-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
  const payload = {
    id: messageId,
    bookingId: booking.id,
    touristId: booking.touristId,
    guideId: booking.guideId,
    senderId,
    senderRole: senderRole || 'tourist',
    senderName: String(senderName || '').slice(0, 120),
    text: cleanText.slice(0, 1000),
    createdAt: new Date().toISOString()
  };

  try {
    await setDoc(doc(db, COLLECTIONS.MESSAGES, messageId), payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, 'create', `${COLLECTIONS.MESSAGES}/${messageId}`);
    return null;
  }
}

/**
 * Fetch user's booking threads for Tourist or Guide
 */
export async function getUserConversations(userId, role = 'tourist') {
  if (!userId) return [];
  const bookings = role === 'guide'
    ? await getBookingsForGuide(userId)
    : await getBookingsForTourist(userId);
  return bookings;
}
