# Type Scale Token + Full Migration — Design

**Date:** 2026-06-25
**Status:** Approved (design), pending plan
**Scope:** `web/src` frontend typography only

## Problem

Font sizes are scattered across ~134 sites with **no type token**:
- CSS: 50 `font-size` declarations, mostly relative `em` (0.7em–1.1em).
- TSX: 84 inline `fontSize:` numbers (11–28px).

The project already has a mature spacing scale (`--space-N` + `--s-N` aliases in
`tokens.css`) but nothing equivalent for type. This is the root cause of the
"字級亂 / 排版亂" the user reported. There is no single source of truth, and
changing a size means hunting magic numbers across both CSS and TSX.

## Goal

Introduce a rem-based t-shirt type scale as design tokens and migrate **all**
existing font-size usages to it, **with zero rendered pixel change** (this is a
refactor, not a redesign). After this, a size change is a one-line token edit.

## Non-goals (YAGNI)

- `line-height` and `font-weight` are **out of scope** this round (keeps the
  blast radius to font-size only).
- No structural refactor of components. TSX inline styles stay inline; only the
  numeric value changes to `var(--text-*)`. We do NOT hoist inline styles into
  CSS classes (that would balloon the diff for no rendering benefit).
- No new sizes invented. The scale is derived to cover existing values so
  migration is pixel-identical.

## The Scale

Added to `tokens.css :root`, parallel to the existing `--space-N` block.
rem-based (root = 16px), anchored at `--text-base` = body size (15px).

| token         | rem        | px | typical use                         |
|---------------|------------|----|-------------------------------------|
| `--text-3xs`  | 0.6875rem  | 11 | tiny captions, mono badges          |
| `--text-2xs`  | 0.75rem    | 12 | badges, secondary captions          |
| `--text-xs`   | 0.8125rem  | 13 | most common label/meta size         |
| `--text-sm`   | 0.875rem   | 14 | dense table/body text               |
| `--text-base` | 0.9375rem  | 15 | body default (matches `body`)       |
| `--text-md`   | 1rem       | 16 | section heads                       |
| `--text-lg`   | 1.125rem   | 18 | panel titles                        |
| `--text-xl`   | 1.375rem   | 22 | workspace titles                    |
| `--text-2xl`  | 1.75rem    | 28 | hero / landing display              |

rem (not em) so values are anchored to root, do not compound under nesting, and
respond to user/browser font-size preferences (a11y).

## Migration Approach

### TSX inline px → token (84 sites, low risk)
The px numbers are absolute and map directly to the table above. Replace
`fontSize: 13` → `fontSize: 'var(--text-xs)'` (value stays inline, only the
literal changes). Direct 1:1, no measurement needed beyond the lookup.

Mapping: 11→3xs, 12→2xs, 13→xs, 14→sm, 15→base, 16→md, 18→lg, 22→xl, 28→2xl.

### CSS px → token (trivial)
The handful of px CSS values (11/12/13/14/15/16) map 1:1 like the TSX numbers.

### CSS em → token (the careful part)
`em` is **relative to the element's own resolved font-size context**, so the
same `0.9em` resolves to different pixels in different places. Blind conversion
to an absolute token can shift rendering. Procedure per `em` site:

1. In a **real browser** (Playwright MCP), read the element's **computed
   `font-size`** at the rendered DOM node (per lessons rule: measure, never eyeball
   or trust jsdom).
2. Round to the nearest scale step; replace with `var(--text-*)`.
3. Re-measure after the change — computed font-size must be **identical** (±0).

If an `em` value is **intentionally** relative (meant to scale with a parent that
itself varies — expected to be rare, e.g. an inline glyph sized to its button),
**keep the `em`** and add a one-line comment explaining why. Do not force-convert.

## Verification

- **Pixel-parity (the merge gate):** for every changed file's rendered surface,
  capture computed `font-size` of affected nodes **before vs after** across the
  4 breakpoints (390/768/1024/1280) × affected workspaces. Diff must be empty.
- `vitest` 390/390 green (no test should change — pure refactor; if one breaks,
  the migration was not pixel-neutral).
- `tsc -b` + `vite build` exit 0.
- Spot screenshot a few dense surfaces (Recon table, Policy COA, a landing
  header) to confirm no visible reflow.

## Risks & mitigations

| risk | mitigation |
|---|---|
| `em` → absolute shifts pixels | measure computed font-size before/after in real browser; keep intentional `em` |
| inline `var()` typo silently renders default | tsc won't catch (string); rely on build + visual diff |
| missing a usage | grep count is the checklist: 50 CSS + 84 TSX = 134; final grep for raw `fontSize:` numbers and CSS `font-size:` non-`var` must be ~0 (minus any documented intentional `em`) |
| scale step rounding loses a distinct value | scale was derived to cover every existing px cluster; em sites round to nearest and are parity-verified |

## Deferred / follow-up

- `line-height` / `font-weight` token scales (separate, future).
- A `.text-*` utility class layer (only if inline `style` proliferation becomes a
  problem; not now).
