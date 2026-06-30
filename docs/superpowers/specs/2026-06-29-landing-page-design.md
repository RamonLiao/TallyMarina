# TallyMarina Landing Page — Design Spec

**Date**: 2026-06-29
**Status**: Approved (brainstorming) + 3-lens review (SUI / accountant / frontend-design) integrated → pending implementation plan

## Goal

A marketing landing page at `/` that states the problem/service/value 一針見血, matching the
existing TallyMarina design system. "Launch App" navigates to the existing dashboard at `/app`.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Entry mechanism | `react-router-dom@^6.26`, top-level only: `/` → Landing, `/app/*` → existing App shell |
| Content depth | Full single-page scroll (hero → problem → services → how-it-works → governance → CTA/footer) |
| Launch behavior | Direct to dashboard; wallet connect stays in app TopBar |
| Implementation | Claude writes directly (design fidelity + browser verification) |
| Hero tone | Outcome-oriented (revised post-review): "Turn on-chain chaos into an audit-ready **close**." |

## Architecture

- Add `react-router-dom@^6.26` (v6, NOT v7 — spec uses plain `BrowserRouter`/`Routes`/`Route`;
  v7 adds breaking type/future-flag changes with no upside here). [SUI review S1]
- `main.tsx`: provider tree wraps a `<BrowserRouter>` + `<Routes>`:
  ```
  AppProviders (QueryClientProvider → DAppKitProvider)
    BrowserRouter
      Routes
        /        → <Landing/>   (new, lightweight)
        /app/*   → <App/>       (existing shell, UNCHANGED)
  ```
  Providers OUTSIDE the router is the canonical pattern; dapp-kit has no router dependency. [SUI Q3]
- Landing "Launch App" CTA → `useNavigate()('/app')`.
- `App.tsx` uses no router hooks and assumes nothing about being at `/`; the `*` splat is never
  consumed inside App; no `basename` needed. [SUI Q4]
- Workspace navigation **stays Context-based** (no conversion to routes) — surgical, preserves the
  working pattern. Only the landing↔app boundary is routed. Add a one-line comment near
  `WorkspaceProvider` noting workspace state is intentionally non-URL (back = return to landing). [SUI N2]
- `autoConnect` fires once at startup as today (provider mounts outside router); invisible on
  landing since it has no wallet UI. No change. [SUI N1]
- Vite dev provides SPA history fallback, so `/app` deep-links work in dev. Production host needs a
  catch-all → `index.html` rewrite — deferred (hackathon demo runs on Vite). [SUI N3, out of scope]

## Landing sections (single-page scroll)

Each adjacent band is rendered in a *different shape* to avoid the "stacked-card-wall SaaS template"
look (frontend review §1, §4): hero artifact → ledger list → bento grid → hash-chain pipeline.

1. **Top nav** (sticky, genuinely minimal): `⚓ TallyMarina` wordmark left, single `Launch App`
   brass pill right. No anchor-link nav (template filler on a one-pager). [FE §4]
2. **Hero — asymmetric split, NOT centered-serif-on-cream** (that's the generic warm-serif AI
   default). [FE §2, §3]
   - **Left**: eyebrow, display headline "Turn on-chain chaos into an audit-ready close.",
     value sub-paragraph, primary CTA `Launch App` + ghost `See the close flow`, mono "Built on Sui"
     chip (tx-hash-truncation aesthetic, not a rounded icon badge).
   - **Right — the signature artifact: a live double-entry journal card.** Raw Sui tx hash (IBM Plex
     Mono) → arrow → resulting balanced journal entry with Dr/Cr lines using `--debit (#B5532E)` /
     `--credit (#2F7A5A)` tokens, tabular-nums, totals ruled with a brass hairline. Shows the
     product's actual output in 2s and is unique to this product. Mascot-free (data surface). On
     390px it stacks under the CTAs. [FE §3 winner]
   - Sub-paragraph copy (accountant-revised, drops "books = full GL" overclaim): "Sui, exchange and
     protocol activity → reconciled, policy-driven journal entries with full source-to-JE lineage —
     reviewed by your team, exported to your ERP." [ACCT hero fix]
3. **Problem — rendered as a ledger of 4 "unreconciled" rows** (a list of broken things, not a 4-card
   grid), red `--debit`-toned markers: siloed data (wallets/CEX/custody/ERP); on-chain events lack
   business context; manual month-end close; chaotic auditing. [FE §1]
4. **Services — 2-tier bento (not a flat 6-wall).** The two on-chain-differentiated tiles
   (Sui-native normalization, immutable-snapshot audit) are featured/wide; the rest smaller.
   Tiles, with accountant-revised copy that stops overclaiming and surfaces the controls a controller
   actually buys on: [ACCT must-fixes 1–5]
   1. **Sui-native normalization** — parses Sui object model + DeepBook protocol events.
   2. **AI-assisted classification — suggests, never posts** (the qualifier IS the selling point).
   3. **Policy-driven accounting** — templated to IFRS / US GAAP treatments, versioned and
      human-approved; **policy-driven cost basis (FIFO today; WAC / specific-ID on roadmap)**.
      (NOT flat "IFRS/US GAAP" — spec §2.5 explicitly does not claim a compliance switch.)
   4. **Double-entry + reconciliation** — quantity & valuation roll-forward, maker-checker
      (segregation-of-duties) controls.
   5. **Immutable, hash-anchored close snapshots** — full source-to-JE audit trail, with *optional*
      Walrus notarization. (Internal snapshot is the control of record; Walrus is NOT the headline —
      spec §6.8/§17 makes Walrus optional/async/non-blocking.)
   6. **ERP-ready export** — COA-mapped, dimension-tagged, balanced, dedup-protected (ERP stays the
      system of record).
   7. **Period close & lock** — close checklist, roll-forward, realized/unrealized gain-loss
      schedules, controlled reopen-with-reason. (The actual GTM wedge per spec §14.1; was missing.)
