# Type Scale Token + Converging Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~134 scattered font-size literals with a 6-step rem modular type scale, converging the 1px-apart `11–16` clutter into perceptually-distinct roles so the rendered hierarchy reads as intentional.

**Architecture:** Add `--text-*` (+ minimal `--leading-*`) tokens to `tokens.css`, then migrate every CSS `font-size` and TSX inline `fontSize` to them. Most replacements are a deterministic value→token lookup; the `14` and `16` tiers and all CSS `em` values are decided per rendered role and verified in a real browser. This is a deliberate visual refactor (sizes shift ~30–40 sites), gated on hierarchy+reflow, not pixel-identity.

**Tech Stack:** React + Vite + TypeScript, vitest, Playwright MCP (real-browser measurement), plain CSS custom properties.

## Global Constraints

- **Scale (single source of truth, `tokens.css :root`):**
  `--text-xs`=0.75rem(12) · `--text-sm`=0.8125rem(13) · `--text-base`=0.9375rem(15) · `--text-lg`=1.125rem(18) · `--text-xl`=1.375rem(22) · `--text-2xl`=1.75rem(28).
  Leading: `--leading-tight`=1.25 (titles lg/xl/2xl) · `--leading-base`=1.5 (body base/sm).
- **Deterministic map (mechanical):** 11→xs · 12→xs · 13→sm · 15→base · 18→lg · 22→xl · 28→2xl.
- **Judgment map (decide per JSX/CSS role, never by value alone):**
  - `14` → `--text-sm`(13) if dense table cell / uppercase eyebrow label (`letterSpacing`/`textTransform`) / secondary meta; → `--text-base`(15) if paragraph/body copy.
  - `16` → `--text-lg`(18) if heading (`<h3>`, panel/section title); → `--text-base`(15) if inline body/value.
  - **Icon-as-fontSize is NOT type** (e.g. `fontSize:16` on `{w.icon}` emoji) — leave the raw number, do not tokenize.
- **CSS `em`:** measure computed `font-size` in a real browser at the rendered node, map by role to the nearest step, replace with `var(--text-*)`. Keep intentionally-relative `em` + a one-line comment.
- **rem not em** for the tokens (root 16px; no nesting compound; a11y-responsive).
- **Verification is reflow+hierarchy, not pixel-identity.** No test asserts font-size today (verified), so `vitest` must stay fully green throughout — a red test means the migration touched behavior it shouldn't have.
- **Inline styles stay inline**; only the value changes (`fontSize: 13` → `fontSize: 'var(--text-sm)'`). No hoisting into classes. No `font-weight` changes.
- Dev server runs on `:5175` (already up). API on `:8787`.
- Run all `npm` commands from `web/`.

---

### Task 1: Define the type scale tokens

**Files:**
- Modify: `web/src/tokens.css` (add a `── Type scale ──` block after the existing `── Typography ──` block, ~line 35)

**Interfaces:**
- Produces: CSS custom properties `--text-xs|sm|base|lg|xl|2xl` and `--leading-tight|base`, available globally on `:root`. Every later task consumes these.

- [ ] **Step 1: Add the token block**

In `web/src/tokens.css`, immediately after the `--font-mono` line (the Typography block), insert:

```css
  /* ── Type scale ── (rem, root 16px; modular ~1.2 for display tiers,
     anchored at --text-base = body 15px. Single source of truth — change a
     size here, not at call sites. See specs/2026-06-25-type-scale-design.md) */
  --text-xs:   0.75rem;    /* 12px — caption, badge, mono-meta, eyebrow label */
  --text-sm:   0.8125rem;  /* 13px — dense table body, secondary meta */
  --text-base: 0.9375rem;  /* 15px — default body, paragraphs, links */
  --text-lg:   1.125rem;   /* 18px — panel / section title (h3) */
  --text-xl:   1.375rem;   /* 22px — workspace title */
  --text-2xl:  1.75rem;    /* 28px — hero / landing display */

  --leading-tight: 1.25;   /* titles: --text-lg / xl / 2xl */
  --leading-base:  1.5;    /* body: --text-base / sm */
```

