import '@/styles/fonts.css';
import '@/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { App } from '@/App';
import { routes } from '@/app/routes';
import { seedDemoData } from '@/db/fixtures';
import { requestPersistentStorage } from '@/db/persist';

const router = createBrowserRouter([{ element: <App />, children: routes }]);

/**
 * Render FIRST, then set up storage.
 *
 * Nothing on screen depends on the storage-permission negotiation or on demo
 * seeding, and both are slow enough to matter: awaiting them before the first
 * render pushed the stock screen to the edge of its 2-second budget on 3G
 * (PRD §10). Every screen already handles `undefined` data as its loading
 * state, so they fill in as the database becomes ready.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

void (async () => {
  // Still requested before any transaction is written, which is what actually
  // matters — an operator's queue must not be evictable (Tech Stack §2.7a).
  const storage = await requestPersistentStorage();
  if (!storage.persisted && storage.supported) {
    // L03 turns this into a hard warning for the operator (T-046/T-047).
    console.warn('[fv] persistent storage denied — local data may be evicted');
  }

  // Demo master data in development, and in the build Playwright drives.
  // Never in a real customer build: nobody should find a "Demo factory" in
  // their own data.
  if (import.meta.env.DEV || import.meta.env.VITE_DEMO === '1') {
    await seedDemoData();
  }
})();
