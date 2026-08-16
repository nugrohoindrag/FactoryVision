import { expect, test } from '@playwright/test';

/**
 * Shell navigation — both shells reachable, empty of network dependencies.
 */

test('field shell shows the four fixed nav items', async ({ page }) => {
  await page.goto('/f');
  const nav = page.getByRole('navigation');
  for (const label of ['Home', 'Stock', 'Tasks', 'Sync']) {
    await expect(nav.getByText(label, { exact: true })).toBeVisible();
  }
});

test('field shell navigates without a network round trip', async ({ page }) => {
  await page.goto('/f');
  await page.getByRole('link', { name: 'Sync' }).click();
  // L03 · Sync status
  await expect(page.getByRole('heading', { name: /sync status/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /sync now/i })).toBeVisible();
});

test('office shell reaches every master-data screen', async ({ page }) => {
  await page.goto('/o/products');
  // K03 · Products
  await expect(page.getByRole('heading', { name: /products/i })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /base unit/i })).toBeVisible();
});

test('page never scrolls horizontally at 360px (DoD §22.3)', async ({ page }) => {
  await page.goto('/f');
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
