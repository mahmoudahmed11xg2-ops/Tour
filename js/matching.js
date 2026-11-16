/**
 * TourGuide — Matching & Dispatch Engine
 * Performs required filtering, real-time conflict verification, weighted scoring, and sorting.
 */

import { fetchGuides } from './guides.js';
import {
  getAllActiveBusySlots,
  evaluateGuideAvailabilityWithSlots,
  computeTimeWindow
} from './availability.js';
import { getTodayISODate, getCurrentTimeHHMM } from './utils.js';

/**
 * Compute weighted 100-point matching score
 */
export function computeMatchingScore(guide, { specialty = 'all' } = {}) {
  let score = 0;

  // 1. Distance proximity (max 25 pts)
  const distance = Number(guide.distanceKm || 5);
  if (distance <= 3) score += 25;
  else if (distance <= 8) score += 18;
  else if (distance <= 15) score += 10;
  else score += 4;

  // 2. Rating quality (max 25 pts)
  const rating = Number(guide.rating || 4.0);
  score += Math.min(25, (rating / 5) * 25);

  // 3. Experience years (max 15 pts)
  const exp = Number(guide.experienceYears || 1);
  score += Math.min(15, exp * 1.5);

  // 4. Specialty relevance (max 15 pts)
  const specs = Array.isArray(guide.specialties) ? guide.specialties : [];
  if (specialty && specialty !== 'all') {
    const idx = specs.findIndex(s => s.toLowerCase() === specialty.toLowerCase());
    score += idx === 0 ? 15 : idx > 0 ? 12 : 0;
  } else {
    score += specs.length > 0 ? 10 : 5;
  }

  // 5. Price competitiveness (max 10 pts)
  const rate = Number(guide.hourlyRate || 25);
  const priceScore = Math.max(2, 10 - Math.max(0, (rate - 20) / 5));
  score += Math.min(10, priceScore);

  // 6. Response rate (max 10 pts)
  const responseRate = Number(guide.responseRate ?? 95);
  score += Math.min(10, (responseRate / 100) * 10);

  return Math.round(score);
}

/**
 * Match and rank guides for Instant or Scheduled search
 */
export async function matchGuides({
  location = 'all',
  language = 'all',
  category = 'all',
  specialty = null,
  date = null,
  startTime = null,
  durationHours = 2,
  isInstant = true,
  maxPrice = null,
  minRating = null,
  maxDistance = null,
  sortBy = 'recommended',
  excludeGuideIds = [],
  includeUnavailable = false
} = {}) {
  const effectiveSpecialty = specialty || category || 'all';
  const effectiveDate = date || getTodayISODate();
  const effectiveTime = startTime || (isInstant ? getCurrentTimeHHMM() : '10:00');
  const win = computeTimeWindow(effectiveDate, effectiveTime, durationHours);

  // Step 1: Required marketplace attribute filtering
  const candidates = await fetchGuides({
    city: location || 'all',
    language: language || 'all',
    specialty: effectiveSpecialty,
    onlineOnly: isInstant,
    verifiedOnly: true,
    maxPrice,
    minRating,
    maxDistance
  });

  // Step 2: Batch-fetch busy slots once for O(1) per-guide availability validation
  const allBusySlots = await getAllActiveBusySlots();
  const slotsByGuide = new Map();
  allBusySlots.forEach(slot => {
    if (!slotsByGuide.has(slot.guideId)) slotsByGuide.set(slot.guideId, []);
    slotsByGuide.get(slot.guideId).push(slot);
  });

  const excludedSet = new Set(Array.isArray(excludeGuideIds) ? excludeGuideIds : []);

  // Step 3: Evaluate schedule + conflict availability & compute score
  const evaluated = [];
  for (const guide of candidates) {
    if (excludedSet.has(guide.id)) continue;

    const guideSlots = slotsByGuide.get(guide.id) || [];
    const availability = evaluateGuideAvailabilityWithSlots(
      guide,
      guideSlots,
      win.date,
      win.startTime,
      win.duration
    );

    if (!includeUnavailable && !availability.available) {
      continue;
    }

    const score = computeMatchingScore(guide, { specialty: effectiveSpecialty });

    evaluated.push({
      guide,
      score,
      distanceKm: Number(guide.distanceKm || 5),
      availability,
      window: win
    });
  }

  // Step 4: Sort results (always keep available guides above unavailable when mixed)
  evaluated.sort((a, b) => {
    if (a.availability.available !== b.availability.available) {
      return a.availability.available ? -1 : 1;
    }
    if (sortBy === 'rating') {
      return (b.guide.rating || 0) - (a.guide.rating || 0);
    }
    if (sortBy === 'price') {
      return (a.guide.hourlyRate || 0) - (b.guide.hourlyRate || 0);
    }
    if (sortBy === 'distance') {
      return a.distanceKm - b.distanceKm;
    }
    return b.score - a.score;
  });

  return evaluated;
}
