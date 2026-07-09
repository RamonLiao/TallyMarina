# Mobile Header + Nav Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At ≤768px, collapse the 7-button wrapped workspace nav into an overlay drawer, move Connect Wallet into that drawer, and give the header a real type hierarchy — without changing desktop layout.

**Architecture:** Extract the workspace button list into a shared `WorkspaceNavList` consumed by both the desktop `SideNav` and a new mobile `NavDrawer`. Move all chrome layout out of inline styles into CSS classes, which lets the mobile media query win without `!important`. Replace the 7 mixed-plane emoji icons with `currentColor` SVGs. Add a shell-level `<h1>` so "where am I" lives in the content area, not the header.

**Tech Stack:** React 18 + TypeScript, Vite, vitest + @testing-library/react, plain CSS with custom properties (`web/src/tokens.css`, `web/src/styles/base.css`).

**Spec:** `docs/superpowers/specs/2026-07-09-mobile-header-nav-design.md` (committed `84b72a8`)

## Global Constraints

- **Scope is `web/` only.** No API, no Move, no `services/`. `sui move test` is not applicable (zero `.move` changes) — say so explicitly, do not silently skip.
- **Single mobile breakpoint = `max-width: 768px`.** CSS custom properties cannot be used in media query conditions, so the literal `768px` appears in each block. The old `640px` topbar breakpoint is deleted.
- **Desktop (>768px) layout must not change.** "Layout" means **geometry — size, position, spacing, wrapping**. Verified by comparing 769px and 1280px before/after. *(Pre-flight ruling B):* small colour drift from replacing hand-rolled `rgba()` with `--austere-*` tokens **is permitted** on desktop. Do not compare colour values at 769/1280 — compare geometry.
- **Zero `!important` introduced.** Existing `!important` rules that exist only to beat `SideNav`'s inline styles must be **deleted**, not preserved.
- **Zero colour emoji in chrome.** All 7 workspace icons are `currentColor` SVG.
- **Zero hand-rolled `rgba(255,255,255,…)` in chrome.** Navy-surface text/borders use the existing `--austere-ink` / `--austere-dim` / `--austere-border` tokens (`tokens.css:27-30`). *(Pre-flight ruling A):* this binds the `<header class="topbar">` element too — its inline `background` and `borderBottom` move into a `.topbar` class, with the border using `--austere-border`. After Task 4, `grep -n 'rgba(255,255,255' web/src/components/chrome/` must return **nothing**.
- **Type scale (mobile):** brand `--text-lg` (18px) · content h1 `--text-xl` (22px) · meta line `--text-xs` (12px). No two adjacent levels share a size.
- **Do NOT delegate to `gemini` / `codex` CLI.** `.claude/rules/frontend.md` says delegate pure UI work to them, but `~/.claude/rules/general/workflow.md` records that gemini has no free tier and codex quota is exhausted as of 2026-07 — **both are suspended, do not attempt to call them.** This conflict is resolved in favour of the newer workflow.md rule. Implement directly.
- **Review path:** non-trivial (5+ files, component structure, new a11y contract). The "pure styling → fast-track, skip dual-review" convention does **not** apply. Full dual-review required after the final task.
- **Browser verification is mandatory** before commit of the final task. Unit tests alone are insufficient — this is the rule that caught the Close-workspace regression (`reviews/workspace-demo-walkthrough-2026-07-09.md`).

## File Structure

| File | Responsibility |
|---|---|
| `web/src/components/chrome/WorkspaceIcon.tsx` | **Create.** Maps a `WorkspaceId` → one inline `currentColor` SVG. Pure lookup, no state. |
| `web/src/components/chrome/WorkspaceNavList.tsx` | **Create.** The 7 nav buttons. Single source of truth, shared by SideNav + NavDrawer. |
| `web/src/components/chrome/NavDrawer.tsx` | **Create.** ☰ toggle + scrim + `role="dialog"` drawer holding ConnectButton and the nav list. Owns its own open state. |
| `web/src/components/chrome/WorkspaceHeader.tsx` | **Create.** Renders the active workspace label as the content-area `<h1>`. |
| `web/src/app/workspaces.ts` | **Modify.** Drop the `icon: string` field (emoji). |
| `web/src/components/chrome/SideNav.tsx` | **Modify.** Reduce to a `<nav>` wrapper around `WorkspaceNavList`; delete all inline styles. |
| `web/src/components/chrome/TopBar.tsx` | **Modify.** Mount `NavDrawer`; move brand/select/pill styling to classes. |
| `web/src/components/chrome/EntitySwitcher.tsx` | **Modify.** Inline styles → `.entity-switcher`. Keeps the native `<select>`. |
| `web/src/components/chrome/PeriodPill.tsx` | **Modify.** Inline styles → `.period-pill`. |
| `web/src/App.tsx` | **Modify.** Render `<WorkspaceHeader />` at the top of `<main>`. |
| `web/src/workspaces/export/ExportWorkspace.tsx` | **Modify.** Delete both duplicate `<h1>Export</h1>` (lines 275, 301). |
| `web/src/styles/base.css` | **Modify.** New chrome classes; delete the `!important` block and its stale comment; unify breakpoint. |

---

### Task 1: Monochrome workspace icon set

Replaces 4 supplementary-plane colour emoji (🔍 U+1F50D, 📐 U+1F4D0, 📤 U+1F4E4, 🚢 U+1F6A2) and 3 BMP glyphs (⚓ ⚠ ⚖) with one consistent `currentColor` SVG set, so the brass active state tints the icon and the palette stays clean.

**Files:**
- Create: `web/src/components/chrome/WorkspaceIcon.tsx`
- Create: `web/src/components/chrome/WorkspaceIcon.test.tsx`
- Create: `web/src/app/workspaces.test.ts`
- Modify: `web/src/app/workspaces.ts`

