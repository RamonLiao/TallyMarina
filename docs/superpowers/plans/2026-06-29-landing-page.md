# TallyMarina Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a marketing landing page at `/` whose "Launch App" CTA navigates to the existing dashboard at `/app`, matching the TallyMarina design system.

**Architecture:** Introduce `react-router-dom` at the top level only — `/` → new `<Landing/>`, `/app/*` → existing `<App/>` shell unchanged. Workspace navigation stays Context-based. The landing's signature element is a real double-entry journal-entry artifact built from `--debit`/`--credit` tokens.

**Tech Stack:** React 18.3 + TypeScript + Vite 5.4, `react-router-dom@^6.26`, existing design tokens (`tokens.css`), Vitest + Testing Library for unit/routing tests.

## Global Constraints

- `react-router-dom` pinned to `^6.26` (NOT v7). Use plain `BrowserRouter`/`Routes`/`Route`.
- No new dependency beyond `react-router-dom`. Reuse existing `Button`, `Card`, tokens.
- Design tokens only — NO hex literals in landing code except inside `landing.css` `:root`-scoped vars; all colors via `var(--token)`.
- **aqua (`--aqua`/`--aqua-bright`) ONLY** on on-chain references: "Built on Sui" chip, Anchor pipeline node, snapshot/audit tile, final hash node. Nowhere else.
- Brass understated: fills + 1px hairlines only. No brass text/glow/gradient.
- No mascot on the journal artifact or any data tile (otter only in nav wordmark/hero chrome).
- Do NOT modify the global type scale; add `--text-display` scoped under `.landing` only.
- Copy must not overclaim: NO "audit-ready books", NO flat "IFRS/US GAAP compliance", Walrus shown as *optional*. Hero = "Turn on-chain chaos into an audit-ready close."
- `App.tsx` shell stays UNCHANGED except one clarifying comment near `WorkspaceProvider`.
- Respect `prefers-reduced-motion` (already handled globally in base.css) for any scroll-reveal.

---

### Task 1: Routing skeleton + working `/` → `/app` gate

Delivers the end-to-end gate first (de-risks the router decision) with a placeholder Landing that is fleshed out in later tasks.

**Files:**
- Modify: `web/package.json` (add `react-router-dom@^6.26`)
- Create: `web/src/AppRoutes.tsx`
- Create: `web/src/landing/Landing.tsx` (placeholder, expanded in Task 3)
- Modify: `web/src/main.tsx`
- Modify: `web/src/App.tsx` (one comment only)
- Modify: `web/src/components/chrome/TopBar.tsx` (logo → `<Link>`)
- Test: `web/src/landing/__tests__/routing.test.tsx`

**Interfaces:**
- Produces: `AppRoutes` (default-free named export) rendering `Routes`; `Landing` default export. Later tasks import `Landing` and replace its body.

- [ ] **Step 1: Install the router**

```bash
cd web && npm install react-router-dom@^6.26
```

Expected: `package.json` dependencies now include `"react-router-dom": "^6.26.x"`, install exits 0.

- [ ] **Step 2: Write the failing routing test**

Create `web/src/landing/__tests__/routing.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../AppRoutes';

// Stub the heavy app shell — this test verifies ROUTING, not the dashboard.
vi.mock('../../App', () => ({ default: () => <div>DASHBOARD_MARKER</div> }));

describe('landing → app routing', () => {
  it('renders the Landing at "/" and not the dashboard', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.queryByText('DASHBOARD_MARKER')).toBeNull();
    expect(screen.getByRole('button', { name: /launch app/i })).toBeInTheDocument();
  });

  it('navigates to the dashboard when Launch App is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /launch app/i }));
    expect(screen.getByText('DASHBOARD_MARKER')).toBeInTheDocument();
  });

  it('renders the dashboard directly on a /app deep-link', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByText('DASHBOARD_MARKER')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/landing/__tests__/routing.test.tsx`
Expected: FAIL — cannot resolve `../../AppRoutes` (module not created yet).

- [ ] **Step 4: Create the placeholder Landing**

Create `web/src/landing/Landing.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export default function Landing() {
  const navigate = useNavigate();
  return (
    <main className="landing">
      <h1>Turn on-chain chaos into an audit-ready close.</h1>
      <Button variant="primary" onClick={() => navigate('/app')}>
        Launch App
      </Button>
    </main>
  );
}
```

- [ ] **Step 5: Create AppRoutes**

