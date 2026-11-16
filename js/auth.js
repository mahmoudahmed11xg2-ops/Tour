/**
 * TourGuide — Production Firebase Authentication & Role-Isolated Route Guard
 * Real Email/Password, Google Sign-in, Password Reset, Email Verification & Role Redirects.
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
  setDoc
} from 'firebase/firestore';
import {
  showToast,
  t,
  appUrl,
  DEFAULT_AVATAR_PATH,
  setupLanguageToggle,
  escapeHtml
} from './utils.js';

let cachedUserDoc = null;
let isAuthReady = false;
const authReadyListeners = [];

export function onAuthReady(callback) {
  if (isAuthReady) {
    callback(auth.currentUser, cachedUserDoc);
  } else {
    authReadyListeners.push(callback);
  }
}

async function resolveAccountProfile(firebaseUser) {
  const userRef = doc(db, COLLECTIONS.USERS, firebaseUser.uid);
  const userSnap = await getDoc(userRef);

  // Also check explicit /admins/{uid} registry managed outside self-signup
  let isRegisteredAdmin = false;
  try {
    const adminSnap = await getDoc(doc(db, COLLECTIONS.ADMINS, firebaseUser.uid));
    isRegisteredAdmin = adminSnap.exists();
  } catch (e) {
    // Non-admins receive permission-denied on unrelated reads; ignore silently on missing doc
  }

  if (userSnap.exists()) {
    const data = userSnap.data();
    return isRegisteredAdmin ? { ...data, role: 'admin' } : data;
  }

  const newProfile = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    firstName: firebaseUser.displayName ? firebaseUser.displayName.split(' ')[0] : t('touristProfile.memberBadge'),
    lastName: firebaseUser.displayName ? firebaseUser.displayName.split(' ').slice(1).join(' ') : '',
    role: isRegisteredAdmin ? 'admin' : 'tourist',
    status: 'active',
    country: 'Egypt',
    phone: firebaseUser.phoneNumber || '',
    preferredLanguage: 'English',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await setDoc(userRef, newProfile);
  return newProfile;
}

onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    try {
      cachedUserDoc = await resolveAccountProfile(firebaseUser);
    } catch (err) {
      console.error('Error fetching user profile:', err);
    }
  } else {
    cachedUserDoc = null;
  }

  isAuthReady = true;
  updateUIForAuth();

  while (authReadyListeners.length > 0) {
    const fn = authReadyListeners.shift();
    fn(firebaseUser, cachedUserDoc);
  }
});

export function getCurrentUser() {
  if (!auth.currentUser) return null;
  return {
    ...auth.currentUser,
    ...cachedUserDoc,
    uid: auth.currentUser.uid,
    email: auth.currentUser.email
  };
}

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

export async function login(email, password) {
  if (!email || !password) {
    throw new Error(t('auth.errMissingCreds'));
  }

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
    cachedUserDoc = await resolveAccountProfile(userCredential.user);

    return {
      user: userCredential.user,
      profile: cachedUserDoc
    };
  } catch (err) {
    let friendlyMessage = t('auth.errLoginFailed');
    if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
      friendlyMessage = t('auth.errInvalidCreds');
    } else if (err.code === 'auth/user-not-found') {
      friendlyMessage = t('auth.errUserNotFound');
    } else if (err.code === 'auth/too-many-requests') {
      friendlyMessage = t('auth.errTooManyRequests');
    } else if (err.code === 'auth/invalid-email') {
      friendlyMessage = t('auth.errInvalidEmail');
    }
    throw new Error(friendlyMessage);
  }
}

export async function registerTourist({ firstName, lastName, email, password, country, phone, preferredLanguage }) {
  if (!email || !password) {
    throw new Error(t('auth.errEmailPasswordRequired'));
  }
  if (password.length < 6) {
    throw new Error(t('auth.errPasswordMin'));
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const user = userCredential.user;

    try {
      await sendEmailVerification(user);
    } catch (e) {
      console.warn('Email verification dispatch notice:', e.message);
    }

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
      msg = t('auth.errEmailInUse');
    } else if (err.code === 'auth/invalid-email') {
      msg = t('auth.errInvalidEmail');
    } else if (err.code === 'auth/weak-password') {
      msg = t('auth.errWeakPassword');
    }
    throw new Error(msg);
  }
}

export async function registerGuide({ name, email, password, phone, country, languages, areas, experience }) {
  if (!email || !password) {
    throw new Error(t('auth.errEmailPasswordRequired'));
  }
  if (password.length < 6) {
    throw new Error(t('auth.errPasswordMin'));
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const user = userCredential.user;

    try {
      await sendEmailVerification(user);
    } catch (e) {
      console.warn('Email verification dispatch notice:', e.message);
    }

    const firstName = name.split(' ')[0] || name;
    const lastName = name.split(' ').slice(1).join(' ') || '';

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

    const guideDoc = {
      id: user.uid,
      name: name.trim(),
      email: user.email,
      phone: phone || '',
      country: country || 'Egypt',
      verified: false,
      verificationStatus: 'pending',
      rating: 0,
      reviewsCount: 0,
      languages: Array.isArray(languages) ? languages : [languages],
      experienceYears: Number(experience) || 1,
      city: areas || 'Giza',
      currentLocationName: areas || 'Giza',
      isOnline: false,
      hourlyRate: 25,
      currency: 'USD',
      avatar: DEFAULT_AVATAR_PATH,
      specialties: ['History', 'Local Experience'],
      about: 'New guide registration. License credentials submitted and awaiting operations verification.',
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
      msg = t('auth.errEmailInUse');
    } else if (err.code === 'auth/invalid-email') {
      msg = t('auth.errInvalidEmail');
    } else if (err.code === 'auth/weak-password') {
      msg = t('auth.errWeakPassword');
    }
    throw new Error(msg);
  }
}

export async function sendResetPassword(email) {
  if (!email) {
    throw new Error(t('auth.errResetEmailRequired'));
  }

  try {
    await sendPasswordResetEmail(auth, email.trim());
    return true;
  } catch (err) {
    let msg = t('auth.errResetFailed');
    if (err.code === 'auth/user-not-found') {
      msg = t('auth.errUserNotFound');
    } else if (err.code === 'auth/invalid-email') {
      msg = t('auth.errInvalidEmail');
    }
    throw new Error(msg);
  }
}

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    cachedUserDoc = await resolveAccountProfile(user);

    return { user, profile: cachedUserDoc };
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user') {
      throw new Error(t('auth.errPopupClosed'));
    }
    throw new Error(err.message || t('auth.errGoogleFailed'));
  }
}

export async function logout() {
  try {
    await signOut(auth);
    cachedUserDoc = null;
    showToast(t('toasts.logoutSuccess'), 'info');
    setTimeout(() => {
      window.location.href = appUrl('login.html');
    }, 280);
  } catch (err) {
    console.error('Logout error:', err);
  }
}

export function getDashboardUrlForRole(role) {
  if (role === 'guide') return appUrl('guide/index.html');
  if (role === 'admin') return appUrl('admin/index.html');
  return appUrl('tourist/index.html');
}

export function redirectByRole(profile) {
  if (!profile) {
    window.location.href = appUrl('login.html');
    return;
  }
  window.location.href = getDashboardUrlForRole(profile.role);
}

/**
 * Role-isolated Route Protection Guard
 */