**Interfaces:**
- Consumes: `WorkspaceId` from `web/src/app/workspaces.ts`
- Produces:
  - `WorkspaceIcon({ id }: { id: string }): ReactElement | null` — returns `null` for unknown ids (required: `SideNav.test.tsx:18` injects a synthetic `soon-test` id).
  - `WORKSPACES: { id: WorkspaceId; label: string; status: 'ready' | 'soon' }[]` — **`icon` field removed**.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/chrome/WorkspaceIcon.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { WorkspaceIcon } from './WorkspaceIcon';
import { WORKSPACES } from '../../app/workspaces';

it('renders one currentColor svg per real workspace', () => {
  for (const w of WORKSPACES) {
    const { container, unmount } = render(<WorkspaceIcon id={w.id} />);
    const svg = container.querySelector('svg');
    expect(svg, `no svg for ${w.id}`).not.toBeNull();
    // WHY currentColor: the active nav item is tinted --brass via `color`.
    // A hard-coded stroke would leave the icon un-tinted and break the
    // single-signal active state.
    expect(svg!.getAttribute('stroke')).toBe('currentColor');
    // WHY aria-hidden: the button already has a visible text label; an
    // exposed icon would double the accessible name.
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    unmount();
  }
});

it('returns null for an unknown id instead of throwing', () => {
  // SideNav.test.tsx injects a synthetic 'soon-test' workspace.
  const { container } = render(<WorkspaceIcon id="soon-test" />);
  expect(container.firstChild).toBeNull();
});
```

Create `web/src/app/workspaces.test.ts`:

```ts
import { WORKSPACES } from './workspaces';

it('exposes no icon field at all — icons are SVG components, not glyphs', () => {
  // WHY this is the primary guard: the registry is the only place a glyph
  // could re-enter. Killing the field kills the whole class of regression,
  // including variation-selector emoji that a codepoint range check misses.
  for (const w of WORKSPACES) {
    expect(Object.keys(w).sort()).toEqual(['id', 'label', 'status']);
  }
});

it('carries no emoji codepoints anywhere (defense in depth)', () => {
  // WHY the extra ranges: four original icons were supplementary-plane emoji
  // (📤 a blue/red mailbox, 🚢 a red/white ship) — colours that exist nowhere
  // in tokens.css. But `> 0xffff` alone is NOT sufficient: ⚠️ is U+26A0 plus
  // the U+FE0F variation selector, both ≤ 0xFFFF, and it renders in full
  // colour. Ban the variation selector and the misc-symbols block too.
  const blob = JSON.stringify(WORKSPACES);
  const offenders = [...blob].filter((ch) => {
    const cp = ch.codePointAt(0)!;
    return cp > 0xffff || cp === 0xfe0f || (cp >= 0x2600 && cp <= 0x27bf);
  });
  expect(offenders).toEqual([]);
});

