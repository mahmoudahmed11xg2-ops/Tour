/**
 * TourGuide — Notification Dispatcher
 * Uses scoped queries filtered by recipientId to comply with strict Firestore rules.
 */

import { collection, getDocs, doc, updateDoc, query, where } from 'firebase/firestore';
import { auth, db, COLLECTIONS, isFirebaseConfigured } from './firebase.js';

export async function sendNotification(recipientId, title, body, link = '', options = {}) {
  if (!isFirebaseConfigured() || !recipientId) return null;
  const { type = 'general', bookingId = null, senderId = null } = options;
  const notification = {
    recipientId,
    userId: recipientId,
    senderId: senderId || auth.currentUser?.uid || 'system',
    title,
    body,
    link,
    type,
    bookingId,
    read: false,
    createdAt: new Date().toISOString()
  };
  try {
    return await db.addDocument(COLLECTIONS.NOTIFICATIONS, notification);
  } catch (err) {
    console.warn('Notification dispatch notice:', err.message);
    return null;
  }
}

export async function getUserNotifications(userId) {
  if (!isFirebaseConfigured() || !userId) return [];
  try {
    const q = query(
      collection(db, COLLECTIONS.NOTIFICATIONS),
      where('recipientId', '==', userId)
    );
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    console.warn('Notifications fetch notice:', err.message);
    return [];
  }
}

export async function markNotificationRead(notificationId) {
  if (!isFirebaseConfigured() || !notificationId) return false;
  try {
    await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, notificationId), {
      read: true,
      readAt: new Date().toISOString()
    });
    return true;
  } catch (err) {
    console.warn('Notification mark read notice:', err.message);
    return false;
  }
}
