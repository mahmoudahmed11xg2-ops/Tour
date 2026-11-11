/**
 * TourGuide — Production Firebase Authentication System
 * Real Email/Password, Google Sign-in, Password Reset, Email Verification & Role-Based Route Protection.
 */

import { 
  auth, 
  db, 
  COLLECTIONS, 
  handleFirestoreError 
} from './firebase.js';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail, 
  sendEmailVerification, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc 
} from 'firebase/firestore';
import { showToast, t } from './utils.js';

// Cached user state in memory
let cachedUserDoc = null;
let isAuthReady = false;
const authReadyListeners = [];

/**
 * Register auth readiness callback
 */
export function onAuthReady(callback) {
  if (isAuthReady) {
    callback(auth.currentUser, cachedUserDoc);
  } else {
    authReadyListeners.push(callback);
  }
}

/**
 * Global Firebase Auth State Listener
 */
onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    try {
      const userRef = doc(db, COLLECTIONS.USERS, firebaseUser.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        cachedUserDoc = userSnap.data();
      } else {
        // Bootstrap new user record (e.g. Google Sign-in)
        const defaultRole = firebaseUser.email === 'ma1044853@gmail.com' ? 'admin' : 'tourist';
        cachedUserDoc = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          firstName: firebaseUser.displayName ? firebaseUser.displayName.split(' ')[0] : 'Traveler',
          lastName: firebaseUser.displayName ? firebaseUser.displayName.split(' ').slice(1).join(' ') : '',
          role: defaultRole,
          status: 'active',
          country: 'International',
          phone: firebaseUser.phoneNumber || '',
          preferredLanguage: 'English',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await setDoc(userRef, cachedUserDoc);
      }
    } catch (err) {
      console.error('Error fetching user profile:', err);
    }
  } else {
    cachedUserDoc = null;
  }

  isAuthReady = true;
  updateUIForAuth();

  // Notify listeners
  while (authReadyListeners.length > 0) {
    const fn = authReadyListeners.shift();
    fn(firebaseUser, cachedUserDoc);
  }
});

/**
 * Get currently authenticated Firebase user & Firestore profile
 */
export function getCurrentUser() {
  if (!auth.currentUser) return null;
  return {
    ...auth.currentUser,
    ...cachedUserDoc,
    uid: auth.currentUser.uid,
    email: auth.currentUser.email
  };
}

/**
 * Get current user Firestore profile
 */
export async function getCurrentUserProfile() {
  if (!auth.currentUser) return null;
  if (cachedUserDoc) return cachedUserDoc;

  try {
    const userSnap = await getDoc(doc(db, COLLECTIONS.USERS, auth.currentUser.uid));
    if (userSnap.exists()) {
      cachedUserDoc = userSnap.data();
      return cachedUserDoc;
    }
  } catch (err) {
    handleFirestoreError(err, 'get', `users/${auth.currentUser.uid}`);
  }
  return null;
}

/**
 * Login with Real Email & Password
 */
export async function login(email, password) {
  if (!email || !password) {
    throw new Error('Please enter both email and password.');
  }

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
    const userRef = doc(db, COLLECTIONS.USERS, userCredential.user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      cachedUserDoc = userSnap.data();
    } else {
      cachedUserDoc = {
        uid: userCredential.user.uid,
        email: userCredential.user.email,
        role: 'tourist'
      };
    }

    return {
      user: userCredential.user,
      profile: cachedUserDoc
    };
  } catch (err) {
    let friendlyMessage = 'Failed to log in. Please check your credentials.';
    if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
      friendlyMessage = 'Invalid email or password.';
    } else if (err.code === 'auth/user-not-found') {
      friendlyMessage = 'No account found with this email.';
    } else if (err.code === 'auth/too-many-requests') {
      friendlyMessage = 'Too many failed attempts. Please try again later or reset your password.';
    } else if (err.code === 'auth/invalid-email') {
      friendlyMessage = 'Please enter a valid email address.';
    }
    throw new Error(friendlyMessage);
  }
}

/**
 * Register a Tourist
 */
