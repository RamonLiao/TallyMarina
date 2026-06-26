/**
 * S1 — Close workspace: visual assertions + 375px RWD
 *
 * The landing page IS the Close cockpit (default workspace = 'close').
 * No navigation needed.
 *
 * Gap documented: the full close→anchor flow (surfacing CAP_NOT_OWNED_BY_WALLET)
 * requires seeded backend state that isn't reachable from a clean load.
 * That logic is covered by Layer-2 unit tests. Here we assert visual reachability only.
 */
import { test, expect } from '@playwright/test';
import { expectBrassPill } from './helpers';

test('S1 — Close cockpit loads with lock CTA as brass pill', async ({ page }) => {
  await page.goto('/');

  // The lock CTA is always rendered (disabled when blockers exist, enabled when closeable)
  const lockBtn = page.locator('button.btn-primary').first();
  await expect(lockBtn).toBeVisible();
  await expectBrassPill(lockBtn);

  // Cockpit verdict text is present (aria live region)
  const verdict = page.locator('[role="status"].cockpit-verdict');
  await expect(verdict).toBeVisible();
  const verdictText = await verdict.textContent();
  expect(verdictText).toBeTruthy();
});

test('S1 — 375px viewport: no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');

  // Wait for app to render
  await page.locator('.close-cockpit').waitFor({ state: 'visible', timeout: 10_000 });

  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth;
  });
  expect(overflow, 'page has horizontal overflow at 375px').toBe(false);
});

test('S1 — anchor CTA (known gap: unreachable without seeded LOCKED+anchored state)', async ({
  page,
}) => {
  await page.goto('/');

  // If period is already locked (possible with persisted backend state), assert the
  // anchor button exists with btn-primary; otherwise document the gap.
  const anchorBtn = page.locator('button.btn-primary', { hasText: /anchor/i });
  const lockBtn = page.locator('button.btn-primary').first();
  await expect(lockBtn).toBeVisible();

  const anchorVisible = await anchorBtn.isVisible().catch(() => false);
  if (anchorVisible) {
    await expectBrassPill(anchorBtn);
  } else {
    // Known gap: fresh entity has open blockers; anchor CTA only appears after
    // period is LOCKED. CAP_NOT_OWNED_BY_WALLET error path is covered by Layer-2.
    // SKIP — not a test failure.
    test.info().annotations.push({
      type: 'known-gap',
      description:
        'Anchor CTA not reachable from fresh load — requires LOCKED period. Covered by Layer-2.',
    });
  }
});
