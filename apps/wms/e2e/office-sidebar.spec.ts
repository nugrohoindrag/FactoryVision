import { expect, test } from '@playwright/test';

/**
 * Office sidebar — the nav must be reachable at every height.
 *
 * The regression this guards: the sidebar was a plain block inside a `fixed`
 * aside, so once the nav grew taller than the viewport its last group simply
 * ran off the bottom of the screen. `overflow-y-auto` was already on the nav
 * and did nothing, because an auto-height element never overflows. On a 13"
 * laptop that made Settings → Configuration unreachable.
 *
 * The fix is a flex column with `min-h-0` on the scroller. `min-h-0` is the
 * part that is easy to lose in a later refactor — without it a flex child
 * refuses to shrink below its content height and the bug comes straight back,
 * looking exactly like a working layout in the markup.
 */

test.describe('office sidebar', () => {
  test('the nav scrolls instead of running off the screen', async ({ page }) => {
    // Deliberately short: taller than the nav and this proves nothing.
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto('/o');

    const nav = page.locator('aside nav');
    const metrics = await nav.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));

    expect(metrics.overflowY).toBe('auto');
    // The nav is taller than the space it has — which is the whole premise.
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    // And it is contained: the scroller itself never exceeds the viewport.
    expect(metrics.clientHeight).toBeLessThanOrEqual(600);
  });

  test('the last nav item can be scrolled to and clicked', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto('/o');

    const last = page.getByRole('link', { name: /configuration/i });
    await last.scrollIntoViewIfNeeded();

    const box = await last.boundingBox();
    expect(box, 'last nav item has no box — it is not rendered').not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(600);

    await last.click();
    await expect(page).toHaveURL(/\/o\/configuration$/);
  });

  /**
   * The sidebar is `fixed`, so it takes no space in flow and the content
   * column has to reserve its width. When that reservation went missing the
   * failure was silent and total: the sidebar lay on top of the page and the
   * first 280px of every office screen — the heading, the first column of
   * every table — sat underneath it, unreadable and unclickable.
   *
   * Nothing else catches this. The horizontal-scroll audit passes happily
   * while content is hidden behind an overlay, and so does every by-role
   * query, because the elements are all still in the DOM at their normal size.
   */
  test('never lies on top of the content at any desktop width', async ({ page }) => {
    for (const width of [1024, 1100, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/o');
      await page.waitForSelector('aside nav');

      const geometry = await page.evaluate(() => {
        const aside = document.querySelector('aside')!;
        const main = document.querySelector('main')!;
        return {
          asideRight: aside.getBoundingClientRect().right,
          mainLeft: main.getBoundingClientRect().left,
        };
      });

      expect(
        geometry.mainLeft,
        `at ${width}px the content starts at ${geometry.mainLeft} but the sidebar ends at ${geometry.asideRight}`,
      ).toBeGreaterThanOrEqual(geometry.asideRight);
    }
  });

  test('is off-screen below lg, so the content gets the full width', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/o');
    await page.waitForSelector('aside nav');

    const asideRight = await page.evaluate(
      () => document.querySelector('aside')!.getBoundingClientRect().right,
    );
    // Translated fully out of view rather than merely hidden — a drawer that
    // still occupies its box would keep stealing taps at its edge.
    expect(asideRight).toBeLessThanOrEqual(0);
  });
});
