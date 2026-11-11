/**
 * TourGuide — Matching & Dispatch Engine
 * Calculates best candidates for Instant & Scheduled Booking
 */

import { fetchGuides } from './guides.js';

/**
 * Match best guides for tourist criteria
 */
export async function matchGuides({
  location = 'Giza',
  language = 'English',
  category = 'History',
  isInstant = true,
  maxRadiusKm = 15
}) {
  const eligible = await fetchGuides({
    city: location,
    language: language !== 'all' ? language : null,
    specialty: category !== 'all' ? category : null,
    onlineOnly: isInstant,
    verifiedOnly: true
  });

  // Calculate matching scores
  const scored = eligible.map(guide => {
    let score = 0;

    // Proximity score (Max 40 pts)
    const distance = guide.distanceKm || 5;
    if (distance <= 3) score += 40;
    else if (distance <= 8) score += 25;
    else if (distance <= 15) score += 10;

    // Rating score (Max 30 pts)
    score += (guide.rating / 5) * 30;

    // Experience bonus (Max 15 pts)
    score += Math.min(guide.experienceYears * 1.5, 15);

    // Online instant readiness (Max 15 pts)
    if (guide.isOnline) score += 15;

    return {
      guide,
      score: Math.round(score),
      distanceKm: distance
    };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  return scored;
}