export async function registerTourist({ firstName, lastName, email, password, country, phone, preferredLanguage }) {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const user = userCredential.user;

    // Send verification email
    try {
      await sendEmailVerification(user);
    } catch (e) {
      console.warn('Email verification dispatch notice:', e.message);
    }

    // Save profile to Firestore
    const userDoc = {
      uid: user.uid,
      email: user.email,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone ? phone.trim() : '',
      country: country || 'International',
      role: 'tourist',
      status: 'active',
      preferredLanguage: preferredLanguage || 'English',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc(doc(db, COLLECTIONS.USERS, user.uid), userDoc);
    cachedUserDoc = userDoc;

    return { user, profile: userDoc };
  } catch (err) {
    let msg = err.message;
    if (err.code === 'auth/email-already-in-use') {
      msg = 'An account with this email already exists.';
    } else if (err.code === 'auth/invalid-email') {
      msg = 'Invalid email address format.';
    } else if (err.code === 'auth/weak-password') {
      msg = 'Password is too weak. Please use at least 6 characters.';
    }
    throw new Error(msg);
  }
}

/**
 * Register a Tour Guide (with Pending Verification)
 */
export async function registerGuide({ name, email, password, phone, country, languages, areas, experience }) {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const user = userCredential.user;

    // Send verification email
    try {
      await sendEmailVerification(user);
    } catch (e) {
      console.warn('Email verification dispatch notice:', e.message);
    }

    const firstName = name.split(' ')[0] || name;
    const lastName = name.split(' ').slice(1).join(' ') || '';

    // 1. User Account Record
    const userDoc = {
      uid: user.uid,
      email: user.email,
      firstName,
      lastName,
      phone: phone || '',
      country: country || 'Egypt',
      role: 'guide',
      status: 'pending',
      preferredLanguage: 'Arabic',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, COLLECTIONS.USERS, user.uid), userDoc);

    // 2. Guide Marketplace Profile Document tied strictly to currentUser.uid
    const guideDoc = {
      id: user.uid, // Strict 1:1 binding to Auth UID
      name: name.trim(),
      email: user.email,
      phone: phone || '',
      country: country || 'Egypt',
      verified: false,
      verificationStatus: 'pending', // Pending Admin Approval
      rating: 0,
      reviewsCount: 0,
      languages: Array.isArray(languages) ? languages : [languages],
      experienceYears: Number(experience) || 1,
      city: areas || 'Giza',
      currentLocationName: areas || 'Giza',
      isOnline: false,
      hourlyRate: 25,
      currency: 'USD',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=400&q=80',
      specialties: ['History', 'Local Experience'],
      about: 'New guide registration. Submitted government license documents pending verification.',
      packages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, COLLECTIONS.GUIDES, user.uid), guideDoc);

    cachedUserDoc = userDoc;
    return { user, profile: userDoc, guide: guideDoc };
  } catch (err) {
    let msg = err.message;
    if (err.code === 'auth/email-already-in-use') {
      msg = 'An account with this email already exists.';
    }
    throw new Error(msg);
  }
}

/**
 * Real Forgot Password via Firebase
 */
export async function sendResetPassword(email) {
  if (!email) {
    throw new Error('Please enter your email address.');
  }

  try {
    await sendPasswordResetEmail(auth, email.trim());
    return true;
  } catch (err) {
    let msg = 'Failed to send password reset email.';
    if (err.code === 'auth/user-not-found') {
      msg = 'No user found with this email address.';
    } else if (err.code === 'auth/invalid-email') {
      msg = 'Please provide a valid email address.';
    }
    throw new Error(msg);
  }
}

/**
 * Google Sign-In with Real Firebase Provider
 */
