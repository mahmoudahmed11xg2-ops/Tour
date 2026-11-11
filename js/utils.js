/**
 * TourGuide — Utilities & Centralized Internationalization (i18n) Engine
 * Full bilingual support (English & Arabic) with real RTL architecture.
 */

import en from './locales/en.js';
import ar from './locales/ar.js';

export const TRANSLATIONS = { en, ar };

/**
 * Get active language from localStorage with fallback to browser or 'en'
 */
export function getActiveLang() {
  try {
    const saved = localStorage.getItem('tourguide_lang');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch (e) {
    console.warn('Storage unavailable:', e);
  }
  return 'en';
}

/**
 * Switch active language and update HTML lang/dir and all translatable DOM elements
 */
export function setActiveLang(lang) {
  const targetLang = lang === 'ar' ? 'ar' : 'en';
  try {
    localStorage.setItem('tourguide_lang', targetLang);
  } catch (e) {
    console.warn('Storage write failed:', e);
  }

  applyTranslations(targetLang);

  // Dispatch custom event for components that need dynamic rerender
  document.dispatchEvent(new CustomEvent('tourguide:langchange', {
    detail: { lang: targetLang }
  }));
}

/**
 * Helper to resolve nested object path (e.g., 'booking.status.tourInProgress')
 */
function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  if (obj[path] !== undefined) return obj[path]; // Direct key match
  return path.split('.').reduce((curr, key) => (curr && curr[key] !== undefined ? curr[key] : undefined), obj);
}

/**
 * Core translation function with dot-notation lookup and parameter interpolation
 * Example: t('booking.summaryTitle') or t('toasts.loginSuccess', { name: 'Ahmed' })
 */
export function t(key, params = {}) {
  const lang = getActiveLang();
  
  // 1. Try target language
  let val = resolvePath(TRANSLATIONS[lang], key);
  
  // 2. Try English fallback
  if (val === undefined && lang !== 'en') {
    val = resolvePath(TRANSLATIONS['en'], key);
  }

  // 3. Flat legacy keys fallback
  if (val === undefined) {
    val = TRANSLATIONS[lang]?.[key] || TRANSLATIONS['en']?.[key] || key;
  }

  // Parameter interpolation: {param}
  if (typeof val === 'string' && params && typeof params === 'object') {
    return val.replace(/\{(\w+)\}/g, (match, p) => (params[p] !== undefined ? params[p] : match));
  }

  return typeof val === 'string' ? val : key;
}

/**
 * Translate booking lifecycle status string
 */
export function getLocalizedStatus(status) {
  const statusMap = {
    'Finding a Guide': 'booking.status.findingGuide',
    'Guide Found': 'booking.status.guideFound',
    'Guide Confirmed': 'booking.status.guideConfirmed',
    'Guide Arriving': 'booking.status.guideArriving',
    'Meeting Started': 'booking.status.meetingStarted',
    'Tour in Progress': 'booking.status.tourInProgress',
    'Tour Completed': 'booking.status.tourCompleted',
    'Cancelled': 'booking.status.cancelled',
    'pending': 'guide.pendingVerificationBadge',
    'approved': 'guide.verifiedApprovedBadge',
    'rejected': 'guide.rejectedBadge',
    'under_review': 'guide.pendingVerificationBadge'
  };

  const key = statusMap[status];
  return key ? t(key) : status;
}

/**
 * Translate user role
 */
export function getLocalizedRole(role) {
  if (role === 'admin') return t('brand.adminBadge');
  if (role === 'guide') return t('brand.captainBadge');
  return t('touristProfile.memberBadge');
}

/**
 * Scan DOM and apply translations to elements marked with data-i18n attributes
 */
export function applyTranslations(lang = getActiveLang()) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  // Static text translations
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const translated = t(key);
    if (translated && translated !== key) {
      el.textContent = translated;
    }
  });

  // Placeholder attributes
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) return;
    const translated = t(key);
    if (translated && translated !== key) {
      el.setAttribute('placeholder', translated);
    }
  });

  // Title / Tooltip attributes
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (!key) return;
    const translated = t(key);
    if (translated && translated !== key) {
      el.setAttribute('title', translated);
    }
  });

  // Form input values (e.g. submit buttons)
  document.querySelectorAll('[data-i18n-value]').forEach(el => {
    const key = el.getAttribute('data-i18n-value');
    if (!key) return;
    const translated = t(key);
    if (translated && translated !== key) {
      el.value = translated;
    }
  });

  // Update all language toggle buttons
  updateLanguageToggleButtons(lang);
}

/**
 * Update language toggle label across headers
 */
export function updateLanguageToggleButtons(currentLang = getActiveLang()) {
  document.querySelectorAll('.lang-toggle-btn').forEach(btn => {
    const label = btn.querySelector('.lang-label') || btn.querySelector('#langLabel') || btn;
    if (label) {
      label.textContent = currentLang === 'en' ? 'العربية' : 'English';
    }
    btn.setAttribute('title', currentLang === 'en' ? 'التحويل إلى العربية' : 'Switch to English');
    btn.setAttribute('aria-label', currentLang === 'en' ? 'التحويل إلى العربية' : 'Switch to English');
  });
}

/**
 * Standard Language Button Binder
 */
export function setupLanguageToggle() {
  document.querySelectorAll('.lang-toggle-btn').forEach(btn => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const current = getActiveLang();
      const next = current === 'en' ? 'ar' : 'en';
      setActiveLang(next);
      showToast(t('toasts.languageSwitched', { lang: next === 'ar' ? 'العربية' : 'English' }), 'info');
    });
  });
}

/**
 * Show clean toast notification with translation support
 */
export function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

/**
 * Format currency with localized unit
 */
export function formatCurrency(amount, currency = 'USD') {
  const lang = getActiveLang();
  if (currency === 'USD') {
    return lang === 'ar' ? `${amount} $` : `$${amount}`;
  }
  if (currency === 'EGP') {
    return lang === 'ar' ? `${amount} ج.م` : `${amount} EGP`;
  }
  return `${amount} ${currency}`;
}

/**
 * Get URL search param
 */
export function getUrlParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

// Auto-run on load
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyTranslations();
      setupLanguageToggle();
    });
  } else {
    applyTranslations();
    setupLanguageToggle();
  }
}
