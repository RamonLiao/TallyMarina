# Dual Review — feat/mobile-header-nav (2026-07-09)

**Branch**: `feat/mobile-header-nav`, 16 commits, merge-base `de59e1e`, head `7ca1aec`
**Scope**: `web/` only (19 files). Zero `.move` files → `sui move test` **not applicable** (proven: `git diff main...HEAD --stat -- '*.move'` empty). Not a skip.
**Gates**: web suite **447/447** (76 files) · root typecheck exit 0 · `vite build` exit 0
**Whole-branch review (opus)**: READY TO MERGE

Round 1 ran as a fresh-context subagent, not codex — codex quota exhausted per `workflow.md` (2026-07). Per the dual-review skill's fallback, codex was **not** called.

---

## Round 1 — external independent review (fresh context, adversarial)

Verdict: **Ship as-is.** Hunted specifically for Critical/Important defects in the focus trap, effect lifecycle, `collectFocusable`, CSS reflow, and every new test. Found none.

Findings, all **Minor**:

1. **`NavDrawer.tsx` — resize-close parks focus on `<body>`.** On a live resize past 768px the cleanup calls `toggleRef.current?.focus()`, but `.nav-toggle` is `display:none` above 768px, so it no-ops. This is the *only* path in the open → navigate → wallet → escape → resize lifecycle where focus reaches `<body>`, and it self-heals on the next Tab (the `!node.contains(active)` branch recaptures). Escape / scrim / navigate all return focus correctly.
   *Optional fix*: park focus on a visible landmark (e.g. the shell `<h1>` with `tabindex="-1"`).

2. **768px literal duplicated.** `NavDrawer.tsx` hard-codes `'(max-width: 768px)'`; `base.css` repeats it across 8 `@media` blocks. Nothing ties them. Change the CSS to 820px without the JS and the 769–820px band shows an openable toggle whose resize-close never fires — resurrecting the reflow bug fixed in `b430794`.

3. **`collectFocusable` does not exclude visually-hidden elements.** Latent only: the drawer contains the wallet plus 7 always-visible buttons. If a future child adds a `hidden` button as the last focusable, `last.focus()` no-ops and the trap leaks.

4. **`collectFocusable` accepts only OPEN shadow roots** (`delegatesFocus` on a closed root is unreachable — `shadowRoot === null`). Correct for dapp-kit today; the JSDoc overstates generality.

**Direct answers**
- *Can a keyboard user get stuck?* No permanent trap found. Only the resize transition drops focus to `<body>`, and it self-heals.
- *Is `sui move test` genuinely inapplicable?* Yes — `grep -c '\.move'` on the diff = 0.

---

## Round 2 — project rules/skills review (performed by Claude)

| Rule | Verdict | Evidence |
|---|---|---|
| **Rule 2** — nothing speculative | ⚠️ **1 violation** | `NavDrawer.tsx:124` applies `.nav-drawer-wallet`; **zero** CSS rules select it (`grep -c` on `base.css` = 0). Dead selector hook. |
| **Rule 3** — surgical | ✅ | 19 files, all within the plan's declared set. Inline styles moved verbatim into equivalent classes; geometry preserved. No adjacent rework. |
| **Rule 7** — surface conflicts | ✅ | Three conflicts surfaced, none averaged: pre-flight rulings A/B (rgba-in-chrome, "desktop unchanged" = geometry); `frontend.md` vs `workflow.md`; monkey-3's wrong assertion. |
| **Rule 9** — tests must be able to fail | ⚠️ **1 known-unfalsifiable, disclosed** | `TopBar.test.tsx:59` cannot fail if the hiding CSS breaks (jsdom applies no media queries). Its own comment admits this; the 390px browser pass is the real proof. |
| **Rule 11** — match conventions | ✅ | All tokens pre-exist in `tokens.css`; the inline→class migration follows the existing `.topbar-*` precedent. |
| **Rule 12** — fail loud | ✅ | Zero `.skip`/`.only`/`xit`. `sui move test` declared N/A **with proof**. Monkey-1's FAIL was surfaced and fixed, not buried. |
| **`test.md`** — Monkey Testing mandatory | ✅ | 4 scenarios run in a real browser. Two returned FAIL; both reported. Monkey-1 found the branch's worst bug. |
| **`frontend.md`** — delegate UI to Gemini/codex CLI | ⚠️ **Deviation, surfaced** | Both CLIs suspended per `workflow.md` (no free tier / quota exhausted). Conflict resolved toward the newer rule and written into the plan's Global Constraints, not silently ignored. |

