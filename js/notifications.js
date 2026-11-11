/**
 * TourGuide — Notification Dispatcher
 */

import { db, COLLECTIONS } from './firebase.js';

export async function sendNotification(userId, title, body, link = '') {
  const notification = {
    userId,
    title,
    body,
    link,
    read: false,
    createdAt: new Date().toISOString()
  };
  return await db.addDocument(COLLECTIONS.NOTIFICATIONS, notification);
}

export async function getUserNotifications(userId) {
  const all = await db.getCollection(COLLECTIONS.NOTIFICATIONS);
  return all.filter(n => n.userId === userId).reverse();
}
