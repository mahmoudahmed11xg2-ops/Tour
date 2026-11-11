/**
 * TourGuide — Payment Abstraction Layer
 * Pluggable architecture supporting Paymob/Fawry (Egypt) & Stripe (Global)
 */

import { db, COLLECTIONS } from './firebase.js';

export async function processPayment({ bookingId, amount, method = 'card', currency = 'USD' }) {
  // Simulates payment verification (Paymob/Stripe)
  const paymentRecord = {
    paymentId: `PAY-${Date.now()}`,
    bookingId,
    amount,
    currency,
    method,
    status: 'succeeded',
    gateway: currency === 'EGP' ? 'Paymob' : 'Stripe',
    timestamp: new Date().toISOString()
  };

  await db.addDocument(COLLECTIONS.PAYMENTS, paymentRecord);
  return { success: true, paymentRecord };
}