it('still exposes every workspace with a label and status', () => {
  expect(WORKSPACES).toHaveLength(7);
  for (const w of WORKSPACES) {
    expect(w.label.length).toBeGreaterThan(0);
    expect(['ready', 'soon']).toContain(w.status);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/chrome/WorkspaceIcon.test.tsx src/app/workspaces.test.ts`
Expected: FAIL — `Failed to resolve import "./WorkspaceIcon"`, and the emoji test fails listing `📐`, `🔍`, `📤`, `🚢`.

- [ ] **Step 3: Create the icon component**

Create `web/src/components/chrome/WorkspaceIcon.tsx`:

```tsx
import type { ReactElement } from 'react';

// NOTE: do NOT `import type { JSX } from 'react'` — that named export only
// exists in the React 19 types. This repo is on React 18, where JSX is a
// global namespace. ReactElement is the portable choice.

// Monochrome, 24×24, stroke-only. `currentColor` lets the active nav item's
// --brass `color` tint the icon; a fixed stroke would not.
const PATHS: Record<string, ReactElement> = {
  close: (
    <>
      <circle cx="12" cy="5" r="2" />
      <line x1="12" y1="7" x2="12" y2="21" />
      <path d="M5 13a7 7 0 0 0 14 0" />
      <line x1="8" y1="11" x2="16" y2="11" />
    </>
  ),
  exceptions: (
    <>
      <path d="M12 3 L22 20 H2 Z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </>
  ),
  reconciliation: (
    <>
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="6" y1="20" x2="18" y2="20" />
      <line x1="4" y1="8" x2="20" y2="8" />
      <path d="M4 8 L1.5 14 h5 Z" />
      <path d="M20 8 L17.5 14 h5 Z" />
    </>
  ),
  audit: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </>
  ),
  policy: (
    <>
      <path d="M4 4 V20 H20 Z" />
      <line x1="7" y1="16" x2="12" y2="16" />
    </>
  ),
  export: (
    <>
      <path d="M4 15 v4 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-4" />
      <line x1="12" y1="4" x2="12" y2="15" />
      <path d="M8 8 l4 -4 l4 4" />
    </>
  ),
  onboarding: (
    <>
      <path d="M3 17 h18 l-2 4 H5 Z" />
      <line x1="12" y1="3" x2="12" y2="17" />
      <path d="M12 5 l6 4 l-6 2 Z" />
    </>
  ),
};

export function WorkspaceIcon({ id }: { id: string }): ReactElement | null {
  const path = PATHS[id];
  if (!path) return null; // unknown id (e.g. test-injected 'soon-test')
  return (
    <svg
      className="ws-nav-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}
```

- [ ] **Step 4: Drop the emoji field from the registry**

Modify `web/src/app/workspaces.ts` — replace the type and array (lines 5-15):

```ts
export const WORKSPACES: {
  id: WorkspaceId; label: string; status: 'ready' | 'soon';
}[] = [
  { id: 'close',          label: 'Close',          status: 'ready' },
  { id: 'exceptions',     label: 'Exceptions',     status: 'ready' },
  { id: 'reconciliation', label: 'Reconciliation', status: 'ready' },
  { id: 'audit',          label: 'Audit',          status: 'ready' },
  { id: 'policy',         label: 'Policy',         status: 'ready' },
  { id: 'export',         label: 'Export',         status: 'ready' },
  { id: 'onboarding',     label: 'Onboarding',     status: 'ready' },
];
```

Leave `WorkspaceId`, `IDS`, and `isWorkspaceId` exactly as they are.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/chrome/WorkspaceIcon.test.tsx src/app/workspaces.test.ts`
Expected: PASS (4 tests).

`SideNav.tsx` still references `w.icon` and will now fail typecheck — that is expected and fixed in Task 2. Do not run `tsc` yet.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/chrome/WorkspaceIcon.tsx web/src/components/chrome/WorkspaceIcon.test.tsx web/src/app/workspaces.ts web/src/app/workspaces.test.ts
git commit -m "feat(web): monochrome SVG workspace icons, drop colour emoji

Four of seven icons were supplementary-plane emoji whose colours exist
nowhere in the palette. currentColor SVG lets the brass active state tint
the icon. A guard test pins the no-emoji rule."
```

---

### Task 2: Extract `WorkspaceNavList`, slim `SideNav`, kill the `!important` block

`SideNav` styles itself inline, which is why `base.css:240-266` needs `!important` to reflow it on mobile. Moving to classes removes that whole fight. The mobile `<aside>` is hidden outright (the drawer replaces it), so even `position: static !important` goes away.

**Files:**
- Create: `web/src/components/chrome/WorkspaceNavList.tsx`
- Create: `web/src/components/chrome/WorkspaceNavList.test.tsx`
- Modify: `web/src/components/chrome/SideNav.tsx` (full rewrite — it becomes 8 lines)
- Modify: `web/src/styles/base.css:218-267` (delete `!important` block + stale comment, add `.ws-nav*` classes)

**Interfaces:**
- Consumes: `WorkspaceIcon({ id })` (Task 1); `useWorkspace()` from `web/src/app/WorkspaceContext.tsx` returning `{ activeWorkspace, setWorkspace }`.
- Produces: `WorkspaceNavList({ onNavigate }: { onNavigate?: () => void })` — renders one `<button class="ws-nav-item">` per workspace, carrying `aria-current="page"` when active and `data-status`. Calls `setWorkspace(id)` then `onNavigate?.()`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/chrome/WorkspaceNavList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { WorkspaceProvider, useWorkspace } from '../../app/WorkspaceContext';
import { WorkspaceNavList } from './WorkspaceNavList';

function probeWrap(ui: React.ReactNode) {
  let ctx!: ReturnType<typeof useWorkspace>;
  function Probe() { ctx = useWorkspace(); return null; }
  render(<WorkspaceProvider>{ui}<Probe /></WorkspaceProvider>);
  return () => ctx;
}

it('switches workspace and notifies the host that navigation happened', async () => {
  // WHY onNavigate matters: the drawer must close itself after a choice.
  // Without this callback the user picks a workspace and stares at the drawer.
  const onNavigate = vi.fn();
  const get = probeWrap(<WorkspaceNavList onNavigate={onNavigate} />);
  await userEvent.click(screen.getByRole('button', { name: /Policy/ }));
  expect(get().activeWorkspace).toBe('policy');
  expect(onNavigate).toHaveBeenCalledTimes(1);
});

it('works without onNavigate (desktop SideNav passes none)', async () => {
  const get = probeWrap(<WorkspaceNavList />);
  await userEvent.click(screen.getByRole('button', { name: /Audit/ }));
  expect(get().activeWorkspace).toBe('audit');
});

it('marks the active workspace with aria-current', () => {
  probeWrap(<WorkspaceNavList />);
  expect(screen.getByRole('button', { name: /Close/ })).toHaveAttribute('aria-current', 'page');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/chrome/WorkspaceNavList.test.tsx`
Expected: FAIL — `Failed to resolve import "./WorkspaceNavList"`.

- [ ] **Step 3: Create `WorkspaceNavList`**

Create `web/src/components/chrome/WorkspaceNavList.tsx`:

```tsx
import { WORKSPACES } from '../../app/workspaces';
import { useWorkspace } from '../../app/WorkspaceContext';
import { WorkspaceIcon } from './WorkspaceIcon';

// Layout/visual live in base.css (.ws-nav*). No inline styles: the mobile
// drawer restyles these via plain selectors, and inline styles would force
// an !important fight (the exact debt this component was extracted to repay).
export function WorkspaceNavList({ onNavigate }: { onNavigate?: () => void }) {
  const { activeWorkspace, setWorkspace } = useWorkspace();
  return (
    <ul className="ws-nav">
      {WORKSPACES.map((w) => {
        const active = w.id === activeWorkspace;
        return (
          <li key={w.id}>
            <button
              type="button"
              className="ws-nav-item"
              onClick={() => { setWorkspace(w.id); onNavigate?.(); }}
              aria-current={active ? 'page' : undefined}
              data-status={w.status}
            >
              <WorkspaceIcon id={w.id} />
              <span className="ws-nav-label">{w.label}</span>
              {w.status === 'soon' && <span className="ws-nav-soon">soon</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Rewrite `SideNav`**

Replace the entire contents of `web/src/components/chrome/SideNav.tsx`:

```tsx
import { WorkspaceNavList } from './WorkspaceNavList';

// Desktop rail only. Hidden below 768px, where NavDrawer takes over.
export function SideNav() {
  return (
    <nav aria-label="Workspaces" className="sidenav">
      <WorkspaceNavList />
    </nav>
  );
}
```

- [ ] **Step 5: Replace the CSS block**

In `web/src/styles/base.css`, **delete lines 218-267 entirely** — that is `.shell-sidenav { border-right… }`, the stale `/* …single horizontal scroll strip… */` comment (which describes a scroll strip the code stopped being in commit `6338463`), and every `!important` rule under `@media (max-width: 768px)` targeting `.shell-sidenav nav`.

Replace with:

```css
/* ── Workspace nav (shared by desktop SideNav + mobile NavDrawer) ──
   Zero inline styles in the components, so these plain selectors win and the
   mobile drawer can restyle without !important. */
.sidenav { border-right: 1px solid rgba(20, 30, 54, 0.08); }

.ws-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  min-width: 200px;
  margin: 0;
  list-style: none;
}
.ws-nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: var(--text-base);
  text-align: left;
  cursor: pointer;
}
.ws-nav-item[aria-current="page"] {
  background: var(--brass-fill);
  font-weight: 600;
}
.ws-nav-item:focus-visible {
  outline: 2px solid var(--brass);
  outline-offset: 2px;
}
.ws-nav-icon { flex: 0 0 auto; }
.ws-nav-label { flex: 1; }
.ws-nav-soon {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-soft);
  font-family: var(--font-mono);
}

/* Below the single mobile breakpoint the desktop rail is gone entirely —
   NavDrawer replaces it. The <aside> only sets `position` inline, never
   `display`, so no !important is needed here. */
@media (max-width: 768px) {
  .shell-body { flex-direction: column; }
  /* min-width:0 frees only the main axis; a definite width resolves the
     cross axis so inner overflow-x wrappers (COA / recon grids) can clip. */
  .shell-body > main { width: 100%; min-width: 0; }
  .shell-sidenav { display: none; }
}
```

- [ ] **Step 6: Run the nav tests**

Run: `cd web && npx vitest run src/components/chrome/WorkspaceNavList.test.tsx src/components/chrome/SideNav.test.tsx`
Expected: PASS. `SideNav.test.tsx` is unchanged and still passes: its mocked registry supplies `soon-test`, and `WorkspaceIcon` returns `null` for it (Task 1, Step 3).

- [ ] **Step 7: Verify the !important debt is actually gone**

**Do not use a raw `grep -c '!important'` line count as the gate.** It counts prose: several comments in this file (including ones this task adds) contain the word `!important` while explaining why it is no longer needed. Assert the property instead of a proxy for it.

Gate 1 — no in-scope rule uses `!important`:

```bash
cd web && awk '/^\.(sidenav|ws-nav|nav-|topbar)/,/^}/' src/styles/base.css | grep -c '!important'
grep -n -A2 'shell-sidenav' src/styles/base.css | grep -c '!important'
```
Expected: `0` from both.

Gate 2 — the surviving declarations are exactly the out-of-scope ones:

```bash
cd web && grep -o '!important' src/styles/base.css | wc -l     # 15 occurrences
grep -n '!important' src/styles/base.css                       # inspect
```
Of those 15, **4 are inside comments** and **11 are real declarations**: `.copilot-dock` ×1, `.exceptions-layout` ×6, reduced-motion ×2, `.audit-lineage` ×2. These fight *other* components' inline styles and are **out of scope — leave every one of them.** If any `.sidenav` / `.ws-nav` / `.nav-*` / `.topbar*` / `.shell-sidenav` rule carries `!important`, the refactor failed.

Run: `cd web && grep -n 'scroll strip' src/styles/base.css`
Expected: no output (stale comment removed).

- [ ] **Step 8: Commit**

```bash
git add web/src/components/chrome/WorkspaceNavList.tsx web/src/components/chrome/WorkspaceNavList.test.tsx web/src/components/chrome/SideNav.tsx web/src/styles/base.css
git commit -m "refactor(web): extract WorkspaceNavList, drop SideNav inline styles

The !important block in base.css existed only to beat SideNav's inline
flex-direction/padding/background. With layout in classes it is deleted.
Mobile now hides the rail outright; NavDrawer replaces it (next task).
Also removes a comment describing a scroll strip that 6338463 replaced."
```

---

### Task 3: `NavDrawer` — overlay drawer with the full a11y contract

**Files:**
- Create: `web/src/components/chrome/NavDrawer.tsx`
- Create: `web/src/components/chrome/NavDrawer.test.tsx`
- Modify: `web/src/styles/base.css` (append drawer styles)

**Interfaces:**
- Consumes: `WorkspaceNavList({ onNavigate })` (Task 2); `ConnectButton` from `@mysten/dapp-kit-react/ui`.
- Produces: `NavDrawer()` — self-contained. Owns `open` state locally (no other consumer exists). Must be rendered inside a `WorkspaceProvider`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/chrome/NavDrawer.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { WorkspaceProvider } from '../../app/WorkspaceContext';

vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));

import { NavDrawer } from './NavDrawer';

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

it('locks body scroll while open and restores it on close', async () => {
  const toggle = setup();
  expect(document.body.style.overflow).toBe('');
  await userEvent.click(toggle);
  expect(document.body.style.overflow).toBe('hidden');
  await userEvent.keyboard('{Escape}');
  expect(document.body.style.overflow).toBe('');
});

it('closes after a workspace is chosen', async () => {
  const toggle = setup();
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole('button', { name: /Policy/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/chrome/NavDrawer.test.tsx`
Expected: FAIL — `Failed to resolve import "./NavDrawer"`.

- [ ] **Step 3: Implement `NavDrawer`**

Create `web/src/components/chrome/NavDrawer.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { WorkspaceNavList } from './WorkspaceNavList';

const FOCUSABLE = 'button, [href], select, input, textarea, [tabindex]:not([tabindex="-1"])';

export function NavDrawer() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // Focus in on open; body scroll lock; focus back to the toggle on close.
  // Both live in one effect so the restore path cannot drift from the setup.
  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      toggleRef.current?.focus();
    };
  }, [open]);

  // Escape closes. Tab cycles within the drawer (aria-modal does not do this).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const node = drawerRef.current;
      if (!node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="nav-toggle"
        aria-label="Open workspaces menu"
        aria-expanded={open}
        aria-controls="nav-drawer"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
             strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>

      {open && (
        <>
          <div className="nav-scrim" data-testid="nav-scrim" onClick={close} />
          <div
            id="nav-drawer"
            ref={drawerRef}
            className="nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Workspaces"
          >
            <div className="wallet-slot nav-drawer-wallet"><ConnectButton /></div>
            <hr className="nav-drawer-sep" />
            <WorkspaceNavList onNavigate={close} />
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 4: Append the drawer CSS**

Append to `web/src/styles/base.css`:

```css
/* ── Mobile nav drawer (≤768px) ──
   Surface is --ink: the drawer reads as the TopBar extended downward, i.e.
   chrome, not content. Text/borders use the --austere-* tokens that already
   exist for navy surfaces (tokens.css:27-30).
   Motion: the global prefers-reduced-motion block near the top of this file
   zeroes animation-duration, so the slide-in needs no extra media query. */
.nav-toggle { display: none; }

@media (max-width: 768px) {
  .nav-toggle {
    order: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: transparent;
    border: 1px solid var(--austere-border);
    border-radius: var(--radius-sm);
    color: var(--paper);
    cursor: pointer;
  }
  .nav-toggle:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }

  .nav-scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 55%, transparent);
    z-index: 200;
  }
  .nav-drawer {
    position: fixed;
    inset-block: 0;
    inset-inline-start: 0;
    width: min(320px, 86vw);
    z-index: 201;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    /* iPhone home indicator would otherwise sit on the last nav row. */
    padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom));
    overflow-y: auto;
    background: var(--ink);
    color: var(--austere-ink);
    animation: nav-drawer-in 180ms ease-out;
  }
  .nav-drawer-sep {
    width: 100%;
    margin: 0;
    border: 0;
    border-top: 1px solid var(--austere-border);
  }
  /* Re-skin the shared nav list for the navy surface. Plain selectors suffice
     because WorkspaceNavList carries no inline styles. */
  .nav-drawer .ws-nav { padding: 0; min-width: 0; }
  .nav-drawer .ws-nav-item { color: var(--austere-ink); }
  .nav-drawer .ws-nav-item[aria-current="page"] {
    background: transparent;
    color: var(--brass);
  }
  .nav-drawer .ws-nav-soon { color: var(--austere-dim); }
}

