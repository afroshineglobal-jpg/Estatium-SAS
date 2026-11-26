import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',          // new versions wait until the user taps "Update" (UpdateBanner)
      devOptions: { enabled: true },   // ← enables PWA install prompt in dev mode
      manifest: false,                  // ← use our own /public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        cleanupOutdatedCaches: true,
        importScripts: ['/push-sw.js'],      // Web Push handler (visitor / chat / emergency styles)
        // API responses are per-user (bills, visitors, residents) and must NEVER be stored in the
        // browser cache: on a shared phone the next user could be served the previous user's data.
        // Offline = cached app shell plus an offline banner; data always comes from the network.
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
      }
    })
  ],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true }
    }
  }
});
