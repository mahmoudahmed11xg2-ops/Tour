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
import { db, COLLECTIONS, isFirebaseConfigured, handleFirestoreError } from './firebase.js';
import { getBookingsForTourist, getBookingsForGuide } from './booking.js';
import { sendNotification } from './notifications.js';
import { t } from './utils.js';

/**
 * Subscribe to real-time messages for a specific booking
 */
export function subscribeToBookingMessages(bookingId, onUpdate, onError = null) {
  if (!isFirebaseConfigured() || !bookingId) {
    onUpdate([]);
    return () => {};
  }
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
  if (!isFirebaseConfigured()) {
    throw new Error(t('auth.errFirebaseNotConfigured'));
  }
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

    const recipientId = senderId === booking.touristId ? booking.guideId : booking.touristId;
    if (recipientId) {
      const link = senderId === booking.touristId
        ? `guide/messages.html?bookingId=${booking.id}`
        : `tourist/messages.html?bookingId=${booking.id}`;
      await sendNotification(
        recipientId,
        t('notif.newMessageTitle'),
        t('notif.newMessageBody', { sender: payload.senderName || t('nav.messages'), preview: cleanText.slice(0, 80) }),
        link,
        { type: 'new_message', bookingId: booking.id, senderId }
      );
    }

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
  if (!isFirebaseConfigured() || !userId) return [];
  const bookings = role === 'guide'
    ? await getBookingsForGuide(userId)
    : await getBookingsForTourist(userId);
  return bookings;
}