@keyframes nav-drawer-in {
  from { transform: translateX(-100%); }
  to   { transform: none; }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/chrome/NavDrawer.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/chrome/NavDrawer.tsx web/src/components/chrome/NavDrawer.test.tsx web/src/styles/base.css
git commit -m "feat(web): mobile nav drawer with full a11y contract

Overlay drawer on --ink holding Connect Wallet above the workspace list.
Escape, scrim click, focus trap, focus return, body scroll lock and
aria-expanded each have a test. Reduced motion is inherited from the
existing global block."
```

---

### Task 4: TopBar — mount the drawer, hide the wallet, build the type hierarchy

The original spec put the brand at 22px while leaving the content `<h1>` unsized. `tokens.css:44` documents `--text-xl` (22px) as the *workspace title*. Two 22px serif headings less than 100px apart is precisely the "everything is the same size" complaint. Brand drops to `--text-lg` on mobile only; desktop is untouched.

**Files:**
- Modify: `web/src/components/chrome/TopBar.tsx`
- Modify: `web/src/components/chrome/EntitySwitcher.tsx`
- Modify: `web/src/components/chrome/PeriodPill.tsx`
- Modify: `web/src/components/chrome/TopBar.test.tsx`
- Modify: `web/src/styles/base.css:289-327` (topbar block)

**Interfaces:**
- Consumes: `NavDrawer()` (Task 3).
- Produces: no new exports. CSS contract: `.topbar-brand-name`, `.entity-switcher`, `.period-pill`.

- [ ] **Step 1: Update the TopBar test first (it will fail)**

`TopBar` will render `NavDrawer`, which calls `useWorkspace()`. The existing test has no `WorkspaceProvider` and would throw `useWorkspace must be used within WorkspaceProvider`.

In `web/src/components/chrome/TopBar.test.tsx`, change the import block (line 4) and `renderTopBar` (lines 20-22):

```tsx
import { EntityProvider } from '../../app/EntityContext';
import { WorkspaceProvider } from '../../app/WorkspaceContext';
```

```tsx
function renderTopBar() {
  return render(
    <MemoryRouter>
      <EntityProvider>
        <WorkspaceProvider><TopBar /></WorkspaceProvider>
      </EntityProvider>
    </MemoryRouter>,
  );
}
```

Then append two new tests to the same file:

```tsx
it('exposes a workspaces menu toggle for narrow viewports', () => {
  renderTopBar();
  expect(screen.getByRole('button', { name: /open workspaces menu/i })).toBeInTheDocument();
});

it('still renders the desktop wallet slot in the header', () => {
  // WHY: the wallet is hidden on mobile by CSS, not unmounted. jsdom applies
  // no media queries, so this asserts the element survives — the 390px
  // browser pass (Task 6) is what proves it is actually hidden.
  const { container } = renderTopBar();
  expect(container.querySelector('.topbar-wallet')).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/chrome/TopBar.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /open workspaces menu/i`.

- [ ] **Step 3: Rewrite `TopBar`**

Replace the contents of `web/src/components/chrome/TopBar.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Mascot } from './Mascot';
import { EntitySwitcher } from './EntitySwitcher';
import { PeriodPill } from './PeriodPill';
import { NavDrawer } from './NavDrawer';

// All layout, colour and type live in base.css .topbar* so the mobile reflow
// is a clean media query rather than an !important fight with inline styles.
export function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <NavDrawer />
        <Link className="topbar-brand" to="/" style={{ textDecoration: 'none' }}>
          <Mascot pose="sailing" size={32} />
          <span className="topbar-brand-name">TallyMarina</span>
        </Link>
        <div className="topbar-context">
          <EntitySwitcher />
          <PeriodPill />
        </div>
        <div className="wallet-slot topbar-wallet">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Move `EntitySwitcher` styling to a class**

In `web/src/components/chrome/EntitySwitcher.tsx`, replace the `<select>` element's `style={{…}}` prop (lines 20-40) with `className="entity-switcher"`. Keep `aria-label`, `value`, `onChange`, and the `<option>` children exactly as they are — including `style={{ color: 'var(--ink)' }}` on each `<option>` (native option colouring cannot be reached from the parent class).

The element becomes:

```tsx
    <select
      aria-label="Entity"
      className="entity-switcher"
      value={entity?.id ?? ''}
      onChange={(e) => {
        const next = list.find((x) => x.id === e.target.value) ?? null;
        setEntity(next);
      }}
    >
```

- [ ] **Step 5: Move `PeriodPill` styling to a class**

Replace the contents of `web/src/components/chrome/PeriodPill.tsx`:

```tsx
import { useEntityCtx } from '../../app/EntityContext';

export function PeriodPill() {
  const { periodId } = useEntityCtx();
  return (
    <span aria-label="Accounting period" className="period-pill">
      {periodId}
    </span>
  );
}
```

- [ ] **Step 6: Replace the TopBar CSS block**

In `web/src/styles/base.css`, replace everything from the `/* ── TopBar layout … ── */` comment to the end of the `@media (max-width: 640px)` block (lines 289-327) with:

```css
/* ── TopBar layout ──
   Desktop: brand left; context + wallet grouped right on one balanced row.
   Surface colour lives here, not inline: --austere-border is the token for
   hairlines on navy (pre-flight ruling A). */
.topbar {
  background: var(--ink);
  border-bottom: 1px solid var(--austere-border);
}
.topbar-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--space-3) clamp(16px, 4vw, 48px);
  display: flex;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  flex-wrap: wrap;
}
.topbar-brand { display: flex; align-items: center; gap: var(--space-1); }
.topbar-brand-name {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  color: var(--paper);
  font-weight: 560;
  letter-spacing: -0.02em;
  line-height: var(--leading-tight);
}
.topbar-context {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}
.topbar-wallet { display: flex; align-items: center; }

/* Chrome controls on the navy bar. Borders/fills derive from the --austere-*
   tokens and --paper rather than hand-rolled rgba(255,255,255,…). */
.entity-switcher {
  appearance: none;
  -webkit-appearance: none;
  background-color: color-mix(in srgb, var(--paper) 8%, transparent);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23F4ECD8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right var(--space-2) center;
  color: var(--paper);
  border: 1px solid var(--austere-border);
  border-radius: var(--radius-pill);
  padding: var(--space-1) calc(var(--space-3) + 16px) var(--space-1) var(--space-3);
  font-family: var(--font-display);
  font-size: var(--text-sm);
  min-width: 0;
  max-width: 180px;
  flex-shrink: 1;
}
.period-pill {
  background: color-mix(in srgb, var(--paper) 8%, transparent);
  color: var(--paper);
  border: 1px solid var(--austere-border);
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

/* Mobile (single 768px breakpoint — was 640px, which left 641–768px in a
   hybrid state where the rail had stacked but the topbar had not reflowed).
   Two intentional rows: [☰ + brand] then a single-line mono meta row.
   The wallet is hidden here; NavDrawer serves it. */
@media (max-width: 768px) {
  .topbar-inner { row-gap: var(--space-2); }
  .topbar-brand { order: 1; }
  .topbar-brand-name { font-size: var(--text-lg); }
  .topbar-wallet { display: none; }
  .topbar-context {
    order: 3;
    width: 100%;
    margin-left: 0;
    justify-content: flex-start;
    flex-wrap: nowrap;
    min-width: 0;
  }
  .entity-switcher,
  .period-pill {
    background: transparent;
    border: 0;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--austere-dim);
  }
  .entity-switcher {
    padding-right: 18px;
    background-position: right center;
    max-width: 60vw;
  }
  /* A hairline, not a middot: the left side is an interactive <select>, the
     right side is static text. A list separator would imply both are the
     same kind of thing and invite clicks on the period. */
  .period-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 0 auto;
  }
  .period-pill::before {
    content: "";
    width: 1px;
    height: 1em;
    background: var(--austere-border);
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/chrome/TopBar.test.tsx`
Expected: PASS (6 tests).

Run: `cd web && grep -c 'max-width: 640px' src/styles/base.css`
Expected: `0` (breakpoint unified).

Run: `cd web && grep -rn 'rgba(255,255,255' src/components/chrome/`
Expected: no output (pre-flight ruling A — chrome carries no hand-rolled rgba).

- [ ] **Step 8: Commit**

```bash
git add web/src/components/chrome/TopBar.tsx web/src/components/chrome/TopBar.test.tsx web/src/components/chrome/EntitySwitcher.tsx web/src/components/chrome/PeriodPill.tsx web/src/styles/base.css
git commit -m "feat(web): mobile topbar — drawer toggle, hidden wallet, real hierarchy

Brand drops to --text-lg on mobile so it no longer ties with the 22px
content h1. Entity+period collapse to one 12px mono meta line separated by
a hairline (a middot implied the static period was clickable). Unifies the
640px topbar breakpoint into the 768px one, removing the hybrid band.
Hand-rolled rgba() on the navy bar gives way to --austere-* tokens."
```

---

### Task 5: Content-area `<h1>`, and delete Export's duplicates

**Files:**
- Create: `web/src/components/chrome/WorkspaceHeader.tsx`
- Create: `web/src/components/chrome/WorkspaceHeader.test.tsx`
- Modify: `web/src/App.tsx:97-102`
- Modify: `web/src/workspaces/export/ExportWorkspace.tsx:275,301`
- Modify: `web/src/styles/base.css` (append `.workspace-title`)

**Interfaces:**
- Consumes: `useWorkspace()`; `WORKSPACES` (Task 1, no `icon` field).
- Produces: `WorkspaceHeader(): JSX.Element | null`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/chrome/WorkspaceHeader.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceProvider } from '../../app/WorkspaceContext';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceNavList } from './WorkspaceNavList';

