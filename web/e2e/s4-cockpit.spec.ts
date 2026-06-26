/**
 * S4 — Close cockpit light cards: computed-style assertions
 *
 * Landing page is already the Close cockpit. No nav needed.
 * Asserts exactly 6 .light-card elements and that each has a valid state class.
 */
import { test, expect } from '@playwright/test';
import { expectBrassPill } from './helpers';

const VALID_STATE_CLASSES = ['light--green', 'light--red', 'light--derived', 'light--mock'] as const;

test('S4 — exactly 6 light-cards in lights-grid', async ({ page }) => {
  await page.goto('/');

  // Wait for the lights grid to appear
  await page.locator('.lights-grid').waitFor({ state: 'visible', timeout: 10_000 });

  const cards = page.locator('.lights-grid .light-card');
  await expect(cards).toHaveCount(6);
});

test('S4 — every light-card has a valid state class', async ({ page }) => {
  await page.goto('/');
  await page.locator('.lights-grid').waitFor({ state: 'visible', timeout: 10_000 });

  const cards = page.locator('.lights-grid .light-card');
  const count = await cards.count();

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const className = await card.getAttribute('class') ?? '';
    const hasValidClass = VALID_STATE_CLASSES.some((cls) => className.includes(cls));
    expect(hasValidClass, `light-card[${i}] class="${className}" has no valid state class`).toBe(true);
  }
});

test('S4 — light-card colors are themed (non-default)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.lights-grid').waitFor({ state: 'visible', timeout: 10_000 });

  const cards = page.locator('.lights-grid .light-card');
  const count = await cards.count();

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const color = await card.evaluate((el) => getComputedStyle(el).color);
    // Themed cards should NOT be the browser's default black (rgb(0, 0, 0)) or unset
    // They resolve to one of: --credit, --debit, --warn, --ink-soft
    // Asserting non-black covers the regression where CSS tokens don't load
    expect(color, `light-card[${i}] has default/unset color`).not.toBe('rgb(0, 0, 0)');
    expect(color).not.toBe('');
  }
});

test('S4 — lock CTA is brass pill (btn-primary)', async ({ page }) => {
  await page.goto('/');
  await page.locator('.lock-panel').waitFor({ state: 'visible', timeout: 10_000 });

  const lockBtn = page.locator('.lock-panel button.btn-primary');
  await expect(lockBtn).toBeVisible();
  await expectBrassPill(lockBtn);
});
