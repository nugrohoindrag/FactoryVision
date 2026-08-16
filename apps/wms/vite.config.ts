import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // PWA only — no Capacitor, no APK (Tech Stack §2.7).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'FactoryVision WMS',
        short_name: 'FactoryVision',
        description: 'Warehouse management for factories',
        theme_color: '#2563EB',
        background_color: '#F8FAFC',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Fonts are precached: a warehouse with no signal must still get Inter,
        // or the type hierarchy collapses exactly where legibility matters most
        // (Tech Stack §2.5).
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        // SheetJS is half a megabyte and only K06 ever needs it. Precaching it
        // would spend that on every operator's first launch over 3G, for a
        // screen most of them never open. It is cached on first use instead.
        globIgnores: ['**/xlsx-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/xlsx-.*\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'sheetjs', expiration: { maxEntries: 2 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Take control of the page on the FIRST load, not the second.
        //
        // Without these, the service worker sits waiting until the next visit,
        // so an operator who opens the app and immediately walks into a
        // concrete warehouse cannot load any route chunk they have not already
        // visited. For an app whose entire premise is working offline, waiting
        // for a second visit is not acceptable.
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
    mode === 'analyze' &&
      visualizer({ filename: 'stats.html', gzipSize: true, open: false }),
  ].filter(Boolean),

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    // Android 12+ baseline (Tech Stack §4). iOS is deliberately out of scope.
    target: ['chrome100'],
    sourcemap: mode !== 'production',
    rollupOptions: {
      output: {
        /**
         * Chunking is tuned for ROUND TRIPS, not for chunk count.
         *
         * On 3G every additional chunk on the critical path costs ~150ms of
         * latency before a single byte arrives. Rollup's default splitting
         * produced a dozen tiny shared chunks (card, progress, format,
         * QuantityInput…), each one its own round trip, and the stock screen
         * missed the 2-second budget by 400ms because of it.
         *
         * So shared UI primitives and domain logic are deliberately kept in ONE
         * chunk that every route needs anyway. Screens stay separate, because
         * an operator should not download the Excel wizard to receive goods.
         */
        manualChunks(id) {
          const normalised = id.replace(/\\/g, '/');

          if (normalised.includes('node_modules')) {
            // Matched on the package DIRECTORY, not a substring of the path —
            // `/react/` and `react-day-picker` are very different things, and
            // matching loosely dragged the whole calendar into the entry.
            if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(normalised)) {
              return 'react';
            }
            if (/node_modules\/dexie/.test(normalised)) return 'db';
            if (/node_modules\/xlsx/.test(normalised)) return 'xlsx';
            // Everything else stays with whichever route imports it, so a
            // date picker is only downloaded by screens that show one.
            return undefined;
          }
          // `shared` holds only what EVERY route needs: the shells, the four
          // mandatory screen states, the terminology and config layers, and the
          // domain calculations. Deliberately NOT the domain components or
          // `lib/excel` — pulling those in put the Excel import definitions and
          // a variance table into the bundle of an operator receiving goods,
          // and blew the 200KB entry budget by 30KB.
          if (
            normalised.includes('/components/layout/') ||
            normalised.includes('/packages/domain/') ||
            normalised.includes('/packages/contracts/') ||
            normalised.includes('/src/lib/terms/') ||
            normalised.includes('/src/lib/config/') ||
            normalised.includes('/src/lib/utils') ||
            normalised.includes('/src/lib/buildMode') ||
            normalised.includes('/src/db/')
          ) {
            return 'shared';
          }
          return undefined;
        },
      },
    },
  },

  server: { port: 5173, host: true },
  preview: { port: 4173 },
}));
