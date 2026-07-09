import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { WorkspaceProvider } from '../../app/WorkspaceContext';

// Mutable so a single test can make the wallet button refuse focus, mimicking
// the real <mysten-dapp-kit-connect-button>, whose shadow <button> has not
// rendered yet when the drawer's open-effect calls focus() on it.
let walletRefusesFocus = false;

vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => (
    <button
      type="button"
      ref={(el) => {
        if (el && walletRefusesFocus) {
          // jsdom's `focus` is a getter-only accessor; assignment throws.
          Object.defineProperty(el, 'focus', { value: () => {}, configurable: true });
        }
      }}
    >
      Connect Wallet
    </button>
  ),
}));

import { NavDrawer, collectFocusable } from './NavDrawer';

function setup() {
  render(<WorkspaceProvider><NavDrawer /><button type="button">outside</button></WorkspaceProvider>);
  return screen.getByRole('button', { name: /open workspaces menu/i });
}

it('is closed initially and advertises that via aria-expanded', () => {
  const toggle = setup();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('opens as a modal dialog holding the wallet above the workspace list', async () => {
  const toggle = setup();
  await userEvent.click(toggle);
  const dialog = screen.getByRole('dialog');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  // WHY order matters: the wallet is the primary action once you open the
  // menu on a phone; burying it under 7 nav rows defeats the move.
  const wallet = screen.getByRole('button', { name: 'Connect Wallet' });
  const close = screen.getByRole('button', { name: /Close/ });
  expect(wallet.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('closes on Escape and returns focus to the toggle', async () => {
  // WHY focus return: losing focus to <body> strands keyboard users at the
  // top of the document with no way back to the control they just used.
  const toggle = setup();
  await userEvent.click(toggle);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(toggle).toHaveFocus();
});

it('closes when the scrim is clicked', async () => {
  const toggle = setup();
  await userEvent.click(toggle);
  await userEvent.click(screen.getByTestId('nav-scrim'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('traps Tab inside the drawer', async () => {
  // WHY: aria-modal alone does not stop Tab in browsers; without a trap the
  // user tabs onto the page behind the scrim, which they cannot see.
  const toggle = setup();
  await userEvent.click(toggle);
  const outside = screen.getByRole('button', { name: 'outside' });
  for (let i = 0; i < 12; i++) await userEvent.tab();
  expect(outside).not.toHaveFocus();
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
});

it('locks body scroll while open and restores the PREVIOUS value on close', async () => {
  // WHY seed 'scroll' rather than start from '': a cleanup that hard-codes
  // `overflow = ''` passes against a default-empty body while silently
  // destroying whatever overflow the app had already set. Seeding a non-empty
  // value is the only way this test can tell the two implementations apart.
  document.body.style.overflow = 'scroll';
  const toggle = setup();
  await userEvent.click(toggle);
  expect(document.body.style.overflow).toBe('hidden');
  await userEvent.keyboard('{Escape}');
  expect(document.body.style.overflow).toBe('scroll');
  document.body.style.overflow = '';
});

it('closes after a workspace is chosen', async () => {
  const toggle = setup();
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole('button', { name: /Policy/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('pulls focus back into the drawer when Tab is pressed from outside it', async () => {
  // WHY: a trap that only wraps at the first/last element leaks whenever focus
  // starts outside the dialog — e.g. the browser parked it on <body>. Then the
  // user tabs onto the page behind the scrim, which they cannot see.
  const toggle = setup();
  await userEvent.click(toggle);
  const dialog = screen.getByRole('dialog');
  (document.activeElement as HTMLElement | null)?.blur();
  expect(dialog).not.toContainElement(document.activeElement as HTMLElement);
  await userEvent.tab();
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
});

it('pulls focus back into the drawer on Shift+Tab from outside it', async () => {
  const toggle = setup();
  await userEvent.click(toggle);
  const dialog = screen.getByRole('dialog');
  (document.activeElement as HTMLElement | null)?.blur();
  await userEvent.tab({ shift: true });
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
});

it('closes itself when the viewport grows past the mobile breakpoint', async () => {
  // WHY: .nav-drawer's position:fixed lives inside @media(max-width:768px).
  // Above that width the drawer reflows into the header (measured in a real
  // browser: header 72px -> 570px) while body scroll stays locked and the ☰
  // that would close it is display:none — a mouse user cannot recover.
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches: true,
    media: '(max-width: 768px)',
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => { listeners.add(cb); },
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => { listeners.delete(cb); },
  };
  vi.stubGlobal('matchMedia', () => mql);

  const toggle = setup();
  await userEvent.click(toggle);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(document.body.style.overflow).toBe('hidden');

  // The viewport crosses the breakpoint upward.
  mql.matches = false;
  act(() => { listeners.forEach((cb) => cb({} as MediaQueryListEvent)); });

  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');  // scroll lock released, not stranded

  vi.unstubAllGlobals();
});

it('treats a focus-delegating custom element as focusable', () => {
  // WHY this exists: dapp-kit's ConnectButton is <mysten-dapp-kit-connect-button>,
  // tabIndex -1, with its real <button> inside an open shadow root that has
  // delegatesFocus. A plain querySelectorAll(FOCUSABLE) misses it, so the
  // drawer's primary CTA falls outside the tab cycle and cannot be reached by
  // keyboard at all. Measured in a real browser: the trap collected 7 items
  // (the nav buttons) and zero wallet. Every other test in this file mocks
  // ConnectButton as a bare <button>, so only this test can catch the regression.
  //
  // jsdom does not natively support delegatesFocus (attachShadow's returned
  // root always reports it as undefined), so it is set explicitly here to
  // simulate the real browser's shadow root.
  const host = document.createElement('x-widget');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  Object.defineProperty(shadowRoot, 'delegatesFocus', { value: true });
  const plain = document.createElement('button');
  const wrap = document.createElement('div');
  wrap.append(host, plain);
  document.body.append(wrap);

  const items = collectFocusable(wrap);
  expect(items).toContain(host);   // the actual regression guard
  expect(items).toContain(plain);
  expect(items[0]).toBe(host);     // document order preserved

  wrap.remove();
});

it('moves focus into the drawer even when the first focusable refuses focus', async () => {
  // WHY: the drawer's first focusable is dapp-kit's wallet host, which delegates
  // focus into a shadow root that lit renders asynchronously. At open time
  // host.focus() silently no-ops — measured in a real browser, focus stayed on
  // the ☰ toggle and never entered the drawer. A trap whose entry point can fail
  // leaves keyboard users stranded outside a modal they just opened.
  // This test mounts the real NavDrawer; deleting the fallback loop from its
  // open-effect must turn it red.
  walletRefusesFocus = true;
  try {
    const toggle = setup();
    await userEvent.click(toggle);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    // fell through past the refusing wallet to the first nav button
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Close/ }));
  } finally {
    walletRefusesFocus = false;
  }
});