- [ ] **Step 2: Verify the build resolves the new tokens**

Run: `cd web && npx tsc -b && npm run build`
Expected: exit 0 (CSS custom properties don't affect TS; build confirms no CSS syntax error).

- [ ] **Step 3: Verify tokens are live in the browser**

With the dev server on `:5175`, use Playwright MCP `browser_evaluate`:
```js
() => getComputedStyle(document.documentElement).getPropertyValue('--text-base').trim()
```
Expected: `"0.9375rem"`. Repeat-spot `--text-lg` → `"1.125rem"`.

- [ ] **Step 4: Commit**

```bash
git add web/src/tokens.css
git commit -m "feat(web/tokens): add rem modular type scale + minimal leading tokens"
```

---

### Task 2: Migrate all CSS font-size (px + em, 9 files)

**Files (all under `web/src`):**
- Modify: `styles/base.css` (3), `components/ui/Table.module.css` (3), `components/ui/Button.module.css` (3), `components/ui/Badge.module.css` (1), `workspaces/export/export.css` (14), `workspaces/policy/policy.css` (9), `workspaces/onboarding/onboarding.css` (7), `workspaces/close/close.css` (6), `workspaces/recon/recon.css` (4)

**Interfaces:**
- Consumes: `--text-*` from Task 1.
- Produces: zero non-`var` `font-size` in CSS (minus any documented intentional `em`).

- [ ] **Step 1: Snapshot the em sites' computed sizes (before)**

For each `em` declaration, you must know its rendered px. List them:
Run: `cd web/src && grep -rn "font-size:.*em" --include="*.css" .`
For each match, in the browser (Playwright MCP) navigate to the workspace that renders that selector, `browser_evaluate` the computed font-size of a representative node:
```js
(sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontSize : 'NOT RENDERED'; }
```
Record `selector → computed px` for every em site. (px `font-size` values need no measurement — they map directly.)

- [ ] **Step 2: Replace px values (deterministic)**

Apply the deterministic map to every `font-size: <N>px`:
`11/12px → var(--text-xs)` · `13px → var(--text-sm)` · `15px → var(--text-base)` · `16px → var(--text-lg)` **only if the selector is a heading/title; else `var(--text-base)`** · `18px → var(--text-lg)` · `14px → see judgment`.
For `14px` and `16px` apply the Global Constraints judgment map by reading the selector's role.

- [ ] **Step 3: Replace em values (by measured role)**

For each em site from Step 1: take the measured px, find its role (dense/body/title), map to the nearest step, replace with `var(--text-*)`. If a site is intentionally relative (sized to a varying parent — rare), keep the `em` and add `/* intentional: scales with parent X */`.

- [ ] **Step 4: Verify no raw CSS font-size remains**

Run: `cd web/src && grep -rn "font-size:" --include="*.css" . | grep -v "var(--text" | grep -v "/\* intentional"`
Expected: empty (or only documented intentional-em lines).

- [ ] **Step 5: Re-measure em sites (after) + reflow check**

Re-run Step 1's measurement for each migrated em selector. Confirm the new computed px equals the intended scale step. Then for each touched workspace, at breakpoints 390/768/1024/1280 run the overflow guard:
```js
() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })
```
Expected: no new horizontal overflow vs the known-good baseline (0 on the recently-fixed pages). Screenshot Policy COA + Export verify card.

- [ ] **Step 6: Verify suite + build still green**

Run: `cd web && npx vitest run && npx tsc -b && npm run build`
Expected: vitest fully green (same count as baseline), tsc + build exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/src/styles/base.css web/src/components/ui/*.css web/src/workspaces/*/*.css
git commit -m "refactor(web/css): migrate all font-size to type-scale tokens (px deterministic, em measured per role)"
```

---

### Task 3: Migrate TSX chrome / shell components

**Files (under `web/src`):**
- Modify: `components/chrome/CopilotDock.tsx` (10), `SideNav.tsx` (3), `EmptyState.tsx` (3), `StepRail.tsx` (2), `TopBar.tsx` (1), `PeriodPill.tsx` (1), `EntitySwitcher.tsx` (1), `Celebration.tsx` (1), `components/data/GuardrailBanner.tsx` (1)

**Interfaces:**
- Consumes: `--text-*` from Task 1.
- Produces: zero raw `fontSize:` numbers in these files (minus documented icon-size exceptions).

- [ ] **Step 1: List every site with its role**

Run: `cd web/src && grep -rEn "fontSize: [0-9]" components/chrome components/data/GuardrailBanner.tsx`
For each, note the JSX role (heading / body / label / icon).

- [ ] **Step 2: Replace by map**

Apply deterministic + judgment maps. Example transforms:
```tsx
// deterministic
fontSize: 13   →  fontSize: 'var(--text-sm)'
fontSize: 11   →  fontSize: 'var(--text-xs)'
// judgment — SideNav SOON badge (uppercase label) 14 → sm
fontSize: 14, textTransform: 'uppercase'   →  fontSize: 'var(--text-sm)', textTransform: 'uppercase'
// judgment — a section <h3> at 16 → lg
fontSize: 16 /* in <h3> */   →  fontSize: 'var(--text-lg)'
// icon — leave raw
fontSize: 16 /* {w.icon} emoji */   →  unchanged
```

- [ ] **Step 3: Verify no raw literals remain (minus icons)**

Run: `cd web/src && grep -rEn "fontSize: [0-9]" components/chrome components/data/GuardrailBanner.tsx`
Expected: empty, or only lines you've confirmed are icon glyph sizing (annotate with a trailing `// icon` comment).

- [ ] **Step 4: vitest + reflow**

Run: `cd web && npx vitest run`
Expected: fully green.
Browser: load each affected surface (SideNav, TopBar, an EmptyState, CopilotDock open), confirm dense<body<title hierarchy reads clearly and no clipping at 390/1280. Screenshot CopilotDock.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/chrome/*.tsx web/src/components/data/GuardrailBanner.tsx
git commit -m "refactor(web/chrome): migrate inline fontSize to type-scale tokens"
```

---

### Task 4: Migrate TSX data / forensic components

**Files (under `web/src/components/data`):**
- Modify: `EventLineage.tsx` (14), `DispositionControls.tsx` (7), `HashChain.tsx` (5), `ExceptionList.tsx` (5), `EventList.tsx` (5), `DecideForm.tsx` (4), `JournalTable.tsx` (3), `ExceptionDetail.tsx` (2), `EventCompare.tsx` (2), `ProofBadge.tsx` (1), `ConfidenceBar.tsx` (1)

**Interfaces:**
- Consumes: `--text-*` from Task 1.
- Produces: zero raw `fontSize:` numbers in these files (minus documented icon-size).

- [ ] **Step 1: List sites with roles**

Run: `cd web/src && grep -rEn "fontSize: [0-9]" components/data | grep -vE "GuardrailBanner"`
Note role per site. **These are data-dense surfaces** — most `13/14` here are table/meta → `--text-sm`; mono numeric cells (`.td--mono` siblings) stay at their step (do not bump mono up — it reads heavier, per spec deferred note).

- [ ] **Step 2: Replace by map** (deterministic + judgment, same transforms as Task 3 Step 2).

- [ ] **Step 3: Verify no raw literals remain**

Run: `cd web/src && grep -rEn "fontSize: [0-9]" components/data | grep -vE "GuardrailBanner|// icon"`
Expected: empty.

- [ ] **Step 4: vitest + reflow on dense tables**

Run: `cd web && npx vitest run`
Expected: green.
Browser: open Audit (EventLineage 4-column), Reconciliation table, Exceptions list at 390/768/1024/1280. Run the overflow guard (Task 2 Step 5 snippet) — expect no new overflow. Confirm mono numeric columns still align. Screenshot EventLineage + Recon table.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/data/*.tsx
git commit -m "refactor(web/data): migrate inline fontSize to type-scale tokens"
```

---

### Task 5: Migrate TSX steps + workspaces

**Files (under `web/src`):**
- Modify: `steps/ClassifyStep.tsx` (3), `IngestStep.tsx` (2), `AnchorStep.tsx` (2), `JournalStep.tsx` (1), `ReviewStep.tsx` (1), `workspaces/ExceptionsWorkspace.tsx` (2), `workspaces/AuditWorkspace.tsx` (1)

**Interfaces:**
- Consumes: `--text-*` from Task 1.
- Produces: zero raw `fontSize:` numbers in these files.

- [ ] **Step 1: List sites with roles**

Run: `cd web/src && grep -rEn "fontSize: [0-9]" steps workspaces`

- [ ] **Step 2: Replace by map** (deterministic + judgment).

- [ ] **Step 3: Verify no raw literals remain**

Run: `cd web/src && grep -rEn "fontSize: [0-9]" steps workspaces`
Expected: empty.

- [ ] **Step 4: vitest + reflow**

Run: `cd web && npx vitest run`
Expected: green.
Browser: walk the close-flow steps + Exceptions/Audit workspaces at 390/1280, overflow guard, screenshot one step header.

- [ ] **Step 5: Commit**

```bash
git add web/src/steps/*.tsx web/src/workspaces/ExceptionsWorkspace.tsx web/src/workspaces/AuditWorkspace.tsx
git commit -m "refactor(web/steps,workspaces): migrate inline fontSize to type-scale tokens"
```

---

### Task 6: Final convergence sweep + full reflow gate

**Files:** none new — verification + any stragglers found.

**Interfaces:**
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1: Global raw-literal sweep**

Run:
```bash
cd web/src
echo "--- TSX stragglers (excl. icon comments) ---"
grep -rEn "fontSize: [0-9]" --include="*.tsx" . | grep -v "// icon"
echo "--- CSS stragglers (excl. var + intentional) ---"
grep -rn "font-size:" --include="*.css" . | grep -v "var(--text" | grep -v "/\* intentional"
```
Expected: both empty. If anything prints, migrate it (apply the maps) and re-run before continuing.

- [ ] **Step 2: Full real-browser reflow + hierarchy gate**

Across all 7 workspaces × 4 breakpoints (390/768/1024/1280), in Playwright MCP:
```js
() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })
```
Expected: 0 new horizontal overflow vs baseline (the RWD fix left these at 0). Visually confirm on each: dense table text < body < section title is a legible ladder (the convergence goal). Capture a before/after screenshot pair of Recon table, Policy COA, and a landing header (compare against the pre-migration screenshots from Tasks 2/4).

- [ ] **Step 3: Full verification suite**

Run: `cd web && npx vitest run && npx tsc -b && npm run build`
Expected: vitest fully green (same baseline count), tsc + build exit 0.

- [ ] **Step 4: Update tasks/progress.md + commit**

Summarize the migration (files touched, sites converged, verification evidence) in `tasks/progress.md`, then:
```bash
git add tasks/progress.md
git commit -m "docs(progress): type-scale migration complete + verified"
```

---

## Post-plan: dual-review

This is a multi-file frontend refactor (not a trivial CSS one-liner), so per
`~/.claude/rules/general/dev-rules.md` run the two-round `dual-review` after Task
6 before merge: round 1 codex generic review, round 2 project skills
(`sui-frontend` for any dApp-kit-adjacent surface + `frontend-design` for the
hierarchy outcome). Integrate findings, then decide merge/PR.
```
