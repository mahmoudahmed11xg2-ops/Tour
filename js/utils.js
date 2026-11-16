/**
 * TourGuide — Utilities, Relative Path Resolver, Accessible Modals & Bilingual i18n Engine
 * Supports English (LTR) & Arabic (RTL) dynamically across all routes.
 */

import en from './locales/en.js';
import ar from './locales/ar.js';

export const TRANSLATIONS = { en, ar };

export const DEFAULT_AVATAR_PATH = 'assets/images/guide_portrait_ahmed_1794430336207.jpg';
export const FALLBACK_AVATAR_FEMALE = 'assets/images/guide_portrait_sarah_1794430334163.jpg';

/**
 * Resolve root base URL cleanly for root and GitHub Pages subpath hosting
 */
export function getAppBase() {
  if (typeof window === 'undefined') return '/';
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="app-root"]');
    if (meta && meta.content) {
      return new URL(meta.content, window.location.href).href;
    }
  }
  const p = window.location.pathname;
  const match = p.match(/^(.*\/)(tourist|guide|admin)\/[^/]*$/);
  if (match) return `${window.location.origin}${match[1]}`;
  const dir = p.endsWith('/') ? p : p.substring(0, p.lastIndexOf('/') + 1);
  return `${window.location.origin}${dir}`;
}

/**
 * Build a full relative-safe URL within the application
 */
export function appUrl(relativePath = '') {
  const clean = String(relativePath || '').replace(/^\/+/, '');
  return new URL(clean, getAppBase()).href;
}

/**
 * Escape HTML characters to prevent XSS in template strings
 */
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resolve any guide/user avatar into a reliable local image asset URL
 */
export function resolveAvatar(url, name = '') {
  const s = String(url || '').trim();
  if (!s || s.includes('unsplash.com') || s.includes('picsum.photos') || s.includes('placeholder')) {
    const lowerName = String(name || '').toLowerCase();
    if (lowerName.includes('sarah') || lowerName.includes('elena') || lowerName.includes('sara')) {
      return appUrl(FALLBACK_AVATAR_FEMALE);
    }
    return appUrl(DEFAULT_AVATAR_PATH);
  }
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;
  return appUrl(s);
}

/**
 * Get active language from localStorage with fallback to 'en'
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
 * Switch active language and update HTML lang/dir and DOM
 */
export function setActiveLang(lang) {
  const targetLang = lang === 'ar' ? 'ar' : 'en';
  try {
    localStorage.setItem('tourguide_lang', targetLang);
  } catch (e) {
    console.warn('Storage write failed:', e);
  }

  applyTranslations(targetLang);

  document.dispatchEvent(new CustomEvent('tourguide:langchange', {
    detail: { lang: targetLang }
  }));
}

function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  if (obj[path] !== undefined) return obj[path];
  return path.split('.').reduce((curr, key) => (curr && curr[key] !== undefined ? curr[key] : undefined), obj);
}

/**
 * Core translation function with parameter interpolation: {param}
 */
export function t(key, params = {}) {
  const lang = getActiveLang();

  let val = resolvePath(TRANSLATIONS[lang], key);
  if (val === undefined && lang !== 'en') {
    val = resolvePath(TRANSLATIONS.en, key);
  }
  if (val === undefined) {
    val = TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en?.[key] || key;
  }

  if (typeof val === 'string' && params && typeof params === 'object') {
    return val.replace(/\{(\w+)\}/g, (match, p) => (params[p] !== undefined ? params[p] : match));
  }

  return typeof val === 'string' ? val : key;
}

/**
 * Translate booking lifecycle or guide verification status
 */
export function getLocalizedStatus(status, context = 'booking') {
  if (!status) return '';

  if (context === 'guide') {
    const guideMap = {
      pending: 'guide.pendingVerificationBadge',
      under_review: 'guide.pendingVerificationBadge',
      approved: 'guide.verifiedApprovedBadge',
      rejected: 'guide.rejectedBadge',
      suspended: 'guide.rejectedBadge',
    };
    const gKey = guideMap[status];
    return gKey ? t(gKey) : status;
  }

  const bookingMap = {
    pending: 'booking.status.pending',
    accepted: 'booking.status.accepted',
    confirmed: 'booking.status.confirmed',
    guide_arriving: 'booking.status.guide_arriving',
    meeting_started: 'booking.status.meeting_started',
    in_progress: 'booking.status.in_progress',
    completed: 'booking.status.completed',
    cancelled: 'booking.status.cancelled',
    rejected: 'booking.status.rejected',
    expired: 'booking.status.expired',
    refunded: 'booking.status.refunded',
    disputed: 'booking.status.disputed',
    approved: 'guide.verifiedApprovedBadge',
    under_review: 'guide.pendingVerificationBadge',
  };

  const key = bookingMap[status];
  return key ? t(key) : status;
}