---

## Reviewer disagreement, adjudicated

**`NavDrawer.tsx:21` — `!el.hasAttribute('disabled')`.**
- Task-3 reviewer: Rule 2 violation (speculative; no nav button is ever `disabled`).
- Round 1: not a defect — AND-gated behind `matches(FOCUSABLE)`, zero cost, and **excluding disabled controls is correct**. Removing it would make `first.focus()`/`last.focus()` silently no-op on a disabled endpoint — the exact leak R1 flagged as latent.

**Adjudication: KEEP the filter.** R1's reasoning is grounded in a concrete failure mode; the earlier finding was not. Task-3's finding is **overruled**, recorded here rather than dropped.

Tie-breaker **not triggered** — both rounds conclude ship-able; they differ only on one Minor, resolved above on the merits.

---

## Verdict

**Ship as-is.** No Critical, no Important, from either round.

One Rule 2 violation is a one-token deletion and should land before merge:
- [ ] Remove the dead `nav-drawer-wallet` class from `NavDrawer.tsx:124` (keep `wallet-slot` — it establishes the stacking context the dapp-kit popover needs, per `base.css:131-137`).

## Follow-up backlog (not blockers)

1. **768px literal duplicated** between `NavDrawer.tsx` and 8 `base.css` blocks. Drift silently disables close-on-resize.
2. **Resize-close parks focus on `<body>`** — park it on a visible landmark instead.
3. **`h1 → h3` skipped heading** on Policy/Reconciliation (`PolicySummaryCard.tsx:18`, `CoaMappingTable.tsx:19`, `PreviewPanel.tsx:28`, `ReconDetail.tsx:60`). Pre-existing; those pages previously had *no* `h1`, so this branch is a net a11y gain that merely surfaces the gap. User-ruled to a separate TODO.
4. **Dead `icon` field** still in `SideNav.test.tsx` and `monkey.shell.test.tsx` mock factories. Out of scope for this branch (touching them would violate Rule 3).
5. **`aria-controls="nav-drawer"`** points at a conditionally-rendered id while the drawer is closed.
6. **`collectFocusable`** — add a visibility check if the drawer ever gains conditionally-hidden controls; document that it only sees open shadow roots.
7. **`--font-body` (Mona Sans) never loads** — `tokens.css:34` declares it, `tokens.css:10`'s `@import` fetches only Fraunces + IBM Plex Mono, no `@font-face` anywhere. App-wide, unrelated to this branch.

---

## What the test suite could not see

Three real bugs shipped green through 444–447 passing tests. All three were found only by driving a real browser:

1. **Drawer survived its own media query** — open at 390px, resize to 1280: `<header>` 72px → 570px, `body` scroll-locked, no visible control to close it (`b430794`).
2. **Connect Wallet was keyboard-unreachable** — the trap collected 7 nav buttons and zero wallet, because `<mysten-dapp-kit-connect-button>` has `tabIndex: -1` and hides its real button in a shadow root (`63e3182`).
3. **Focus never entered the drawer** — the fix for #2 made the wallet `items[0]`, but lit renders its shadow button asynchronously, so `host.focus()` no-ops at open time (`c6f3ad7`).

**Bugs 2 and 3 were invisible *because of* the tests.** Every drawer test mocks `ConnectButton` as a bare `<button>`, which is more accessible than the real custom element. The suite was asserting a property of the test double, not of the application. jsdom additionally has no native `delegatesFocus` (returns `undefined`) and `focus` is a getter-only accessor — so both regression tests simulate their preconditions via `Object.defineProperty`. They prove the helper's logic against a fiction; the browser pass is the load-bearing evidence.
