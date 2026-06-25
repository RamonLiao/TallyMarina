# Type Scale Token + Converging Migration — Design

**Date:** 2026-06-25
**Status:** Approved (design, route B), pending plan
**Scope:** `web/src` frontend typography only

## Problem

Font sizes are scattered across ~134 sites with **no type token**:
- CSS: 50 `font-size` declarations, mostly relative `em` (0.7em–1.1em).
- TSX: 84 inline `fontSize:` numbers (11–28px).

Two distinct defects, confirmed by inspection:

1. **Tech debt:** the same magic number (e.g. `13`, used 19×) is duplicated
   across CSS and TSX with no single source of truth. Changing a size means
   hunting literals in two languages.
2. **Visual disorder ("排版亂"):** the body cluster `13/14/15` is used
   **interchangeably for the same roles** (meta text, paragraphs, links all
   appear at 13 *and* 14 *and* 15 with no rule), and `16` is used both as an
   `<h3>` title and as inline body. Six steps (`11–16`) sit 1px apart — below
   the ~2px / 15% perceptual threshold, so adjacent steps are
   indistinguishable. This is a *cataloged mess*, not a designed hierarchy.

A pixel-neutral migration would fix (1) but leave (2) untouched (it preserves
every existing size by definition). The user wants **both** fixed, so this
design **converges** the scale — accepting deliberate, verified pixel shifts in
exchange for a real hierarchy.

## Goal

1. Introduce a rem-based **modular** type scale as design tokens.
2. Migrate **all** font-size usages to it, **converging** the 1px-apart clutter
   into 6 perceptually-distinct steps with clear roles.
3. Net result: a size change is a one-line token edit, *and* the rendered
   hierarchy reads as intentional (dense vs body vs title are visibly distinct).

This is a **refactor + deliberate visual change**, not pixel-neutral. ~30–40
sites will shift size; each shift is verified in a real browser to confirm it
sharpens hierarchy without breaking layout (reflow check, not pixel-identity).

## Non-goals (YAGNI)

- No structural refactor of components. TSX inline styles stay inline; only the
  value changes to `var(--text-*)`. We do NOT hoist inline styles into CSS
  classes.
- `font-weight` is out of scope.
- `line-height`: **minimal** pairing only — add `--leading-*` for the tiers that
  move enough to risk crowding (base and the title tiers). Not a full
  leading-scale rollout.
- No new sizes beyond the 6 steps below.

## The Scale

Added to `tokens.css :root`, parallel to the existing `--space-N` block.
rem-based (root = 16px), anchored at `--text-base` = body size (15px). Display
tiers follow ~1.2 (minor third), tight enough for a data-dense accounting UI.

| token         | rem        | px | role                                      |
|---------------|------------|----|-------------------------------------------|
| `--text-xs`   | 0.75rem    | 12 | caption, badge, mono-meta, eyebrow label  |
| `--text-sm`   | 0.8125rem  | 13 | dense table body, secondary meta          |
| `--text-base` | 0.9375rem  | 15 | default body, paragraphs, links           |
| `--text-lg`   | 1.125rem   | 18 | panel / section title (`<h3>`)            |
| `--text-xl`   | 1.375rem   | 22 | workspace title                           |
| `--text-2xl`  | 1.75rem    | 28 | hero / landing display                    |

Minimal line-height companions (only where needed):

| token            | value | paired with        |
|------------------|-------|--------------------|
| `--leading-tight`| 1.25  | `--text-lg/xl/2xl` titles |
| `--leading-base` | 1.5   | `--text-base/sm` body     |

rem (not em): anchored to root, no compounding under nesting, responds to
user/browser font-size preferences (a11y).

## Migration Approach

### Convergence mapping

**Deterministic (mechanical replace, 1:1):**

| old px | → token        |
|--------|----------------|
| 11     | `--text-xs` (12) |
| 12     | `--text-xs` (12) |
| 13     | `--text-sm` (13) |
| 15     | `--text-base` (15) |
| 18     | `--text-lg` (18) |
| 22     | `--text-xl` (22) |
| 28     | `--text-2xl` (28) |

**Judgment (decided per rendered role — the two ambiguous tiers):**

- **14 →** `--text-sm` (13) when the context is a dense table cell, uppercase
  eyebrow label (has `letterSpacing`/`textTransform`), or secondary meta; **→**
  `--text-base` (15) when it's paragraph/body copy. Decide by reading the JSX
  role at each of the ~15 sites, not blindly.
- **16 →** `--text-lg` (18) when it's a heading (`<h3>`, panel/section title);
  **→** `--text-base` (15) when it's inline body/value text. Non-text glyphs
  (e.g. `fontSize:16` on a wallet `{w.icon}` emoji) are **icon sizing, not type**
  — leave as a raw value or move to an icon-size concern; do NOT force a text
  token onto them.

### CSS `em` → token (the careful part)

`em` is relative to the element's resolved font-size, so the same `0.9em`
resolves to different pixels in different places. Per `em` site:

1. In a **real browser** (Playwright MCP), read the element's **computed
   `font-size`** at the rendered node (per lessons rule: measure, never eyeball
   or trust jsdom).
2. Map the measured px to the nearest scale step by **role** (same judgment as
   above), replace with `var(--text-*)`.
3. Re-measure; confirm the new computed size is the intended step (it may differ
   from the old px by design — that's the convergence).

If an `em` is **intentionally** relative (sized to scale with a varying parent —
rare, e.g. an inline glyph in a button), keep the `em` + a one-line comment.

## Verification

This is **not** a pixel-identity gate (sizes change on purpose). Instead:

- **Hierarchy + reflow gate (the merge gate):** across 4 breakpoints
  (390/768/1024/1280) × affected workspaces, in a real browser confirm
  (a) the converged sizes read as a clear dense < body < title ladder, and
  (b) no broken layout from the shifts — no clipped text, no crowded lines, no
  new overflow (re-run the element-rect vs clientWidth check from the recent RWD
  fix). Capture before/after screenshots of dense surfaces (Recon table, Policy
  COA, a landing header).
- **`vitest`:** suite stays green. A test that asserts a literal font-size would
  legitimately change — update it to the token's value and document why
  (Rule 9: the test should encode the *role/step*, not a magic px).
- `tsc -b` + `vite build` exit 0.
- Final grep: no raw `fontSize:` numbers and no non-`var` CSS `font-size:` remain
  (minus any documented intentional `em` / icon-size exception).

## Risks & mitigations

| risk | mitigation |
|---|---|
| converging 14/16 by wrong role | decide per-site from JSX role, not by value; verify the rendered hierarchy in browser |
| `em` → step shifts pixels unexpectedly | measure computed font-size in real browser before & after; map by role |
| size shift crowds lines (no leading change) | minimal `--leading-*` pairing on the tiers that move; reflow gate catches crowding |
| inline `var()` typo silently renders default | tsc can't catch (string); rely on build + visual diff |
| icon-as-fontSize mistaken for text | explicitly excluded (`{w.icon}` etc.); leave raw |
| dapp-kit ConnectButton shadow DOM | its web-component text is sized internally; type tokens do NOT reach it — don't assume full-site coverage |
| missing a usage | grep count is the checklist: 50 CSS + 84 TSX = 134; final raw-literal grep must be ~0 minus documented exceptions |

## Deferred / follow-up

- Full `--leading-*` and `font-weight` token scales (separate, future).
- A `.text-*` utility class layer (only if inline `style` proliferation becomes a
  problem; not now).
- mono vs body optical-size reconciliation in accounting tables (mono reads
  heavier at equal px) — noted, not solved here.
