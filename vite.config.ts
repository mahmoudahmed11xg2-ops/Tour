import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          login: path.resolve(__dirname, 'login.html'),
          register: path.resolve(__dirname, 'register.html'),
          tourist_home: path.resolve(__dirname, 'tourist/index.html'),
          tourist_explore: path.resolve(__dirname, 'tourist/explore.html'),
          tourist_bookings: path.resolve(__dirname, 'tourist/bookings.html'),
          tourist_booking: path.resolve(__dirname, 'tourist/booking.html'),
          tourist_profile: path.resolve(__dirname, 'tourist/profile.html'),
          guide_home: path.resolve(__dirname, 'guide/index.html'),
          guide_requests: path.resolve(__dirname, 'guide/requests.html'),
          guide_calendar: path.resolve(__dirname, 'guide/calendar.html'),
          guide_earnings: path.resolve(__dirname, 'guide/earnings.html'),
          guide_profile: path.resolve(__dirname, 'guide/profile.html'),
          admin_home: path.resolve(__dirname, 'admin/index.html'),
          admin_users: path.resolve(__dirname, 'admin/users.html'),
          admin_guides: path.resolve(__dirname, 'admin/guides.html'),
          admin_bookings: path.resolve(__dirname, 'admin/bookings.html'),
          admin_payments: path.resolve(__dirname, 'admin/payments.html'),
          admin_reports: path.resolve(__dirname, 'admin/reports.html'),
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