it('names the active workspace as the page h1', () => {
  render(<WorkspaceProvider><WorkspaceHeader /></WorkspaceProvider>);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Close');
});

it('follows the active workspace', async () => {
  // WHY: with the nav collapsed into a drawer, this h1 is the ONLY persistent
  // "where am I" signal. If it went stale the user would be lost.
  render(
    <WorkspaceProvider><WorkspaceHeader /><WorkspaceNavList /></WorkspaceProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: /Policy/ }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Policy');
});
```

Append to `web/src/workspaces/export/ExportWorkspace.test.tsx`:

```tsx
it('renders no h1 of its own — the shell owns the page title', () => {
  // WHY: ExportWorkspace shipped two <h1>Export</h1> (one per render branch).
  // With the shell-level h1 they would double up, giving the page two level-1
  // headings — a real screen-reader defect, not a cosmetic one.
  const { container } = renderExport();
  expect(container.querySelector('h1')).toBeNull();
});
```

> If `ExportWorkspace.test.tsx` has no `renderExport` helper, inline the existing render call used by its neighbouring tests instead of inventing one.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/chrome/WorkspaceHeader.test.tsx src/workspaces/export/ExportWorkspace.test.tsx`
Expected: FAIL — `Failed to resolve import "./WorkspaceHeader"`; and the Export assertion fails because `h1` is still present.