Create `web/src/AppRoutes.tsx`:

```tsx
import { Routes, Route } from 'react-router-dom';
import App from './App';
import Landing from './landing/Landing';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app/*" element={<App />} />
    </Routes>
  );
}
```

- [ ] **Step 6: Run the routing test to verify it passes**

Run: `cd web && npx vitest run src/landing/__tests__/routing.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Wire the router into main.tsx**

Modify `web/src/main.tsx` — replace the `<App />` render with the router:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/mona-sans';
import './tokens.css';
import './styles/base.css';
import { AppProviders } from './providers/AppProviders';
import { AppRoutes } from './AppRoutes';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
);
```

- [ ] **Step 8: TopBar logo → client-side `<Link>`**

In `web/src/components/chrome/TopBar.tsx`: add `import { Link } from 'react-router-dom';` and wrap the logo `<div>` (the one containing `<Mascot>` + the `TallyMarina` span, lines 26-36) in a `<Link to="/">` with `style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', textDecoration: 'none' }}`. Keep the inner markup identical. (Plain `<a href>` would full-reload and defeat the SPA — SUI review S2.)

- [ ] **Step 9: Add the workspace-state comment in App.tsx**

In `web/src/App.tsx`, immediately above `<WorkspaceProvider>` (line 107), add:

```tsx
{/* NOTE: workspace state is intentionally NON-URL (Context, not routes).
    Browser back from /app returns to the "/" landing and unmounts these
    providers — that's by design, not a bug. */}
```

- [ ] **Step 10: Typecheck + build + commit**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: 0 errors, build succeeds.

```bash
git add web/package.json web/package-lock.json web/src/AppRoutes.tsx web/src/main.tsx web/src/App.tsx web/src/landing/Landing.tsx web/src/landing/__tests__/routing.test.tsx web/src/components/chrome/TopBar.tsx
git commit -m "feat(landing): top-level router gate / → landing, /app → dashboard"
```

---

### Task 2: Journal-entry artifact (the signature element)

A real balanced double-entry card: raw Sui tx hash → resulting Dr/Cr journal entry. The balance invariant (Dr total === Cr total) is the testable intent — a journal that doesn't balance is wrong accounting and must fail the test.

**Files:**
- Create: `web/src/landing/sampleEntry.ts`
- Create: `web/src/landing/JournalArtifact.tsx`
- Test: `web/src/landing/__tests__/sampleEntry.test.ts`

**Interfaces:**
- Produces:
  - `sampleEntry: { txDigest: string; lines: JournalLine[]; memo: string }`
  - `type JournalLine = { account: string; debit: number; credit: number }`
  - `totals(lines: JournalLine[]): { debit: number; credit: number }`
  - `<JournalArtifact />` (no props) — consumed by Task 3 hero.

- [ ] **Step 1: Write the failing balance test**

Create `web/src/landing/__tests__/sampleEntry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sampleEntry, totals } from '../sampleEntry';

describe('sample journal entry', () => {
  it('is a balanced double-entry (debits === credits)', () => {
    const { debit, credit } = totals(sampleEntry.lines);
    expect(debit).toBeGreaterThan(0);
    expect(debit).toBe(credit);
  });

  it('has at least one debit line and one credit line', () => {
    expect(sampleEntry.lines.some((l) => l.debit > 0)).toBe(true);
    expect(sampleEntry.lines.some((l) => l.credit > 0)).toBe(true);
  });

  it('references a Sui tx digest', () => {
    expect(sampleEntry.txDigest).toMatch(/^0x[0-9a-fA-F]+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/landing/__tests__/sampleEntry.test.ts`
Expected: FAIL — cannot resolve `../sampleEntry`.

- [ ] **Step 3: Write the sample entry module**

Create `web/src/landing/sampleEntry.ts`:

