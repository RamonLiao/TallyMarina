/**
 * Stale-anchor chip + Freeze restatement CTA — 390px RWD (W-F1/W-F2/W-F3)
 *
 * Two-tier coverage:
 *  - The 390px no-overflow assertion runs for real against the reachable Close
 *    workspace (the `.period-ribbon` flex-wrap change must not introduce horizontal
 *    overflow). Verified live: scrollWidth === clientWidth === 390 on a clean seed.
 *  - The stale-chip / CTA visual assertions require a period that was anchored, then
 *    reopened + edited so the on-chain root no longer matches the books. That chain
 *    needs a real wallet-signed on-chain anchor (an ANCHORED snapshot), which isn't
 *    reachable from a clean seed in this headless harness — the same gap class already
 *    documented in s1-close.spec.ts for the LOCKED+anchored state. We probe for the
 *    chip and honest-skip those assertions rather than force the DOM. The amber-vs-red
 *    class, the "Books changed since anchor (vN)" copy, and the "Freeze restatement
 *    (vN)" CTA math are covered at the component layer (CloseCockpit.staleAnchor.test.tsx,
 *    AnchorStep.test.tsx).
 */
import { test, expect } from '@playwright/test';

test('close workspace has no horizontal overflow at 390px (ribbon flex-wrap); stale chip honest-skipped', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/app');

  // Reach the Close workspace (in-app nav, not a URL route).
  await page.locator('button', { hasText: /Close/ }).first().click();
  await page.waitForLoadState('networkidle');

  // No horizontal page overflow at 390px — the flex-wrap change on .period-ribbon
  // must hold in the base (non-stale) case. This is the reachable, load-bearing RWD check.
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, 'page has horizontal overflow at 390px in the Close workspace').toBeLessThanOrEqual(0);

  // Stale-chip visual assertions: only run if a genuine stale state is present.
  const chip = page.locator('.stale-anchor-chip');
  const chipVisible = await chip.isVisible().catch(() => false);
  test.skip(
    !chipVisible,
    'anchorStaleness requires an anchored (wallet-signed on-chain) then reopened+edited period — not reachable from a clean seed in this headless harness (same gap class as s1-close.spec.ts anchor CTA). Component-covered in CloseCockpit.staleAnchor.test.tsx / AnchorStep.test.tsx.',
  );

  expect(await chip.textContent()).toMatch(/Books changed since anchor \(v\d+\)/i);
  await expect(chip).toHaveClass(/stale-anchor-chip/);
  // Amber (--warn), not red (--debit) — soft-force never renders as the blocking color.
  const color = await chip.evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toMatch(/rgb\(181, 83, 46\)/); // --debit red guard; class assertion above is primary

  const overflowWithChip = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflowWithChip, 'overflow at 390px with the stale chip rendered').toBeLessThanOrEqual(0);
});
