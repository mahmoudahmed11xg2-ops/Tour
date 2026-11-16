/**
 * TourGuide — Real Guide Availability & Conflict Detection Engine
 * Prevents double-booking via weekly schedules, blocked dates, and non-PII guideBusySlots.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where
} from 'firebase/firestore';
import { db, COLLECTIONS } from './firebase.js';
import { getTodayISODate, getCurrentTimeHHMM } from './utils.js';

export const BLOCKING_BOOKING_STATUSES = [
  'pending',
  'accepted',
  'confirmed',
  'guide_arriving',
  'meeting_started',
  'in_progress'
];

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const DEFAULT_WEEKLY_AVAILABILITY = {
  sun: { enabled: true, start: '07:00', end: '23:00' },
  mon: { enabled: true, start: '07:00', end: '23:00' },
  tue: { enabled: true, start: '07:00', end: '23:00' },
  wed: { enabled: true, start: '07:00', end: '23:00' },
  thu: { enabled: true, start: '07:00', end: '23:00' },
  fri: { enabled: true, start: '07:00', end: '23:00' },
  sat: { enabled: true, start: '07:00', end: '23:00' }
};

export function parseTimeToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const match = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function minutesToHHMM(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Compute normalized start/end time window and epoch timestamps
 */
export function computeTimeWindow(date, startTime, durationHours = 2) {
  const safeDate = (!date || date === 'Today') ? getTodayISODate() : String(date).trim();
  const safeStart = (!startTime || startTime === 'Now') ? getCurrentTimeHHMM() : String(startTime).trim();
  const dur = Math.max(1, Math.min(12, Number(durationHours) || 2));

  const startMins = parseTimeToMinutes(safeStart);
  const validStartMins = startMins !== null ? startMins : parseTimeToMinutes(getCurrentTimeHHMM());
  const normalizedStart = minutesToHHMM(validStartMins);
  const endMins = validStartMins + Math.round(dur * 60);
  const normalizedEnd = minutesToHHMM(endMins);

  const startDateObj = new Date(`${safeDate}T${normalizedStart}:00`);
  const startMs = Number.isNaN(startDateObj.getTime()) ? Date.now() : startDateObj.getTime();
  const endMs = startMs + dur * 3600000;

  return {
    date: safeDate,
    startTime: normalizedStart,
    endTime: normalizedEnd,
    duration: dur,
    startMinutes: validStartMins,
    endMinutes: endMins,
    startMs,
    endMs
  };
}

/**
 * Check if [startA, endA) overlaps with [startB, endB)
 */
export function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

/**
 * Validate requested window against guide's weekly schedule & blocked dates
 */
export function isWithinGuideSchedule(guide, date, startTime, durationHours = 2) {
  const win = computeTimeWindow(date, startTime, durationHours);

  // 1. Check blocked dates
  const blocked = Array.isArray(guide?.blockedDates) ? guide.blockedDates : [];
  if (blocked.includes(win.date)) {
    return { ok: false, reason: 'day_off', window: win };
  }

  // 2. Check weekly schedule if configured
  const weekly = guide?.weeklyAvailability;
  if (!weekly || typeof weekly !== 'object') {
    // Legacy/unconfigured guides allow standard 07:00–23:00 unless they explicitly set hours
    return { ok: true, window: win };
  }

  const parsedDate = new Date(`${win.date}T12:00:00`);
  const dayKey = WEEKDAY_KEYS[parsedDate.getDay()];
  const daySched = weekly[dayKey];

  if (!daySched || !daySched.enabled) {
    return { ok: false, reason: 'day_off', window: win };
  }

  const schedStart = parseTimeToMinutes(daySched.start || '07:00');
  const schedEnd = parseTimeToMinutes(daySched.end || '23:00');
  if (schedStart === null || schedEnd === null) {
    return { ok: true, window: win };
  }

  // Reject overnight spillover past guide closing time
  if (win.startMinutes < schedStart || win.endMinutes > schedEnd) {
    return {
      ok: false,
      reason: 'outside_hours',
      scheduleStart: daySched.start,
      scheduleEnd: daySched.end,
      window: win
    };
  }

  return { ok: true, window: win };
}

/**
 * Fetch all active busy slots from Firestore (optionally filtered by guideId)
 */
export async function getAllActiveBusySlots() {
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.GUIDE_BUSY_SLOTS));
    const slots = [];
    snap.forEach(d => {
      const data = d.data();
      if (BLOCKING_BOOKING_STATUSES.includes(data.status)) {
        slots.push({ id: d.id, ...data });
      }
    });
    return slots;
  } catch (err) {
    console.warn('Unable to read guideBusySlots:', err.message);
    return [];
  }
}