```ts
export type JournalLine = { account: string; debit: number; credit: number };

export const sampleEntry = {
  txDigest: '0x9f3ac1d27b4e8a5c0f61d2e7b8a4c903fe12db6740a9c8e35b1f02d7a6c4e98b',
  memo: 'DeepBook swap — USDC → SUI, settled on-chain',
  lines: [
    { account: '1100 · Digital Assets — SUI', debit: 12_480.0, credit: 0 },
    { account: '1020 · Digital Assets — USDC', debit: 0, credit: 12_500.0 },
    { account: '6200 · Trading Fees', debit: 20.0, credit: 0 },
  ] as JournalLine[],
};

export function totals(lines: JournalLine[]): { debit: number; credit: number } {
  return lines.reduce(
    (acc, l) => ({ debit: acc.debit + l.debit, credit: acc.credit + l.credit }),
    { debit: 0, credit: 0 },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/landing/__tests__/sampleEntry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Build the JournalArtifact component**

Create `web/src/landing/JournalArtifact.tsx`. Renders an austere (navy) card: a mono tx-digest header (truncated), an arrow/label, then a journal table with Dr/Cr columns (tabular-nums), Dr in `var(--debit)`, Cr in `var(--credit)`, a brass-hairline ruled totals row. Mascot-free.

```tsx
import { sampleEntry, totals } from './sampleEntry';

