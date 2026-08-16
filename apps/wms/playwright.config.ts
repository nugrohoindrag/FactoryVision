import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (Tech Stack §1.1) — mandatory for L06, L13 and K06, the three screens
 * that decide whether the product lives.
 *
 * Projects mirror the four test widths from the Definition of Done (§22.3):
 * 360 · 768 · 1024 · 1440.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    // Built with demo master data so the flows have products to pick.
    command: 'pnpm build:demo && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'phone-360',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 }, hasTouch: true },
    },
    {
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    { name: 'laptop-1024', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
