/**
 * TourGuide — Production Firebase Authentication & Role-Isolated Route Guard
 * Real Email/Password, Google Sign-in, Password Reset, Email Verification,
 * Tourist/Guide profile synchronization, Suspended Account Blocking,
 * and Request-Based Account Deletion Lifecycle.
 */

import {
  auth,
  db,
  COLLECTIONS,
  isFirebaseConfigured,
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
  updateDoc,
  addDoc,
  collection
} from 'firebase/firestore';
import {
  showToast,
  t,
  appUrl,
  DEFAULT_AVATAR_PATH,
  escapeHtml
} from './utils.js';

let cachedUserDoc = null;
let isAuthReady = false;
const authReadyListeners = [];

export function onAuthReady(callback) {
  if (!isFirebaseConfigured()) {
    isAuthReady = true;
    cachedUserDoc = null;
    updateUIForAuth();
    callback(null, null);
    return;
  }

  if (isAuthReady) {
    callback(auth.currentUser, cachedUserDoc);
  } else {
    authReadyListeners.push(callback);
  }
}

async function ensureTouristRecord(uid, preferredLanguage = 'English') {
  const touristRef = doc(db, COLLECTIONS.TOURISTS, uid);
  const snap = await getDoc(touristRef);
  if (!snap.exists()) {
    const nowIso = new Date().toISOString();
    await setDoc(touristRef, {
      uid,
      userId: uid,
      travelPreferences: [],
      preferredLanguages: [preferredLanguage || 'English'],
      favoriteDestinations: [],
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }
}

async function resolveAccountProfile(firebaseUser) {
  const userRef = doc(db, COLLECTIONS.USERS, firebaseUser.uid);
  const userSnap = await getDoc(userRef);

  // Admins are controlled solely via /admins/{uid} managed outside client self-signup
  let isRegisteredAdmin = false;
  try {
    const adminSnap = await getDoc(doc(db, COLLECTIONS.ADMINS, firebaseUser.uid));
    isRegisteredAdmin = adminSnap.exists();
  } catch (e) {
    // Expected for non-admins or missing admin doc
  }

  if (userSnap.exists()) {
    const data = userSnap.data();
    return isRegisteredAdmin ? { ...data, role: 'admin', status: data.status || 'active' } : data;
  }

  const nowIso = new Date().toISOString();
  const role = isRegisteredAdmin ? 'admin' : 'tourist';
  const newProfile = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    firstName: firebaseUser.displayName ? firebaseUser.displayName.split(' ')[0] : t('touristProfile.memberBadge'),
    lastName: firebaseUser.displayName ? firebaseUser.displayName.split(' ').slice(1).join(' ') : '',
    role,
    status: 'active',
    country: 'Egypt',
    phone: firebaseUser.phoneNumber || '',
    preferredLanguage: 'English',
    photoURL: firebaseUser.photoURL || '',
    createdAt: nowIso,
    updatedAt: nowIso
  };
  await setDoc(userRef, newProfile);

  if (role === 'tourist') {
    await ensureTouristRecord(firebaseUser.uid, newProfile.preferredLanguage);
  }

  return newProfile;
}

if (isFirebaseConfigured()) {
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
}

export function getCurrentUser() {
  if (!isFirebaseConfigured() || !auth.currentUser) return null;
  return {
    ...auth.currentUser,
    ...cachedUserDoc,
    uid: auth.currentUser.uid,
    email: auth.currentUser.email
  };
}

export async function getCurrentUserProfile() {
  if (!isFirebaseConfigured() || !auth.currentUser) return null;
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

function assertAccountActive(profile) {
  if (!profile) return;
  if (profile.status === 'suspended') {
    throw new Error(t('auth.errAccountSuspended'));
  }
  if (profile.status === 'deletion_requested') {
    throw new Error(t('auth.errAccountDeletionPending'));
  }
}

export async function login(email, password) {
  if (!isFirebaseConfigured()) {
    throw new Error(t('auth.errFirebaseNotConfigured'));
  }
  if (!email || !password) {
    throw new Error(t('auth.errMissingCreds'));
  }

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
    const profile = await resolveAccountProfile(userCredential.user);
    if (profile?.status === 'suspended' || profile?.status === 'deletion_requested') {
      await signOut(auth);
      cachedUserDoc = null;
      assertAccountActive(profile);
    }
    cachedUserDoc = profile;

    return {
      user: userCredential.user,
      profile: cachedUserDoc
    };
  } catch (err) {
    if (err.message === t('auth.errAccountSuspended') || err.message === t('auth.errAccountDeletionPending')) {
      throw err;
    }
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
  if (!isFirebaseConfigured()) {
    throw new Error(t('auth.errFirebaseNotConfigured'));
  }
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

    const nowIso = new Date().toISOString();
    const cleanFirst = (firstName || '').trim();
    const cleanLast = (lastName || '').trim();
    const cleanLang = preferredLanguage || 'English';

    const userDoc = {
      uid: user.uid,
      email: user.email,
      firstName: cleanFirst,
      lastName: cleanLast,
      phone: phone ? phone.trim() : '',
      country: country || 'International',
      role: 'tourist',
      status: 'active',
      preferredLanguage: cleanLang,
      photoURL: user.photoURL || '',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    await setDoc(doc(db, COLLECTIONS.USERS, user.uid), userDoc);

    const touristDoc = {
      uid: user.uid,
      userId: user.uid,
      travelPreferences: [],
      preferredLanguages: [cleanLang],
      favoriteDestinations: [],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    await setDoc(doc(db, COLLECTIONS.TOURISTS, user.uid), touristDoc);

    await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
      action: 'TOURIST_REGISTERED',
      actorId: user.uid,
      targetId: user.uid,
      timestamp: nowIso
    });

    cachedUserDoc = userDoc;
    return { user, profile: userDoc, tourist: touristDoc };
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
  if (!isFirebaseConfigured()) {
    throw new Error(t('auth.errFirebaseNotConfigured'));
  }
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

    const nowIso = new Date().toISOString();
    const cleanName = (name || '').trim();
    const firstName = cleanName.split(' ')[0] || cleanName;
    const lastName = cleanName.split(' ').slice(1).join(' ') || '';
    const areaList = String(areas || 'Giza').split(',').map(s => s.trim()).filter(Boolean);
    const primaryCity = areaList[0] || 'Giza';
    const bioText = 'New guide registration. License credentials submitted and awaiting operations verification.';

    const userDoc = {
      uid: user.uid,
      email: user.email,
      firstName,
      lastName,
      phone: phone ? phone.trim() : '',
      country: country || 'Egypt',
      role: 'guide',
      status: 'pending',
      preferredLanguage: 'Arabic',
      photoURL: DEFAULT_AVATAR_PATH,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    await setDoc(doc(db, COLLECTIONS.USERS, user.uid), userDoc);

    const guideDoc = {
      id: user.uid,
      uid: user.uid,
      userId: user.uid,
      firstName,
      lastName,
      name: cleanName,
      email: user.email,
      phone: phone ? phone.trim() : '',
      country: country || 'Egypt',
      photoURL: DEFAULT_AVATAR_PATH,
      avatar: DEFAULT_AVATAR_PATH,
      bio: bioText,
      about: bioText,
      languages: Array.isArray(languages) ? languages : [languages],
      specialties: ['History', 'Local Experience'],
      cities: areaList.length ? areaList : [primaryCity],
      city: primaryCity,
      serviceAreas: areaList.length ? areaList : [primaryCity],
      currentLocationName: primaryCity,
      hourlyRate: 25,
      currency: 'USD',
      experienceYears: Number(experience) || 1,
      verificationStatus: 'pending',
      isApproved: false,
      verified: false,
      isOnline: false,
      instantAvailable: true,
      rating: 0,
      reviewCount: 0,
      reviewsCount: 0,
      packages: [],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    await setDoc(doc(db, COLLECTIONS.GUIDES, user.uid), guideDoc);

    await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
      action: 'GUIDE_REGISTERED',
      actorId: user.uid,
      targetId: user.uid,
      timestamp: nowIso
    });

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
  if (!isFirebaseConfigured()) {
    throw new Error(t('auth.errFirebaseNotConfigured'));
  }
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
  if (!isFirebaseConfigured()) {
    throw new Error(t('auth.errFirebaseNotConfigured'));
  }
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const profile = await resolveAccountProfile(user);
    if (profile?.status === 'suspended' || profile?.status === 'deletion_requested') {
      await signOut(auth);
      cachedUserDoc = null;
      assertAccountActive(profile);
    }
    cachedUserDoc = profile;

    return { user, profile: cachedUserDoc };
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user') {
      throw new Error(t('auth.errPopupClosed'));
    }
    throw new Error(err.message || t('auth.errGoogleFailed'));
  }
}

