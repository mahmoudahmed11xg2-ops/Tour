/**
 * TourGuide — Development Seed Script (Non-Production)
 * Run manually by an authenticated admin during development/testing only.
 * Not imported or executed in the production runtime UI.
 */

import { doc, setDoc } from 'firebase/firestore';
import { db, COLLECTIONS } from '../js/firebase.js';

export const DEV_SEED_GUIDES = [
  {
    id: 'guide_ahmed_hassan_official',
    name: 'Ahmed Hassan',
    email: 'ahmed.guide@tourguide.com',
    phone: '+20 100 123 4567',
    country: 'Egypt',
    verified: true,
    verificationStatus: 'approved',
    rating: 4.9,
    reviewsCount: 127,
    responseRate: 98,
    languages: ['Arabic', 'English', 'German'],
    experienceYears: 8,
    distanceKm: 2.4,
    hourlyRate: 25,
    currency: 'USD',
    city: 'Giza',
    serviceAreas: ['Giza', 'Cairo'],
    currentLocationName: 'Giza Plateau First Gate',
    isOnline: true,
    instantAvailable: true,
    avatar: 'assets/images/guide_portrait_ahmed_1794430336207.jpg',
    specialties: ['History', 'Architecture', 'Museum'],
    about: 'Certified Egyptologist and graduate of Faculty of Archaeology, Cairo University. Over 8 years guiding travelers through the pyramids, Sphinx, and the Grand Egyptian Museum.',
    weeklyAvailability: {
      sun: { enabled: true, start: '07:00', end: '22:00' },
      mon: { enabled: true, start: '07:00', end: '22:00' },
      tue: { enabled: true, start: '07:00', end: '22:00' },
      wed: { enabled: true, start: '07:00', end: '22:00' },
      thu: { enabled: true, start: '07:00', end: '22:00' },
      fri: { enabled: true, start: '08:00', end: '21:00' },
      sat: { enabled: true, start: '07:00', end: '22:00' }
    },
    blockedDates: [],
    packages: [
      { id: 'pkg1', title: 'Pyramids of Giza & Sphinx In-Depth', duration: 3, price: 75 },
      { id: 'pkg2', title: 'Grand Egyptian Museum (GEM) Masterpieces', duration: 4, price: 100 }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'guide_sarah_mansour_official',
    name: 'Dr. Sarah Mansour',
    email: 'sarah.mansour@tourguide.com',
    phone: '+20 102 987 6543',
    country: 'Egypt',
    verified: true,
    verificationStatus: 'approved',
    rating: 4.95,
    reviewsCount: 142,
    responseRate: 96,
    languages: ['Arabic', 'English', 'French'],
    experienceYears: 11,
    distanceKm: 3.8,
    hourlyRate: 35,
    currency: 'USD',
    city: 'Cairo',
    serviceAreas: ['Cairo', 'Giza'],
    currentLocationName: 'Tahrir Square / Downtown',
    isOnline: true,
    instantAvailable: true,
    avatar: 'assets/images/guide_portrait_sarah_1794430334163.jpg',
    specialties: ['Museum', 'History', 'Family'],
    about: 'PhD in Coptic & Islamic Heritage. Passionate about bringing ancient historical inscriptions to life for couples, solo travelers, and families.',
    weeklyAvailability: {
      sun: { enabled: true, start: '08:00', end: '21:00' },
      mon: { enabled: true, start: '08:00', end: '21:00' },
      tue: { enabled: true, start: '08:00', end: '21:00' },
      wed: { enabled: true, start: '08:00', end: '21:00' },
      thu: { enabled: true, start: '08:00', end: '21:00' },
      fri: { enabled: false, start: '08:00', end: '21:00' },
      sat: { enabled: true, start: '08:00', end: '21:00' }
    },
    blockedDates: [],
    packages: [
      { id: 'pkg3', title: 'Old Cairo: Hanging Church & Coptic Museum', duration: 3, price: 105 }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'guide_karim_luxor_official',
    name: 'Karim El-Sayed',
    email: 'karim.luxor@tourguide.com',
    phone: '+20 111 555 4321',
    country: 'Egypt',
    verified: true,
    verificationStatus: 'approved',
    rating: 4.88,
    reviewsCount: 94,
    responseRate: 94,
    languages: ['Arabic', 'English', 'Spanish'],
    experienceYears: 6,
    distanceKm: 5.1,
    hourlyRate: 28,
    currency: 'USD',
    city: 'Luxor',
    serviceAreas: ['Luxor', 'Aswan'],
    currentLocationName: 'Karnak Temple',
    isOnline: false,
    instantAvailable: false,
    avatar: 'assets/images/guide_portrait_ahmed_1794430336207.jpg',
    specialties: ['Desert', 'Local Experience', 'Food', 'History'],
    about: 'Specialized in Luxor West Bank royal tombs, temple hieroglyphics, and authentic culinary trails.',
    weeklyAvailability: {
      sun: { enabled: true, start: '06:00', end: '20:00' },
      mon: { enabled: true, start: '06:00', end: '20:00' },
      tue: { enabled: true, start: '06:00', end: '20:00' },
      wed: { enabled: true, start: '06:00', end: '20:00' },
      thu: { enabled: true, start: '06:00', end: '20:00' },
      fri: { enabled: true, start: '06:00', end: '20:00' },
      sat: { enabled: true, start: '06:00', end: '20:00' }
    },
    blockedDates: [],
    packages: [
      { id: 'pkg4', title: 'Valley of the Kings & Karnak Expedition', duration: 4, price: 112 }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export async function seedDevGuides() {
  for (const guide of DEV_SEED_GUIDES) {
    await setDoc(doc(db, COLLECTIONS.GUIDES, guide.id), guide, { merge: true });
  }
  return DEV_SEED_GUIDES.length;
}
