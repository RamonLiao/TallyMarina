import { render } from '@testing-library/react';
import { AppBackground } from './AppBackground';

/**
 * §8.4 governance: AppBackground is CHROME-ONLY.
 * The test verifies:
 * 1. The background layer always has --paper as the base fallback color (§8.7).
 * 2. The component renders a fixed-position, aria-hidden decoration (not a content element).
 * 3. The element does NOT appear inside data surfaces (verified by data-testid convention:
 *    journal/hash-chain containers must not render AppBackground as a child — enforced
 *    by the chrome-only import rule, not by this unit test, but the testid is a sentinel).
 */

it('renders a fixed background layer that falls back to flat --paper', () => {
  const { container } = render(<AppBackground />);
  const el = container.firstChild as HTMLElement;
  expect(el).toBeTruthy();
  // flat paper is always present as the base color; image/svg layers on top
  expect(el.style.backgroundColor).toContain('var(--paper)');
});

it('is aria-hidden (pure decoration, not a content element)', () => {
  const { container } = render(<AppBackground />);
  const el = container.firstChild as HTMLElement;
  expect(el.getAttribute('aria-hidden')).toBe('true');
});

it('is position fixed so it stays behind all content', () => {
  const { container } = render(<AppBackground />);
  const el = container.firstChild as HTMLElement;
  expect(el.style.position).toBe('fixed');
  // z-index -1 ensures it never sits above data surfaces
  expect(el.style.zIndex).toBe('-1');
});

it('has pointer-events none so clicks pass through', () => {
  const { container } = render(<AppBackground />);
  const el = container.firstChild as HTMLElement;
  expect(el.style.pointerEvents).toBe('none');
});