- [ ] **Step 3: Create `WorkspaceHeader`**

Create `web/src/components/chrome/WorkspaceHeader.tsx`:

```tsx
import { WORKSPACES } from '../../app/workspaces';
import { useWorkspace } from '../../app/WorkspaceContext';

// The one persistent "where am I" signal once the nav collapses into a drawer.
// No icon: the drawer already carries iconography; repeating it here is the
// accessory to leave at home.
export function WorkspaceHeader() {
  const { activeWorkspace } = useWorkspace();
  const meta = WORKSPACES.find((w) => w.id === activeWorkspace);
  if (!meta) return null;
  return <h1 className="workspace-title">{meta.label}</h1>;
}
```

- [ ] **Step 4: Mount it in the shell**

In `web/src/App.tsx`, add the import next to the other chrome imports:

```tsx
import { WorkspaceHeader } from './components/chrome/WorkspaceHeader';
```

and change the `<main>` body (lines 97-102):

```tsx
        <main
          aria-label="TallyMarina"
          style={{ flex: 1, minWidth: 0, padding: 'var(--space-4) clamp(16px, 4vw, 48px) var(--space-10)' }}
        >
          <WorkspaceHeader />
          <WorkspaceContent />
        </main>
```

- [ ] **Step 5: Delete Export's two `<h1>`**