5. **How it works — hash-chain pipeline**: Ingest → AI suggest → Human approve → Journal →
   Anchor on-chain. Nodes carry mono hash-prefixes; only the final **Anchor** node uses aqua.
   On 390px reuse the existing `.audit-lineage` `@container (max-width:1100px)` column-flip pattern
   (base.css) — vertical stack, drop horizontal connectors. No horizontal-scroll. [FE §2]
6. **Governance strip — pulled up / given real weight** (it's the trust thesis, not a footnote):
   "AI suggests, humans approve — no autonomous posting. Read-only access, no private keys,
   segregation of duties, and every number drills down to its on-chain source." [ACCT trust + FE §1]
7. **Final CTA band + footer** — framed as the *close* of the ledger metaphor ("books balanced /
   period close"), brass rule above, single CTA. Not generic "Ready to get started?". A one-line
   honesty/trust footer is fine ("read-only access · no private keys · single-entity today"). [FE §4]

## Design-system conformance

- Palette: paper cream `#F4ECD8` bg, navy ink `#1E2A4A`, brass `#C9A24B` accents.
- Type: Fraunces (serif) headlines, Mona Sans (sans) body, IBM Plex Mono for hashes/Dr-Cr figures.
  - **Add a scoped `--text-display: clamp(2.75rem, 6vw, 5rem)`** under `.landing` only — the global
    `--text-2xl` (28px) is panel-title sized and can't carry a hero. Do NOT touch the global scale
    (Rule 3). Lean on Fraunces' `opsz` axis (already imported): high opsz on the hero headline for
    thin/thick drama, low opsz on body. [FE §0 — blocker]
- Distinctive devices, used sparingly (Chanel rule — hero journal-entry + ledger-rule dividers is
  enough; don't stack all): ledger-rule section dividers (brass hairline w/ margin marker),
  hash-chain pipeline connector, serif numerals for business/$ figures vs mono for hashes. [FE §3]
- **Restraint (bigger risk than under-designing — austere financial tone):** [FE §5]
  - Brass is understated: fills + 1px hairlines only. No brass glow/gradient/brass-text. One brass
    CTA + brass hairlines is the budget.
  - **aqua used ONLY** for on-chain refs: "Built on Sui" chip, Anchor pipeline node, the snapshot/
    audit tile, final hash node. Anywhere else breaks the token rule (success criteria checks this).
  - Paper grain is already global (3% via `body`). Do NOT add a second noise layer. Austere/navy
    surfaces strip grain — keep the journal-entry card clean if rendered navy.
  - Mascot: otter only in hero chrome/wordmark, never on the journal artifact or any tile.
  - Motion capped: one quiet scroll-reveal (journal entry assembling/balancing), respect
    `prefers-reduced-motion` (already global in base.css). No magnetic buttons, float, or shimmer.
- Cards: 1px `paper-line` border + `shadow-md` + `radius-md`. Reuse `Button` (primary/ghost), `Card`.
- Container: `maxWidth:1200` + `clamp()` responsive padding, matching app shell.

## Files

- New: `web/src/landing/Landing.tsx` + `web/src/landing/landing.css` (section subcomponents inside).
- Edit: `web/src/main.tsx` (router wiring), `web/package.json` (+`react-router-dom@^6.26`).
- Edit: `web/src/components/chrome/TopBar.tsx` — logo → `<Link to="/">` (react-router `Link`, NOT
  `<a href>`, which would full-reload). Add the workspace-state comment near `WorkspaceProvider`
  in `App.tsx`. [SUI S2, N2]

## Success criteria

- `tsc --noEmit` 0 errors, `vite build` 0 errors.
- Real-browser check at 1440px + 390px: no overflow, readable, theme matches; hero journal artifact
  balances and reflows.
- `Launch App` navigates to `/app` and the dashboard renders.
- `/app` deep-link loads dashboard directly; browser back returns to `/`; TopBar logo client-side
  navigates (no full reload).
- aqua appears ONLY on on-chain references.
- No headline overclaim: copy matches business-spec scope (no "audit-ready books", no flat
  "IFRS/US GAAP compliance", Walrus presented as optional).

## Out of scope

- Converting workspace nav to URL routes.
- Wallet-gating the launch.
- Production server SPA-fallback config (dev fallback suffices for hackathon demo; flag before any
  public non-Vite demo). [SUI N3]
- Multi-entity / intercompany / FX revaluation messaging — correctly out of MVP scope; do NOT
  advertise (advertising = overpromise). [ACCT nice-to-have]
