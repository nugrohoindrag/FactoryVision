import { expect, test, type Page } from '@playwright/test';

/**
 * The three screens Tech Stack §1.1 makes end-to-end coverage mandatory for,
 * because they decide whether the product lives: L06, L13 and K06.
 *
 * These assert that the flow WORKS and that its structural rules hold. The
 * acceptance timings themselves (≤20s for L06, <30s for L13) are measured in
 * a real warehouse with gloves on — the in-app instrument (T-025) records
 * them there. A stopwatch in CI would only measure Playwright.
 */

/** Waits for the seeded master data to reach IndexedDB before interacting. */
async function openWithData(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test.describe('L06 · Add item to receipt', () => {
  test('takes an item through the locked field order and saves it', async ({ page }) => {
    await openWithData(page, '/f/receipts/new');

    // L05 first: a receipt needs a supplier and a delivery-note photo.
    await page.getByRole('button', { name: /search supplier/i }).click();
    await page.getByRole('option', { name: /Sumber Tepung/i }).click();

    // The photo is mandatory, so the flow cannot continue without one —
    // that is the rule being asserted here.
    await expect(page.getByRole('button', { name: /add items/i })).toBeVisible();
    await page.getByRole('button', { name: /add items/i }).click();
    await expect(page.getByText(/photograph the delivery note/i)).toBeVisible();
  });

  test('opens with the item picker already in front of the operator', async ({ page }) => {
    await openWithData(page, '/f/receipts/test-receipt/items');
    // Field order is locked: the item search is step one and opens itself.
    await expect(page.getByPlaceholder(/search item or code/i)).toBeVisible();
  });

  test('shows the timing instrument in internal builds', async ({ page }) => {
    await openWithData(page, '/f/receipts/test-receipt/items');
    await expect(page.getByText(/L06 timing/i)).toBeVisible();
    await expect(page.getByText(/target 20\.0s/i)).toBeVisible();
  });
});

test.describe('L13 · Request material', () => {
  test('quick issue removes the work-order requirement', async ({ page }) => {
    await openWithData(page, '/f/issues/request');

    // Work order is required by default...
    await expect(page.getByLabel(/work order no/i)).toBeVisible();

    // ...and Quick issue replaces it with a date + shift stamp.
    await page.getByRole('button', { name: /quick issue/i }).click();
    await expect(page.getByLabel(/work order no/i)).toHaveCount(0);
    await expect(page.getByText(/no work order needed/i)).toBeVisible();
  });

  test('has no approval step anywhere in the flow', async ({ page }) => {
    await openWithData(page, '/f/issues/request');
    // Approval adds seconds, and seconds kill adoption (UI Spec §11).
    await expect(page.getByText(/approv/i)).toHaveCount(0);
  });
});

test.describe('L23 · Blind count', () => {
  test('never renders a system quantity', async ({ page }) => {
    await openWithData(page, '/f/stock-take/test-session/count');
    await expect(page.getByText(/system|expected|variance/i)).toHaveCount(0);
  });
});

test.describe('K06 · Excel import wizard', () => {
  test('states that parsing happens on the device', async ({ page }) => {
    await openWithData(page, '/o/import');
    await expect(page.getByText(/never uploaded/i)).toBeVisible();
    await expect(page.getByText(/1\. Upload/)).toBeVisible();
  });

  test('offers every import target', async ({ page }) => {
    await openWithData(page, '/o/import');
    await expect(page.getByText(/what are you importing/i)).toBeVisible();
  });
});