export function getTodayISODate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentTimeHHMM() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const rounded = Math.ceil(mins / 5) * 5;
  const h = Math.floor(rounded / 60) % 24;
  const m = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDuration(duration) {
  const num = typeof duration === 'number' ? duration : parseFloat(String(duration || '2'));
  const hours = Number.isFinite(num) && num > 0 ? num : 2;
  return t('search.hoursCount', { count: hours });
}

export function formatBookingDateTime(date, startTime, endTime) {
  const d = date || getTodayISODate();
  if (startTime && endTime) return `${d} · ${startTime} – ${endTime}`;
  if (startTime) return `${d} · ${startTime}`;
  return d;
}

export function getLocalizedRole(role) {
  if (role === 'admin') return t('brand.adminBadge');
  if (role === 'guide') return t('brand.captainBadge');
  return t('touristProfile.memberBadge');
}

export function getLocalizedWeekday(dayKey) {
  const k = String(dayKey || '').toLowerCase();
  const res = t(`weekdays.${k}`);
  return res !== `weekdays.${k}` ? res : dayKey;
}

/**
 * Scan DOM and apply translations to data-i18n attributes
 */
export function applyTranslations(lang = getActiveLang()) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const translated = t(key);
    if (translated && translated !== key) {
      el.textContent = translated;
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) return;
    const translated = t(key);
    if (translated && translated !== key) {
      el.setAttribute('placeholder', translated);
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (!key) return;
    const translated = t(key);
    if (translated && translated !== key) {
      el.setAttribute('title', translated);
    }
  });

  document.querySelectorAll('[data-i18n-value]').forEach(el => {
    const key = el.getAttribute('data-i18n-value');
    if (!key) return;
    const translated = t(key);
    if (translated && translated !== key) {
      el.value = translated;
    }
  });

  updateLanguageToggleButtons(lang);
}

export function updateLanguageToggleButtons(currentLang = getActiveLang()) {
  document.querySelectorAll('.lang-toggle-btn').forEach(btn => {
    const label = btn.querySelector('.lang-label') || btn.querySelector('#langLabel') || btn;
    if (label) {
      label.textContent = currentLang === 'en' ? 'العربية' : 'English';
    }
    const title = currentLang === 'en' ? 'التحويل إلى العربية' : 'Switch to English';
    btn.setAttribute('title', title);
    btn.setAttribute('aria-label', title);
  });
}

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

export function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
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
  }, 3400);
}

/**
 * Accessible In-App Confirmation Dialog (replaces native browser confirm())
 */
export function confirmModal({ title, message, confirmText = null, cancelText = null, danger = false } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');

    backdrop.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3 class="card-title">${escapeHtml(title || '')}</h3>
          <button type="button" class="modal-close-btn" aria-label="${escapeHtml(t('auth.close'))}">&times;</button>
        </div>
        <div class="modal-body">
          <p class="modal-copy">${escapeHtml(message || '')}</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline btn-sm modal-cancel-btn">${escapeHtml(cancelText || t('auth.cancel'))}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm modal-confirm-btn">${escapeHtml(confirmText || t('auth.confirm'))}</button>
        </div>
      </div>
    `;

    const cleanup = (result) => {
      backdrop.remove();
      resolve(result);
    };

    backdrop.querySelector('.modal-close-btn').addEventListener('click', () => cleanup(false));
    backdrop.querySelector('.modal-cancel-btn').addEventListener('click', () => cleanup(false));
    backdrop.querySelector('.modal-confirm-btn').addEventListener('click', () => cleanup(true));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup(false);
    });

    document.body.appendChild(backdrop);
  });
}

/**
 * Accessible In-App Information Modal (for Footer Help/Terms/Privacy/Contact links)
 */
export function showInfoModal(title, body) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h3 class="card-title">${escapeHtml(title)}</h3>
        <button type="button" class="modal-close-btn" aria-label="${escapeHtml(t('auth.close'))}">&times;</button>
      </div>
      <div class="modal-body">
        <p class="modal-copy">${escapeHtml(body)}</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary btn-sm modal-ok-btn">${escapeHtml(t('auth.close'))}</button>
      </div>
    </div>
  `;
  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close-btn').addEventListener('click', close);
  backdrop.querySelector('.modal-ok-btn').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.body.appendChild(backdrop);
}

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

export function getUrlParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

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