export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    const userRef = doc(db, COLLECTIONS.USERS, user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      const defaultRole = user.email === 'ma1044853@gmail.com' ? 'admin' : 'tourist';
      const newProfile = {
        uid: user.uid,
        email: user.email,
        firstName: user.displayName ? user.displayName.split(' ')[0] : 'Traveler',
        lastName: user.displayName ? user.displayName.split(' ').slice(1).join(' ') : '',
        role: defaultRole,
        status: 'active',
        country: 'International',
        phone: user.phoneNumber || '',
        preferredLanguage: 'English',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await setDoc(userRef, newProfile);
      cachedUserDoc = newProfile;
    } else {
      cachedUserDoc = userSnap.data();
    }

    return { user, profile: cachedUserDoc };
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user') {
      throw new Error('Sign in popup was closed before completion.');
    }
    throw new Error(err.message || 'Google authentication failed.');
  }
}

/**
 * Logout
 */
export async function logout() {
  try {
    await signOut(auth);
    cachedUserDoc = null;
    showToast(t('toasts.logoutSuccess'), 'info');
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 300);
  } catch (err) {
    console.error('Logout error:', err);
  }
}

/**
 * Redirect according to authenticated user role
 */
export function redirectByRole(profile) {
  if (!profile) {
    window.location.href = '/login.html';
    return;
  }

  if (profile.role === 'guide') {
    window.location.href = '/guide/index.html';
  } else if (profile.role === 'admin') {
    window.location.href = '/admin/index.html';
  } else {
    window.location.href = '/tourist/index.html';
  }
}

/**
 * Route Protection Guard
 * Checks current auth status and role, redirects if unauthorized
 */
export function enforceRouteProtection({ allowedRoles = ['tourist', 'guide', 'admin'] } = {}) {
  onAuthReady((firebaseUser, profile) => {
    const currentPath = window.location.pathname;

    // Unauthenticated protection
    if (!firebaseUser) {
      showToast(t('toasts.authRequired'), 'info');
      setTimeout(() => {
        window.location.href = `/login.html?redirect=${encodeURIComponent(currentPath)}`;
      }, 400);
      return;
    }

    const role = profile?.role || 'tourist';

    // Role-based restrictions
    if (!allowedRoles.includes(role)) {
      showToast(t('toasts.accessDenied', { role }), 'error');
      setTimeout(() => {
        if (role === 'tourist') window.location.href = '/tourist/index.html';
        else if (role === 'guide') window.location.href = '/guide/index.html';
        else window.location.href = '/admin/index.html';
      }, 500);
    }
  });
}

/**
 * Update Header with Auth State and Language Toggle
 */
export function updateUIForAuth() {
  const user = getCurrentUser();
  const headerActions = document.querySelector('.header-actions');
  if (!headerActions) return;

  const currentLang = localStorage.getItem('tourguide_lang') || 'en';
  const nextLangLabel = currentLang === 'en' ? 'العربية' : 'English';
  const langBtnHtml = `
    <button class="lang-toggle-btn" title="${currentLang === 'en' ? 'التحويل إلى العربية' : 'Switch to English'}" aria-label="Toggle language">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
      <span class="lang-label">${nextLangLabel}</span>
    </button>
  `;
  
  if (user) {
    const roleLabel = user.role === 'admin' ? t('brand.adminBadge') : user.role === 'guide' ? t('brand.captainBadge') : t('touristProfile.memberBadge');
    headerActions.innerHTML = `
      ${langBtnHtml}
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">${user.firstName || user.email} (${roleLabel})</span>
        <button id="logoutBtn" class="btn btn-outline btn-sm" style="font-size: 0.75rem; padding: 4px 8px; min-height: 32px;">${t('nav.logout')}</button>
      </div>
    `;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
    }
  } else {
    headerActions.innerHTML = `
      ${langBtnHtml}
      <a href="/login.html" class="btn btn-secondary btn-sm">${t('nav.login')}</a>
      <a href="/register.html" class="btn btn-primary btn-sm">${t('nav.register')}</a>
    `;
  }

  // Bind toggle action
  headerActions.querySelectorAll('.lang-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const current = localStorage.getItem('tourguide_lang') || 'en';
      const next = current === 'en' ? 'ar' : 'en';
      import('./utils.js').then(u => u.setActiveLang(next));
    });
  });
}

// Re-render header actions when language changes
if (typeof document !== 'undefined') {
  document.addEventListener('tourguide:langchange', () => {
    updateUIForAuth();
  });
}

