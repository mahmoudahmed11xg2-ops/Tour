# TourGuide — Local Guide Marketplace

A bilingual (English / Arabic RTL) web platform connecting travelers with verified local tour guides for instant and scheduled experiences. Built cleanly with **HTML5**, **CSS3**, **Vanilla ES6+ JavaScript**, **Firebase Auth & Cloud Firestore**, and **Vite**.

## Architecture & Role Isolation

- **Public Website (`/`)**: Real landing page introducing the platform, how it works, verification trust standards, popular destinations, and role-tailored onboarding.
- **Authentication (`/login.html`, `/register.html`)**: Split desktop / compact mobile authentication with Email/Password, Google Sign-In, Password Reset, and a two-step role selection registration flow (Traveler or Tour Guide with verification-pending state).
- **Tourist App (`/tourist/`)**:
  - `index.html` — Streamlined mobile-first search ("Where are you going?" -> Now / Schedule -> Match)
  - `explore.html` — Filterable directory with mobile Bottom Sheet filter drawer
  - `bookings.html` & `booking.html` — Real-time booking status timeline, active tracking, cancellation, review & dispute flow
  - `messages.html` — Booking-scoped real-time messaging with assigned guides
  - `profile.html` — Guide public profile & booking scheduler, or Traveler profile view
- **Guide Console (`/guide/`)**:
  - `index.html` — Captain overview, verification status notice, online/offline availability toggle, live requests & active tour progression
  - `requests.html`, `calendar.html`, `earnings.html`, `messages.html`, `profile.html`
- **Admin Operations (`/admin/`)**:
  - `index.html`, `users.html`, `guides.html`, `bookings.html`, `payments.html`, `reports.html`, `settings.html`

## Local Development

```bash
npm install
npm run dev
```

Build static bundle (relative-path safe for root or GitHub Pages subpaths):

```bash
npm run build
```

Syntax-check all JavaScript modules:

```bash
npm run lint
```

## Mobile & Responsive Testing

Designed mobile-first starting from `360px` up to `1440px+` desktop layouts with CSS Logical Properties for full Arabic (`dir="rtl"`) and English (`dir="ltr"`) parity:

1. Open DevTools Device Toolbar (`Ctrl+Shift+M` / `Cmd+Shift+M`).
2. Verify `360×800`, `375×812`, `390×844`, `414×896`, `1280×800`, and `1440×900`.
3. Toggle between **English** and **العربية** in any header or mobile drawer to confirm RTL alignment and zero horizontal scrolling.
