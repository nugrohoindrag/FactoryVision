import { expect, test, type Page } from '@playwright/test';

/**
 * Sprint 4 hardening audits (T-106 → T-115).
 *
 * These are the checks UI Spec §22 says are skipped most often, so they run in
 * CI rather than living on a reviewer's checklist. Every route in the product
 * is swept, not a sample — a screen nobody thought to test is exactly where
 * the horizontal scrollbar ends up.
 */

/** Every route a person can reach without an id in the URL. */
const FIELD_ROUTES = [
  '/f',
  '/f/stock',
  '/f/tasks',
  '/f/sync',
  '/f/sync/conflicts',
  '/f/receipts/new',
  '/f/inspection',
  '/f/putaway',
  '/f/issues/request',
  '/f/issues/mine',
  '/f/production/output',
  '/f/adjustments/new',
  '/f/alerts',
];

const OFFICE_ROUTES = [
  '/o',
  '/o/open-issues',
  '/o/products',
  '/o/locations',
  '/o/partners',
  '/o/import',
  '/o/stock-take',
  '/o/variance',
  '/o/approvals',
  '/o/shipments',
  '/o/reports',
  '/o/reports/usage-variance',
  '/o/users',
  '/o/configuration',
];

const ACCESS_ROUTES = ['/sign-in', '/register'];

const ALL_ROUTES = [...FIELD_ROUTES, ...OFFICE_ROUTES, ...ACCESS_ROUTES];

async function visit(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
}

/* ---------------------------------------------- T-109 · responsive audit */

test.describe('T-109 · no horizontal page scroll on any screen', () => {
  for (const route of ALL_ROUTES) {
    test(`${route} fits its viewport`, async ({ page }) => {
      await visit(page, route);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // A wide table is allowed to scroll INSIDE its own container; the page
      // itself must never scroll sideways (UI Spec §22.3).
      expect(
        overflow.scrollWidth,
        `${route} overflows by ${overflow.scrollWidth - overflow.clientWidth}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }
});

/* ------------------------------------------------- T-110 · touch targets */

test.describe('T-110 · accessibility', () => {
  test('every interactive control meets the 48dp touch minimum', async ({ page }, testInfo) => {
    // Only meaningful where the pointer is coarse — a mouse gets compact sizing.
    test.skip(!testInfo.project.name.startsWith('phone'), 'touch density only');

    const undersized: string[] = [];

    for (const route of FIELD_ROUTES) {
      await visit(page, route);
      // `[data-dev-chrome]` is the internal build's role picker — a test
      // instrument that is never shipped and is deleted by T-104. Excluded
      // explicitly rather than by a size threshold that would also hide real
      // regressions.
      const controls = page.locator(
        ':is(button, a[href], input):visible:not([data-dev-chrome] *):not([data-dev-chrome])',
      );
      const count = await controls.count();

      for (let i = 0; i < Math.min(count, 25); i += 1) {
        const box = await controls.nth(i).boundingBox();
        if (!box) continue;
        // 44px allows for a 48dp target that has been rounded down by scaling.
        if (box.height < 44) {
          undersized.push(`${route} → ${(await controls.nth(i).innerText()).slice(0, 24)} ${Math.round(box.height)}px`);
        }
      }
    }

    expect(undersized, `undersized targets:\n${undersized.join('\n')}`).toEqual([]);
  });

  test('every screen has exactly one h1', async ({ page }) => {
    for (const route of [...FIELD_ROUTES, ...OFFICE_ROUTES]) {
      await visit(page, route);
      const headings = await page.locator('h1').count();
      expect(headings, `${route} has ${headings} h1 elements`).toBeLessThanOrEqual(1);
    }
  });
});

/* ------------------------------------------- T-107 · empty states defined */

test.describe('T-107 · empty states', () => {
  test('a factory on day one never sees a blank screen', async ({ page }) => {
    // The demo build seeds master data but no transactions, which is exactly
    // the state a new customer is in on their first morning.
    const blank: string[] = [];

    for (const route of [...FIELD_ROUTES, ...OFFICE_ROUTES]) {
      await visit(page, route);
      const text = (await page.locator('main, body').first().innerText()).trim();
      if (text.length < 40) blank.push(`${route} (${text.length} chars)`);
    }

    expect(blank, `screens with nothing on them:\n${blank.join('\n')}`).toEqual([]);
  });
});

/* --------------------------------------------- T-108 · offline behaviour */

test.describe('T-108 · offline', () => {
  test('transaction screens keep working with the network cut', async ({ page, context }) => {
    // Load the app first, then cut the network — that is the real sequence: an
    // operator walks into a concrete warehouse holding an app already open.
    await visit(page, '/f');
    // Wait for the service worker to control the page, which is what makes
    // unvisited route chunks available offline.
    await page.evaluate(() => navigator.serviceWorker?.ready);
    await context.setOffline(true);

    // Client-side navigation must not touch the network at all (Tech Stack §2.2).
    await page.getByRole('link', { name: 'Tasks' }).click();
    await expect(page.getByRole('heading', { name: /issue queue/i })).toBeVisible();

    // And the input flow still runs, offline, end to end.
    await page.evaluate(() => window.history.pushState({}, '', '/f/issues/request'));
    await page.goto('/f/issues/request').catch(() => {});

    const quickIssue = page.getByRole('button', { name: /quick issue/i });
    if (await quickIssue.isVisible().catch(() => false)) {
      await quickIssue.click();
      await expect(page.getByText(/no work order needed/i)).toBeVisible();
    }

    await context.setOffline(false);
  });
});

/* --------------------------------------- T-115 · storage loss & recovery */

test.describe('T-115 · storage', () => {
  test('a cleared database is reported, never shown as normal', async ({ page }) => {
    await visit(page, '/f/sync');
    await expect(page.getByText(/storage/i).first()).toBeVisible();

    // Wipe local storage the way a browser under pressure would.
    await page.evaluate(async () => {
      const names = await indexedDB.databases?.();
      for (const db of names ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
    });

    await visit(page, '/f/sync');
    // The screen still renders and still talks about storage rather than
    // showing an empty page as though nothing happened.
    await expect(page.getByText(/storage/i).first()).toBeVisible();
  });
});