const fmt = (n: number) =>
  n === 0 ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const truncate = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export function JournalArtifact() {
  const { debit, credit } = totals(sampleEntry.lines);
  return (
    <figure className="landing-journal" aria-label="Example journal entry generated from a Sui transaction">
      <div className="landing-journal__src">
        <span className="landing-journal__label">Sui tx</span>
        <code className="landing-journal__hash">{truncate(sampleEntry.txDigest)}</code>
      </div>
      <div className="landing-journal__memo">{sampleEntry.memo}</div>
      <table className="landing-journal__table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col" className="num">Debit</th>
            <th scope="col" className="num">Credit</th>
          </tr>
        </thead>
        <tbody>
          {sampleEntry.lines.map((l) => (
            <tr key={l.account}>
              <td>{l.account}</td>
              <td className="num dr">{fmt(l.debit)}</td>
              <td className="num cr">{fmt(l.credit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Balanced</td>
            <td className="num dr">{fmt(debit)}</td>
            <td className="num cr">{fmt(credit)}</td>
          </tr>
        </tfoot>
      </table>
    </figure>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add web/src/landing/sampleEntry.ts web/src/landing/JournalArtifact.tsx web/src/landing/__tests__/sampleEntry.test.ts
git commit -m "feat(landing): balanced double-entry journal artifact (signature element)"
```

---

### Task 3: Full landing sections + copy + styles

Expand the placeholder Landing into the full single-page scroll with review-approved copy and the per-section shape variety (ledger rows / bento / hash-chain). Styling lives in `landing.css`.

**Files:**
- Modify: `web/src/landing/Landing.tsx`
- Create: `web/src/landing/landing.css`
- Create: `web/src/landing/sections.tsx` (Problem / Services / HowItWorks / Governance / CTA subcomponents)
- Test: `web/src/landing/__tests__/landingCopy.test.tsx`

**Interfaces:**
- Consumes: `JournalArtifact` (Task 2).
- Produces: section components used only inside `Landing`.

- [ ] **Step 1: Write the failing copy/intent test**

Why this test matters: it locks in the accountant review's anti-overclaim rules and the presence of the controls story (close/lock, maker-checker). If a future edit reintroduces "audit-ready books" or drops the close/lock tile, this fails.

Create `web/src/landing/__tests__/landingCopy.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from '../Landing';

const renderLanding = () =>
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );

describe('landing copy guardrails (accountant review)', () => {
  it('hero says "audit-ready close", never the overclaim "audit-ready books"', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/audit-ready close/i);
    expect(document.body.textContent).not.toMatch(/audit-ready books/i);
  });

  it('does not flatly claim IFRS/US GAAP compliance', () => {
    renderLanding();
    // "templated to" framing is allowed; a bare "GAAP compliant" claim is not.
    expect(document.body.textContent).not.toMatch(/gaap compliant|compliant switch/i);
  });

  it('surfaces the controls story: period close & lock + maker-checker', () => {
    renderLanding();
    expect(document.body.textContent).toMatch(/period close/i);
    expect(document.body.textContent).toMatch(/maker-checker|segregation of duties/i);
  });

  it('presents Walrus as optional, not the audit headline', () => {
    renderLanding();
    const text = document.body.textContent ?? '';
    if (/walrus/i.test(text)) {
      expect(text).toMatch(/optional[^.]*walrus|walrus[^.]*optional/i);
    }
  });

  it('keeps a working Launch App CTA', () => {
    renderLanding();
    expect(screen.getAllByRole('button', { name: /launch app/i }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/landing/__tests__/landingCopy.test.tsx`
Expected: FAIL — placeholder Landing has no "period close"/"maker-checker" text.

- [ ] **Step 3: Write the section subcomponents**

Create `web/src/landing/sections.tsx` with the review-approved content. Render shapes differ per section (Problem = ledger rows; Services = bento; HowItWorks = hash-chain).

```tsx
const PROBLEMS = [
  'Balances live in silos — wallets, CEXs, custodians, ERPs — and never tie out.',
  'On-chain events carry no business context: a transfer isn’t a "vendor payment".',
  'Month-end close is manual, spreadsheet-driven, and slips every period.',
  'Auditors ask "show me the source" and there’s no clean trail from JE to chain.',
];

const SERVICES: { title: string; body: string; featured?: boolean; onchain?: boolean }[] = [
  { title: 'Sui-native normalization', body: 'Parses the Sui object model and DeepBook protocol events into typed economic activity.', featured: true, onchain: true },
  { title: 'Immutable, hash-anchored snapshots', body: 'Every close produces a tamper-evident snapshot with full source-to-JE lineage. Optional Walrus notarization.', featured: true, onchain: true },
  { title: 'AI-assisted classification', body: 'AI suggests treatments — it never posts. Every suggestion carries a confidence score and a human approves.' },
  { title: 'Policy-driven accounting', body: 'Treatments templated to IFRS / US GAAP, versioned and human-approved. Policy-driven cost basis (FIFO today; WAC / specific-ID on the roadmap).' },
  { title: 'Double-entry + reconciliation', body: 'Balanced journals with quantity & valuation roll-forward and maker-checker (segregation-of-duties) controls.' },
  { title: 'Period close & lock', body: 'Close checklist, roll-forward, realized/unrealized gain-loss schedules, and controlled reopen-with-reason.' },
  { title: 'ERP-ready export', body: 'COA-mapped, dimension-tagged, balanced, dedup-protected output — your ERP stays the system of record.' },
];

const STAGES = ['Ingest', 'AI suggest', 'Human approve', 'Journal', 'Anchor on-chain'];

export function ProblemSection() {
  return (
    <section className="landing-section landing-problem" aria-labelledby="problem-h">
      <h2 id="problem-h" className="landing-section__title">Crypto activity isn’t accounting — yet.</h2>
      <ul className="landing-ledger">
        {PROBLEMS.map((p, i) => (
          <li key={i} className="landing-ledger__row">
            <span className="landing-ledger__mark" aria-hidden="true" />
            <span className="landing-ledger__text">{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ServicesSection() {
  return (
    <section className="landing-section landing-services" aria-labelledby="services-h">
      <h2 id="services-h" className="landing-section__title">One platform, source to ledger.</h2>
      <div className="landing-bento">
        {SERVICES.map((s) => (
          <article
            key={s.title}
            className={`landing-tile${s.featured ? ' landing-tile--featured' : ''}${s.onchain ? ' landing-tile--onchain' : ''}`}
          >
            <h3 className="landing-tile__title">{s.title}</h3>
            <p className="landing-tile__body">{s.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function HowItWorksSection() {
  return (
    <section className="landing-section landing-how" aria-labelledby="how-h">
      <h2 id="how-h" className="landing-section__title">How a close happens.</h2>
      <ol className="landing-pipeline">
        {STAGES.map((stage, i) => (
          <li key={stage} className={`landing-pipeline__node${i === STAGES.length - 1 ? ' landing-pipeline__node--anchor' : ''}`}>
            <span className="landing-pipeline__idx">{String(i + 1).padStart(2, '0')}</span>
            <span className="landing-pipeline__label">{stage}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function GovernanceSection() {
  return (
    <section className="landing-section landing-gov" aria-labelledby="gov-h">
      <p id="gov-h" className="landing-gov__line">
        <strong>AI suggests, humans approve — no autonomous posting.</strong> Read-only access,
        no private keys, segregation of duties, and every number drills down to its on-chain source.
      </p>
    </section>
  );
}

export function CtaSection({ onLaunch }: { onLaunch: () => void }) {
  return (
    <section className="landing-section landing-cta" aria-labelledby="cta-h">
      <hr className="landing-rule" />
      <h2 id="cta-h" className="landing-section__title">Close the books on on-chain chaos.</h2>
      <button className="btn btn--primary btn--lg" onClick={onLaunch}>Launch App</button>
      <p className="landing-foot">Read-only access · no private keys · single-entity today</p>
    </section>
  );
}
```

Note: `CtaSection` uses raw `btn btn--primary` classes (global base.css) to keep one more `getAllByRole('button', {name:/launch app/i})` match without importing the `Button` module here; the hero uses the `Button` component. Both resolve to the same visual.

- [ ] **Step 4: Rewrite Landing.tsx with the full page**

Replace `web/src/landing/Landing.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Mascot } from '../components/chrome/Mascot';
import { JournalArtifact } from './JournalArtifact';
import {
  ProblemSection,
  ServicesSection,
  HowItWorksSection,
  GovernanceSection,
  CtaSection,
} from './sections';
import './landing.css';

export default function Landing() {
  const navigate = useNavigate();
  const launch = () => navigate('/app');
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav__brand">
          <Mascot pose="sailing" size={28} />
          <span className="landing-nav__wordmark">TallyMarina</span>
        </div>
        <Button variant="primary" onClick={launch}>Launch App</Button>
      </header>

      <section className="landing-hero">
        <div className="landing-hero__copy">
          <p className="landing-hero__eyebrow">Digital-asset subledger</p>
          <h1 className="landing-hero__headline">Turn on-chain chaos into an audit-ready close.</h1>
          <p className="landing-hero__sub">
            Sui, exchange and protocol activity → reconciled, policy-driven journal entries with
            full source-to-JE lineage — reviewed by your team, exported to your ERP.
          </p>
          <div className="landing-hero__cta">
            <Button variant="primary" onClick={launch}>Launch App</Button>
            <Button variant="ghost" onClick={launch}>See the close flow</Button>
          </div>
          <code className="landing-hero__chip">⛓ Built on Sui</code>
        </div>
        <div className="landing-hero__art">
          <JournalArtifact />
        </div>
      </section>

      <ProblemSection />
      <ServicesSection />
      <HowItWorksSection />
      <GovernanceSection />
      <CtaSection onLaunch={launch} />
    </div>
  );
}
```

- [ ] **Step 5: Write landing.css**

Create `web/src/landing/landing.css`. Scope everything under `.landing`. Define the display tier, hero split, ledger rows, bento, hash-chain pipeline, governance strip. Mobile reflow via container/media query mirroring the `.audit-lineage` column-flip. Full file:

```css
.landing {
  --text-display: clamp(2.75rem, 6vw, 5rem);
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 clamp(16px, 4vw, 48px) var(--space-10);
  color: var(--ink);
}

/* Nav */
.landing-nav {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-2) 0;
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--paper-line);
}
.landing-nav__brand { display: flex; align-items: center; gap: var(--space-1); }
.landing-nav__wordmark {
  font-family: var(--font-display); font-size: var(--text-xl);
  font-weight: 560; letter-spacing: -0.02em; color: var(--ink);
}

/* Hero — asymmetric split */
.landing-hero {
  display: grid; grid-template-columns: 1.05fr 0.95fr; gap: var(--space-6);
  align-items: center; padding: var(--space-10) 0 var(--space-8);
}
.landing-hero__eyebrow {
  font-family: var(--font-mono); font-size: var(--text-xs);
  text-transform: uppercase; letter-spacing: 0.14em; color: var(--brass);
  margin: 0 0 var(--space-2);
}
.landing-hero__headline {
  font-family: var(--font-display); font-size: var(--text-display);
  font-weight: 560; line-height: 1.04; letter-spacing: -0.02em;
  font-variation-settings: 'opsz' 120; margin: 0 0 var(--space-3);
}
.landing-hero__sub {
  font-size: var(--text-lg); line-height: var(--leading-base);
  color: var(--ink-soft); max-width: 46ch; margin: 0 0 var(--space-4);
}
.landing-hero__cta { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-3); }
.landing-hero__chip {
  display: inline-block; font-family: var(--font-mono); font-size: var(--text-xs);
  color: var(--aqua); border: 1px solid color-mix(in srgb, var(--aqua) 40%, transparent);
  border-radius: var(--radius-pill); padding: 4px 12px; letter-spacing: 0.04em;
}

/* Journal artifact (austere navy data surface — no grain, no mascot) */
.landing-journal {
  margin: 0; background: var(--ink); color: var(--austere-mono);
  border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
  padding: var(--space-3); border: 1px solid rgba(255,255,255,0.06);
}
.landing-journal__src { display: flex; align-items: baseline; gap: var(--space-2); }
.landing-journal__label {
  font-family: var(--font-mono); font-size: var(--text-xs);
  text-transform: uppercase; letter-spacing: 0.12em; color: var(--aqua-bright);
}
.landing-journal__hash { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--austere-mono); }
.landing-journal__memo { font-size: var(--text-sm); color: var(--austere-ink); margin: var(--space-1) 0 var(--space-3); }
.landing-journal__table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.landing-journal__table th {
  text-align: left; font-family: var(--font-mono); font-size: var(--text-xs);
  text-transform: uppercase; letter-spacing: 0.08em; color: var(--austere-ink);
  padding-bottom: var(--space-1); font-weight: 500;
}
.landing-journal__table .num { text-align: right; font-variant-numeric: tabular-nums; }
.landing-journal__table td { padding: 6px 0; }
.landing-journal__table .dr { color: var(--debit); }
.landing-journal__table .cr { color: var(--credit); }
.landing-journal__table tfoot td {
  border-top: 1px solid var(--brass); padding-top: var(--space-1);
  font-weight: 600;
}

/* Section scaffolding */
.landing-section { padding: var(--space-8) 0; }
.landing-section__title {
  font-family: var(--font-display); font-size: var(--text-2xl);
  font-weight: 540; letter-spacing: -0.01em; margin: 0 0 var(--space-4);
}

/* Problem — ledger rows */
.landing-ledger { list-style: none; margin: 0; padding: 0; }
.landing-ledger__row {
  display: flex; align-items: flex-start; gap: var(--space-2);
  padding: var(--space-2) 0; border-bottom: 1px solid var(--paper-line);
  font-size: var(--text-lg); color: var(--ink-soft);
}
.landing-ledger__mark {
  flex: 0 0 auto; width: 8px; height: 8px; margin-top: 9px;
  border-radius: 2px; background: var(--debit);
}

/* Services — bento */
.landing-bento { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); }
.landing-tile {
  background: var(--paper-card); border: 1px solid var(--paper-line);
  border-radius: var(--radius-md); box-shadow: var(--shadow-md); padding: var(--space-3);
}
.landing-tile--featured { grid-column: span 2; }
.landing-tile--onchain { border-color: color-mix(in srgb, var(--aqua) 35%, var(--paper-line)); }
.landing-tile__title { font-family: var(--font-display); font-size: var(--text-lg); margin: 0 0 var(--space-1); }
.landing-tile__body { font-size: var(--text-base); color: var(--ink-soft); line-height: var(--leading-base); margin: 0; }

/* How it works — hash-chain pipeline */
.landing-pipeline {
  list-style: none; margin: 0; padding: 0;
  display: flex; align-items: stretch; gap: var(--space-2);
}
.landing-pipeline__node {
  flex: 1; display: flex; flex-direction: column; gap: var(--space-1);
  padding: var(--space-2); background: var(--paper-card);
  border: 1px solid var(--paper-line); border-radius: var(--radius-sm);
  position: relative;
}
.landing-pipeline__node:not(:last-child)::after {
  content: '→'; position: absolute; right: calc(-1 * var(--space-2)); top: 50%;
  transform: translateY(-50%); color: var(--brass); font-family: var(--font-mono);
}
.landing-pipeline__idx { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--brass); }
.landing-pipeline__label { font-size: var(--text-base); font-weight: 500; }
.landing-pipeline__node--anchor { border-color: color-mix(in srgb, var(--aqua) 45%, var(--paper-line)); }
.landing-pipeline__node--anchor .landing-pipeline__label { color: var(--aqua); }

/* Governance strip */
.landing-gov { text-align: center; }
.landing-gov__line {
  max-width: 70ch; margin: 0 auto; font-size: var(--text-lg);
  line-height: var(--leading-base); color: var(--ink);
}
.landing-gov__line strong { font-family: var(--font-display); font-weight: 560; }

/* CTA */
.landing-cta { text-align: center; }
.landing-rule { border: none; border-top: 1px solid var(--brass); margin: 0 0 var(--space-6); }
.landing-foot { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--ink-soft); margin-top: var(--space-3); }

/* Mobile reflow — mirror the .audit-lineage column-flip precedent */
@media (max-width: 860px) {
  .landing-hero { grid-template-columns: 1fr; }
  .landing-bento { grid-template-columns: 1fr; }
  .landing-tile--featured { grid-column: auto; }
  .landing-pipeline { flex-direction: column; }
  .landing-pipeline__node:not(:last-child)::after { content: '↓'; right: 50%; top: auto; bottom: calc(-1 * var(--space-2)); transform: translateX(50%); }
}
```

- [ ] **Step 6: Run the copy test to verify it passes**

Run: `cd web && npx vitest run src/landing/__tests__/landingCopy.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 7: Full unit suite + typecheck + build**

Run: `cd web && npx vitest run src/landing && npx tsc --noEmit && npm run build`
Expected: all landing tests pass, 0 type errors, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add web/src/landing/Landing.tsx web/src/landing/sections.tsx web/src/landing/landing.css web/src/landing/__tests__/landingCopy.test.tsx
git commit -m "feat(landing): full single-page sections, review-approved copy + styles"
```

---

### Task 4: Browser verification + theme/responsive conformance

No new unit test — this task verifies the rendered result against the success criteria with a real browser at two widths and an aqua-usage audit. Fixes are styling-only.

**Files:**
- Modify (only if a defect is found): `web/src/landing/landing.css`

- [ ] **Step 1: Start the dev server**

Run (background): `cd web && npm run dev`
Note the local URL (typically `http://localhost:5173`).

- [ ] **Step 2: Desktop check (1440px)**

Open `http://localhost:5173/` in a browser at 1440px. Verify visually + via element rects:
- Hero is a left-copy / right-journal split; headline renders at the large display size (not 28px).
- Journal artifact shows Dr in burnt-orange, Cr in green, totals ruled with a brass line, and Debit total === Credit total (12,500.00 = 12,500.00).
- Problem renders as ledger rows (not a card grid); Services as a bento with the two on-chain tiles wider.
- Pipeline is horizontal with brass `→` connectors; only the "Anchor on-chain" node is aqua.
- No overflow, no per-character wrapping.

- [ ] **Step 3: aqua audit**

Confirm aqua (`--aqua`/`--aqua-bright`) appears ONLY on: "Built on Sui" chip, the two `--onchain` tile borders, the Anchor pipeline node, and the journal `Sui tx` label. Nowhere else. If found elsewhere, remove it.

- [ ] **Step 4: Mobile check (390px)**

Resize to 390px. Verify: hero stacks (copy then journal), bento collapses to 1 column, pipeline flips vertical with `↓` connectors, nothing overflows horizontally.

- [ ] **Step 5: Navigation + deep-link check**

- Click `Launch App` (hero) → URL becomes `/app`, dashboard shell renders.
- Browser back → returns to `/` landing.
- Hard-load `http://localhost:5173/app` directly → dashboard renders (Vite fallback).
- Click the TopBar logo in `/app` → returns to `/` with NO full-page reload (network panel shows no document re-fetch).

- [ ] **Step 6: Capture evidence + fix any defects**

Screenshot 1440px and 390px. If any check fails, fix in `landing.css` only (styling), re-verify, then:

```bash
git add web/src/landing/landing.css
git commit -m "fix(landing): browser-verified responsive/theme conformance"
```

(If no defects, no commit needed for this task — verification only.)

- [ ] **Step 7: Stop the dev server**

Stop the background `npm run dev` process.

---

## Self-Review

**Spec coverage:**
- Router `/`→Landing, `/app/*`→App unchanged → Task 1. ✓
- `react-router-dom@^6.26`, providers outside router, no basename → Task 1 (Global Constraints + Steps 1,5,7). ✓
- TopBar `<Link>`, App.tsx comment → Task 1 Steps 8–9. ✓
- Hero revised copy + asymmetric split + journal artifact → Tasks 2, 3. ✓
- `--text-display` scoped, Fraunces opsz → Task 3 landing.css. ✓
- Problem ledger rows / Services bento / hash-chain pipeline / mobile column-flip → Task 3 + Task 4. ✓
- Accountant copy fixes (close not books, templated GAAP, FIFO-roadmap, Walrus optional, period-close tile, maker-checker, governance trust line) → Task 3 sections.tsx, enforced by landingCopy.test. ✓
- aqua-only-on-chain, brass restraint, no second grain, mascot rules → Global Constraints + Task 4 Step 3. ✓
- Success criteria (tsc/build/browser/nav/deep-link/aqua/no-overclaim) → Tasks 1,3,4 + copy test. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `JournalLine`, `totals()`, `sampleEntry` defined Task 2, consumed Task 2/3 identically. `AppRoutes`/`Landing` exports consistent across Tasks 1/3. Section components' props (`CtaSection({onLaunch})`) match the call site in Landing. ✓