In `web/src/workspaces/export/ExportWorkspace.tsx`, delete the line `<h1>Export</h1>` in **both** places (the empty-journal branch at ~line 275 and the main return at ~line 301). Leave both `<header className="export-header">` elements and their `<p>` children intact.

- [ ] **Step 6: Add the title style**

Append to `web/src/styles/base.css`:

```css
/* The page title. --text-xl is the size tokens.css reserves for "workspace
   title"; the brand steps down to --text-lg on mobile so these never tie. */
.workspace-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  line-height: var(--leading-tight);
  color: var(--ink);
  margin: 0 0 var(--space-3);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/chrome/WorkspaceHeader.test.tsx src/workspaces/export/ExportWorkspace.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/chrome/WorkspaceHeader.tsx web/src/components/chrome/WorkspaceHeader.test.tsx web/src/App.tsx web/src/workspaces/export/ExportWorkspace.tsx web/src/workspaces/export/ExportWorkspace.test.tsx web/src/styles/base.css
git commit -m "feat(web): shell-level workspace h1; drop Export's duplicate titles

With the nav in a drawer the h1 is the only persistent location signal.
ExportWorkspace carried <h1>Export</h1> in both render branches; those
would have produced two level-1 headings on the page."
```

---

### Task 6: Full-suite regression + real-browser verification

Unit tests cannot see media queries, focus rings, or overflow. jsdom applies no CSS. This task is where the change is actually proven.

**Files:** none created. This task may produce fixes in files from Tasks 1-5.

**Interfaces:** none.

- [ ] **Step 1: Run the whole web suite**

Run: `cd web && npx vitest run`
Expected: all tests pass. Baseline before this plan was **422/422**; expect **~440** with the new specs. Report the exact number — "tests pass" is not an acceptable report.

- [ ] **Step 2: Typecheck and build**

Run: `cd /Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/0-Agentic-Web/Sui-Agentic-Subledger && npm run typecheck`
Expected: exit 0.

Run: `cd web && npx vite build`
Expected: exit 0.

- [ ] **Step 3: Start the servers**

The api server cannot be launched from a background task — the sandbox denies reading `services/api/.env`. Source it in a foreground shell and detach:

```bash
cd services/api && set -a && . ./.env && set +a && nohup npm start > /tmp/api.log 2>&1 & disown
cd web && nohup npm run dev > /tmp/web.log 2>&1 & disown
```