export async function getGuideBusySlots(guideId, date = null) {
  if (!guideId) return [];
  try {
    const q = query(
      collection(db, COLLECTIONS.GUIDE_BUSY_SLOTS),
      where('guideId', '==', guideId)
    );
    const snap = await getDocs(q);
    const slots = [];
    snap.forEach(d => {
      const data = d.data();
      if (!BLOCKING_BOOKING_STATUSES.includes(data.status)) return;
      if (date && data.date !== date) return;
      slots.push({ id: d.id, ...data });
    });
    slots.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
    return slots;
  } catch (err) {
    console.warn(`Error loading busy slots for ${guideId}:`, err.message);
    return [];
  }
}

/**
 * Synchronous check using pre-fetched slots array (used by Matching Engine for O(1) batch checks)
 */
export function evaluateGuideAvailabilityWithSlots(guide, slotsForGuide, date, startTime, durationHours = 2, excludeBookingId = null) {
  const win = computeTimeWindow(date, startTime, durationHours);

  if (!guide) {
    return { available: false, reason: 'not_found', window: win };
  }
  if (guide.verificationStatus !== 'approved' || guide.verified === false) {
    return { available: false, reason: 'unverified', window: win };
  }

  const schedCheck = isWithinGuideSchedule(guide, win.date, win.startTime, win.duration);
  if (!schedCheck.ok) {
    return {
      available: false,
      reason: schedCheck.reason,
      scheduleStart: schedCheck.scheduleStart,
      scheduleEnd: schedCheck.scheduleEnd,
      window: win
    };
  }

  const conflictSlot = (slotsForGuide || []).find(slot => {
    if (excludeBookingId && slot.bookingId === excludeBookingId) return false;
    if (!BLOCKING_BOOKING_STATUSES.includes(slot.status)) return false;

    if (slot.startMs && slot.endMs) {
      return intervalsOverlap(win.startMs, win.endMs, slot.startMs, slot.endMs);
    }
    if (slot.date === win.date && slot.startTime && slot.endTime) {
      const s = parseTimeToMinutes(slot.startTime);
      const e = parseTimeToMinutes(slot.endTime);
      if (s !== null && e !== null) {
        return intervalsOverlap(win.startMinutes, win.endMinutes, s, e);
      }
    }
    return false;
  });

  if (conflictSlot) {
    return {
      available: false,
      reason: 'conflict',
      conflictSlot,
      window: win
    };
  }

  return { available: true, reason: 'available', window: win };
}

/**
 * Live availability & double-booking check for a single guide
 */
export async function checkGuideAvailability(guideOrId, date, startTime, durationHours = 2, excludeBookingId = null) {
  let guide = typeof guideOrId === 'object' ? guideOrId : null;
  const guideId = guide ? guide.id : guideOrId;

  if (!guide && guideId) {
    const snap = await getDoc(doc(db, COLLECTIONS.GUIDES, guideId));
    if (snap.exists()) {
      guide = { id: snap.id, ...snap.data() };
    }
  }

  const slots = await getGuideBusySlots(guideId, null);
  return evaluateGuideAvailabilityWithSlots(guide, slots, date, startTime, durationHours, excludeBookingId);
}

/**
 * Sync non-PII busy slot alongside booking creation/update
 */
export async function syncBusySlotForBooking(booking) {
  if (!booking || !booking.id) return;
  const slotRef = doc(db, COLLECTIONS.GUIDE_BUSY_SLOTS, booking.id);

  if (BLOCKING_BOOKING_STATUSES.includes(booking.status) && booking.guideId) {
    const win = computeTimeWindow(booking.date, booking.startTime, booking.duration);
    await setDoc(slotRef, {
      bookingId: booking.id,
      guideId: booking.guideId,
      createdByUid: booking.touristId,
      date: booking.date || win.date,
      startTime: booking.startTime || win.startTime,
      endTime: booking.endTime || win.endTime,
      startMs: booking.startMs || win.startMs,
      endMs: booking.endMs || win.endMs,
      duration: Number(booking.duration) || win.duration,
      status: booking.status,
      updatedAt: new Date().toISOString()
    });
  } else {
    await releaseBusySlotForBooking(booking.id);
  }
}

export async function releaseBusySlotForBooking(bookingId) {
  if (!bookingId) return;
  try {
    await deleteDoc(doc(db, COLLECTIONS.GUIDE_BUSY_SLOTS, bookingId));
  } catch (err) {
    console.warn(`Could not release busy slot ${bookingId}:`, err.message);
  }
}
