/**
 * TourGuide — Payment, Escrow & Payouts Layer
 * Records upfront escrow on booking confirmation, completion settlements, refunds, and guide payouts.
 */

import { doc, setDoc, updateDoc, getDocs, addDoc, collection, query, where } from 'firebase/firestore';
import { auth, db, COLLECTIONS, isFirebaseConfigured, handleFirestoreError } from './firebase.js';
import { t } from './utils.js';

export async function createEscrowPayment({
  bookingId,
  touristId,
  guideId,
  amount,
  platformFee,
  currency = 'USD',
  method = 'card'
}) {
  if (!isFirebaseConfigured()) return { success: false, paymentRecord: null };
  const paymentId = `PAY-${bookingId}`;
  const nowIso = new Date().toISOString();
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
    createdAt: nowIso,
    updatedAt: nowIso
  };

  await setDoc(doc(db, COLLECTIONS.PAYMENTS, paymentId), paymentRecord);
  return { success: true, paymentRecord };
}

export async function updatePaymentStatusForBooking(bookingId, status) {
  if (!isFirebaseConfigured() || !bookingId) return false;
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
  if (!isFirebaseConfigured() || !userId) return [];
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

export async function requestPayout({
  guideId,
  guideName = '',
  amount,
  currency = 'USD',
  method = 'bank_transfer',
  notes = ''
}) {
  if (!isFirebaseConfigured()) throw new Error(t('auth.errFirebaseNotConfigured'));
  const numericAmount = Math.round(Number(amount || 0) * 100) / 100;
  if (!guideId || numericAmount <= 0) {
    throw new Error(t('guide.errNoAvailablePayout'));
  }

  const payoutId = `PAYOUT-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
  const nowIso = new Date().toISOString();
  const payoutRecord = {
    id: payoutId,
    payoutId,
    guideId,
    guideName: String(guideName || '').slice(0, 150),
    amount: numericAmount,
    currency,
    method,
    status: 'pending',
    notes: String(notes || '').slice(0, 500),
    createdAt: nowIso,
    updatedAt: nowIso
  };

  try {
    await setDoc(doc(db, COLLECTIONS.PAYOUTS, payoutId), payoutRecord);
    await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
      action: 'GUIDE_PAYOUT_REQUESTED',
      actorId: auth.currentUser?.uid || guideId,
      targetId: payoutId,
      guideId,
      amount: numericAmount,
      timestamp: nowIso
    });
    return payoutRecord;
  } catch (err) {
    handleFirestoreError(err, 'create', `${COLLECTIONS.PAYOUTS}/${payoutId}`);
    return null;
  }
}

export async function getPayoutsForGuide(guideId) {
  if (!isFirebaseConfigured() || !guideId) return [];
  try {
    const q = query(collection(db, COLLECTIONS.PAYOUTS), where('guideId', '==', guideId));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    console.warn('Payouts fetch notice:', err.message);
    return [];
  }
}

export async function getAllPayouts() {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.PAYOUTS));
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    console.warn('All payouts fetch notice:', err.message);
    return [];
  }
}

export async function updatePayoutStatus(payoutId, status, adminId, notes = '') {
  if (!isFirebaseConfigured() || !payoutId) return false;
  const nowIso = new Date().toISOString();
  await updateDoc(doc(db, COLLECTIONS.PAYOUTS, payoutId), {
    status,
    processedBy: adminId || auth.currentUser?.uid || null,
    notes: String(notes || '').slice(0, 500),
    updatedAt: nowIso
  });
  await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
    action: `ADMIN_PAYOUT_${String(status).toUpperCase()}`,
    actorId: auth.currentUser?.uid || adminId || null,
    targetId: payoutId,
    timestamp: nowIso,
    notes
  });
  return true;
}