Confirm: `curl -s http://localhost:8787/entities` returns the `acme:pilot-001` entity. (There is no `/health` route.)

- [ ] **Step 4: Verify mobile at 390px**

With Playwright MCP, navigate to `http://localhost:5173/app`, resize to 390×844, then assert by measurement — not by eye:

```js
() => {
  const iw = window.innerWidth;
  const brand = getComputedStyle(document.querySelector('.topbar-brand-name'));
  const h1 = getComputedStyle(document.querySelector('.workspace-title'));
  const pill = getComputedStyle(document.querySelector('.period-pill'));
  const ctx = document.querySelector('.topbar-context').getBoundingClientRect();
  const sw = document.querySelector('.entity-switcher').getBoundingClientRect();
  const pw = document.querySelector('.period-pill').getBoundingClientRect();
  return {
    pageOverflow: document.documentElement.scrollWidth > iw,   // must be false
    brandPx: brand.fontSize,                                    // must be 18px
    h1Px: h1.fontSize,                                          // must be 22px
    pillPx: pill.fontSize,                                      // must be 12px
    metaOneLine: Math.abs(sw.top - pw.top) < 2,                 // must be true
    metaFits: ctx.right <= iw + 1,                              // must be true
    walletHidden: getComputedStyle(document.querySelector('.topbar-wallet')).display === 'none',
    railHidden: getComputedStyle(document.querySelector('.shell-sidenav')).display === 'none',
    navToggleShown: getComputedStyle(document.querySelector('.nav-toggle')).display !== 'none',
    colourEmoji: document.querySelectorAll('main, header').length && /\p{Extended_Pictographic}/u.test(document.querySelector('header').innerText),
  };
}
```

All booleans must match the comments. `colourEmoji` must be `false`.

- [ ] **Step 5: Exercise the drawer in a real browser**

1. Click ☰. Screenshot. Confirm the drawer covers content with a scrim and Connect Wallet sits above the workspace list.
2. Press `Escape`. Assert `document.activeElement` is the ☰ button:
   `() => document.activeElement?.getAttribute('aria-label')` → `"Open workspaces menu"`.
3. Reopen, click **Policy**. Assert the drawer is gone and the `<h1>` now reads `Policy`.
4. Reopen, click the scrim. Assert the drawer is gone.
5. Reopen and click **Connect Wallet** inside the drawer. Confirm the wallet modal opens — two `ConnectButton` instances now exist in the tree (the hidden TopBar one and the drawer one). `OnboardingWorkspace.tsx:17` already proves multi-instance is safe, but the drawer's z-index (201) vs `.wallet-slot` (100) is new; verify the popover is not clipped by the drawer's `overflow-y: auto`.

> If the popover is clipped, that is a real finding — fix by portaling or by relaxing the drawer overflow, and note it in the commit.

- [ ] **Step 6: Verify the breakpoint edges**

Resize to **768×900** → mobile layout (☰ visible, rail hidden).
Resize to **769×900** → desktop layout (☰ hidden, rail visible, wallet in header).

This is the band that was previously hybrid (rail stacked at ≤768 while topbar reflowed at ≤640). Both must be internally consistent.

- [ ] **Step 7: Verify desktop is unchanged**

Resize to 1280×900. Confirm: brand 22px, rail visible on the left, wallet top-right, no ☰. Compare against `git stash`-ed baseline if anything looks off.

Run: `() => ({ brandPx: getComputedStyle(document.querySelector('.topbar-brand-name')).fontSize, toggle: getComputedStyle(document.querySelector('.nav-toggle')).display })`
Expected: `{ brandPx: "22px", toggle: "none" }`.

- [ ] **Step 8: Monkey testing**

Per `.claude/rules/test.md`, try to break it:

1. Open the drawer, then resize to 1280 **while open**. The drawer is inside a `≤768px` media query — confirm it does not strand a scrim over the desktop layout. If it does, that is a real bug: close the drawer on breakpoint change, or move `.nav-scrim`/`.nav-drawer` `display` into the media query.
2. Open the drawer and press `Tab` 20 times. Focus must never land on the entity `<select>` or the hidden wallet button behind the scrim.
3. Rapidly double-click ☰. Only one dialog may exist: `document.querySelectorAll('[role=dialog]').length === 1`.
4. Set an entity display name of 60 characters (via the `<select>` fixture) and confirm the meta row still does not overflow at 390px.

- [ ] **Step 9: Commit any fixes and report**

```bash
git add -- <only the specific files you fixed>
git commit -m "fix(web): <what the browser pass actually found>"
```

Report, with numbers: web suite `N/N`, typecheck exit 0, vite build exit 0, and the four widths verified. State explicitly: **`sui move test` is not applicable — zero `.move` files changed** (prove with `git diff main...HEAD --stat -- '*.move'` returning empty). Do not claim it was "skipped".

---

## Post-Plan Gates

1. **Final whole-branch review** across all 6 tasks.
2. **Dual-review** (`/dual-review`). Per Global Constraints this is **required** — the "pure styling → fast-track" convention does not apply. While codex/grok quota is exhausted, the external round is a fresh-context subagent; the tie-breaker is a second, independent subagent.
3. `sui move test` — **not applicable**, zero Move changes. Say so; do not report it as skipped.

## Deferred (from spec §11 — do not build here)

- Brass period seal (`OPEN` outline / `LOCKED` filled). Adds a `lockStatus` data dependency to TopBar. Next round's first candidate.
- `--font-body` (Mona Sans) is declared at `tokens.css:34` but never loaded — the `@import` at `tokens.css:10` fetches only Fraunces and IBM Plex Mono, and there is no `@font-face` anywhere. Body text has always fallen back to `system-ui`. App-wide, separate TODO.
- Close workspace F1/F2/F3 (`reviews/workspace-demo-walkthrough-2026-07-09.md`).