export function enforceRouteProtection({ allowedRoles = ['tourist', 'guide', 'admin'] } = {}) {
  onAuthReady((firebaseUser, profile) => {
    const currentHref = window.location.href;

    if (!firebaseUser) {
      showToast(t('toasts.authRequired'), 'info');
      setTimeout(() => {
        window.location.href = `${appUrl('login.html')}?redirect=${encodeURIComponent(currentHref)}`;
      }, 250);
      return;
    }

    const role = profile?.role || 'tourist';

    if (!allowedRoles.includes(role)) {
      showToast(t('toasts.accessDenied', { role }), 'error');
      setTimeout(() => {
        window.location.href = getDashboardUrlForRole(role);
      }, 350);
    } else {
      document.documentElement.dataset.authVerified = 'true';
    }
  });
}

/**
 * Update ONLY auth-specific controls inside header without touching the persistent language toggle
 */
export function updateUIForAuth() {
  const user = getCurrentUser();
  const headerActions = document.querySelector('.header-actions');
  if (headerActions) {
    let authSlot = headerActions.querySelector('#authHeaderSlot');
    if (!authSlot) {
      authSlot = document.createElement('span');
      authSlot.id = 'authHeaderSlot';
      authSlot.className = 'auth-header-slot';
      headerActions.appendChild(authSlot);
    }

    const isPublicPage = document.body?.dataset?.surface === 'public';

    if (user) {
      const displayName = escapeHtml(user.firstName || user.email?.split('@')[0] || '');
      const dashUrl = getDashboardUrlForRole(user.role || 'tourist');
      authSlot.innerHTML = isPublicPage
        ? `<a href="${dashUrl}" class="btn btn-primary btn-sm hide-mobile">${escapeHtml(t('nav.dashboard'))}</a>`
        : `<span class="user-chip hide-mobile">${displayName}</span>
           <button type="button" id="logoutBtn" class="btn btn-outline btn-sm hide-mobile">${escapeHtml(t('nav.logout'))}</button>`;

      document.getElementById('logoutBtn')?.addEventListener('click', logout);
    } else {
      authSlot.innerHTML = `
        <a href="${appUrl('login.html')}" class="btn btn-ghost btn-sm hide-mobile">${escapeHtml(t('nav.login'))}</a>
        <a href="${appUrl('register.html')}" class="btn btn-primary btn-sm hide-mobile">${escapeHtml(t('nav.getStarted'))}</a>
      `;
    }
  }

  // Update mobile drawer auth slot if present
  const drawerAuth = document.getElementById('drawerAuthSlot');
  if (drawerAuth) {
    if (user) {
      drawerAuth.innerHTML = `
        <button type="button" id="drawerLogoutBtn" class="btn btn-outline btn-block">${escapeHtml(t('nav.logout'))}</button>
      `;
      document.getElementById('drawerLogoutBtn')?.addEventListener('click', logout);
    } else {
      drawerAuth.innerHTML = `
        <a href="${appUrl('login.html')}" class="btn btn-outline btn-block">${escapeHtml(t('nav.login'))}</a>
        <a href="${appUrl('register.html')}" class="btn btn-primary btn-block">${escapeHtml(t('nav.getStarted'))}</a>
      `;
    }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('tourguide:langchange', () => {
    updateUIForAuth();
  });
}