export async function requestAccountDeletion(reason = 'User requested account deletion') {
  if (!isFirebaseConfigured() || !auth.currentUser) {
    throw new Error(t('auth.errFirebaseNotConfigured'));
  }
  const uid = auth.currentUser.uid;
  const nowIso = new Date().toISOString();

  await updateDoc(doc(db, COLLECTIONS.USERS, uid), {
    status: 'deletion_requested',
    deletionRequestedAt: nowIso,
    updatedAt: nowIso
  });

  if (cachedUserDoc?.role === 'guide') {
    await updateDoc(doc(db, COLLECTIONS.GUIDES, uid), {
      isOnline: false,
      updatedAt: nowIso
    });
  }

  await addDoc(collection(db, COLLECTIONS.AUDIT_LOGS), {
    action: 'ACCOUNT_DELETION_REQUESTED',
    actorId: uid,
    targetId: uid,
    timestamp: nowIso,
    notes: String(reason || '').slice(0, 300)
  });

  await signOut(auth);
  cachedUserDoc = null;
  return true;
}

export async function logout() {
  try {
    if (isFirebaseConfigured()) {
      await signOut(auth);
    }
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
 * Role-isolated & account-status-enforced Route Protection Guard
 */
export function enforceRouteProtection({ allowedRoles = ['tourist', 'guide', 'admin'] } = {}) {
  onAuthReady(async (firebaseUser, profile) => {
    const currentHref = window.location.href;

    if (!firebaseUser) {
      showToast(t('toasts.authRequired'), 'info');
      setTimeout(() => {
        window.location.href = `${appUrl('login.html')}?redirect=${encodeURIComponent(currentHref)}`;
      }, 250);
      return;
    }

    if (profile?.status === 'suspended' || profile?.status === 'deletion_requested') {
      const msgKey = profile.status === 'suspended' ? 'auth.errAccountSuspended' : 'auth.errAccountDeletionPending';
      showToast(t(msgKey), 'error');
      await signOut(auth);
      cachedUserDoc = null;
      setTimeout(() => {
        window.location.href = appUrl('login.html');
      }, 350);
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
