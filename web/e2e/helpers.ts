import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';

/**
 * Asserts that the element:
 * 1. Has a non-zero border-radius (catches native-square-button regression).
 * 2. Has the class `btn-primary`.
 */
export async function expectBrassPill(locator: Locator): Promise<void> {
  // Assert class first — fast, synchronous Playwright check
  await expect(locator).toHaveClass(/btn-primary/);

  // Assert border-radius via computed style
  const borderRadius = await locator.evaluate(
    (el) => getComputedStyle(el).borderRadius,
  );
  if (borderRadius === '0px') {
    throw new Error(
      `expectBrassPill: element has borderRadius '0px' — pill style is missing. ` +
        `Got: ${borderRadius}`,
    );
  }
}

/**
 * Returns the computed CSS color of the element (e.g. "rgb(255, 200, 0)").
 */
export async function badgeColor(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).color);
}
