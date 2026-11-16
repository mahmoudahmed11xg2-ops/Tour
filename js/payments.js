/**
 * TourGuide — Payment & Escrow Layer
 * Records upfront escrow on booking confirmation and handles completion settlement / refunds.
 */

import { doc, setDoc, updateDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db, COLLECTIONS } from './firebase.js';

export async function createEscrowPayment({
  bookingId,
  touristId,
  guideId,
  amount,
  platformFee,
  currency = 'USD',
  method = 'card'
}) {
  const paymentId = `PAY-${bookingId}`;
  const paymentRecord = {
    id: paymentId,
    paymentId,
    bookingId,
    touristId,
    guideId,
    amount: Number(amount),
    platformFee: Number(platformFee),
    guideNet: Math.round((Number(amount) - Number(platformFee)) * 100) / 100,
    currency,
    method,
    status: 'held_in_escrow',
    gateway: currency === 'EGP' ? 'Paymob' : 'Stripe',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await setDoc(doc(db, COLLECTIONS.PAYMENTS, paymentId), paymentRecord);
  return { success: true, paymentRecord };
}

export async function updatePaymentStatusForBooking(bookingId, status) {
  const paymentId = `PAY-${bookingId}`;
  try {
    await updateDoc(doc(db, COLLECTIONS.PAYMENTS, paymentId), {
      status,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (err) {
    console.warn('Payment status update notice:', err.message);
    return false;
  }
}

export async function getPaymentsForUser(userId, role = 'tourist') {
  try {
    const field = role === 'guide' ? 'guideId' : 'touristId';
    const q = role === 'admin'
      ? collection(db, COLLECTIONS.PAYMENTS)
      : query(collection(db, COLLECTIONS.PAYMENTS), where(field, '==', userId));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    console.warn('Payments fetch notice:', err.message);
    return [];
  }
}
