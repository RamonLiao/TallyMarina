# Workspace Shell (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把現有單一線性 5 步 close flow 升級成可在 7 個 workspace 間導覽的 Workspace Shell，close 行為完全不變、其餘 6 個工作面為明確的 "coming soon" 空殼。

**Architecture:** 新增一層 `WorkspaceContext`（state-based，無 react-router）在現有 `EntityContext` 之上；`step`（close 內部 5 步）降級成 `close` workspace 的內部狀態。新增 `SideNav` + `TopBar`（吸收現有 `Header`，含 entity/period/wallet）。內容區依 `activeWorkspace` 切換：`close` 渲現有 `StepRail` + 5 個 step；其餘渲 `EmptyState`。

**Tech Stack:** Vite + React 18 + TypeScript、@tanstack/react-query、@mysten/dapp-kit-react、vitest + @testing-library/react、inline style + CSS custom properties（tokens.css）。

## Global Constraints

- 不引入新 npm 依賴（無 react-router、無 icon library）；導覽用 `WorkspaceContext` useState。
- 沿用既有 design tokens；間距/圓角用 CSS var（`--space-N`/`--s-N` alias、`--radius-*`、`--paper-*`、`--ink*`、`--brass-*`、`--credit`）。**只用 tokens.css 已定義的變數**（lessons 2026-06-22：used var 必須 ⊆ defined tokens）。
- mascot 治理（business-spec §8.4）：mascot 只可出現在 chrome zone（Header/TopBar、EmptyState、StepRail active、CopilotDock）；資料元件（表格/banner/chain）禁出現 mascot。
- 按鈕用既有 `.btn-primary`（999px pill brass）；wallet 包在 `.wallet-slot`（position:relative z-index:100）維持彈窗 stacking context。
- `close` workspace 行為**完全不變**：現有 133 web tests 全綠是硬性收斂條件。
- 主內容區保留 `aria-label="TallyMarina"`（現有 `App.test.tsx` 依賴）。
- 每個前端 task 收尾跑 `npm run build`（含 vite.config tsc），不只 `tsc --noEmit`（lessons 2026-06-22）。
- 顏色不可作為唯一狀態訊號（spec §8.6）：active/soon 除顏色外需有文字或形狀標記。

**與 spec §1.3 的 deviation（Rule 7，已確認）**：`CopilotDock` 吃 `advice/loading/pose` props、綁 ReviewStep 的 copilot query，非常駐元件 → Phase 0 **不**升到殼層，留在 ReviewStep；只升無 props 的 `GuardrailBanner`。CopilotDock 跨 workspace 化留待 A 階段（Exception/Event detail）。

工作目錄：`web/`（指令均假設 `cd web` 或用相對 `web/...` 路徑）。

---

### Task 1: Workspace registry + WorkspaceContext

**Files:**
- Create: `web/src/app/workspaces.ts`
- Create: `web/src/app/WorkspaceContext.tsx`
- Test: `web/src/app/WorkspaceContext.test.tsx`

**Interfaces:**
- Produces:
  - `type WorkspaceId = 'close' | 'exceptions' | 'reconciliation' | 'audit' | 'policy' | 'export' | 'onboarding'`
  - `WORKSPACES: { id: WorkspaceId; label: string; icon: string; status: 'ready' | 'soon' }[]`
  - `WorkspaceProvider({ children }: { children: ReactNode })`
  - `useWorkspace(): { activeWorkspace: WorkspaceId; setWorkspace(id: WorkspaceId): void }`
  - `isWorkspaceId(v: string): v is WorkspaceId`

- [ ] **Step 1: Write the registry (not test-first — pure data)**

`web/src/app/workspaces.ts`:
```ts
export type WorkspaceId =
  | 'close' | 'exceptions' | 'reconciliation'
  | 'audit' | 'policy' | 'export' | 'onboarding';

export const WORKSPACES: {
  id: WorkspaceId; label: string; icon: string; status: 'ready' | 'soon';
}[] = [
  { id: 'close',          label: 'Close',          icon: '⚓', status: 'ready' },
  { id: 'exceptions',     label: 'Exceptions',     icon: '⚠', status: 'soon' },
  { id: 'reconciliation', label: 'Reconciliation', icon: '⚖', status: 'soon' },
  { id: 'audit',          label: 'Audit',          icon: '🔍', status: 'soon' },
  { id: 'policy',         label: 'Policy',         icon: '📐', status: 'soon' },
  { id: 'export',         label: 'Export',         icon: '📤', status: 'soon' },
  { id: 'onboarding',     label: 'Onboarding',     icon: '🚢', status: 'soon' },
];

const IDS = new Set(WORKSPACES.map((w) => w.id));
export function isWorkspaceId(v: string): v is WorkspaceId {
  return IDS.has(v as WorkspaceId);
}
```

- [ ] **Step 2: Write the failing test**

`web/src/app/WorkspaceContext.test.tsx`:
```tsx
import { render, act } from '@testing-library/react';
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext';

function setup() {
  let ctx!: ReturnType<typeof useWorkspace>;
  function Probe() { ctx = useWorkspace(); return null; }
  render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
  return () => ctx;
}

it('defaults to the close workspace', () => {
  expect(setup()().activeWorkspace).toBe('close');
});

it('setWorkspace switches the active workspace', () => {
  const get = setup();
  act(() => { get().setWorkspace('reconciliation'); });
  expect(get().activeWorkspace).toBe('reconciliation');
});

it('ignores an unknown workspace id (stays put, never crashes)', () => {
  const get = setup();
  act(() => { get().setWorkspace('does-not-exist' as never); });
  expect(get().activeWorkspace).toBe('close');
});

it('throws if useWorkspace is used outside the provider', () => {
  function Bare() { useWorkspace(); return null; }
  expect(() => render(<Bare />)).toThrow();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/app/WorkspaceContext.test.tsx`
Expected: FAIL — `Failed to resolve import './WorkspaceContext'`.

- [ ] **Step 4: Write minimal implementation**

`web/src/app/WorkspaceContext.tsx`:
```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { isWorkspaceId, type WorkspaceId } from './workspaces';

interface WorkspaceCtx {
  activeWorkspace: WorkspaceId;
  setWorkspace(id: WorkspaceId): void;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeWorkspace, setActive] = useState<WorkspaceId>('close');
  const value = useMemo<WorkspaceCtx>(() => ({
    activeWorkspace,
    // Guard against unknown ids — fail-closed, never set a non-existent workspace.
    setWorkspace: (id) => { if (isWorkspaceId(id)) setActive(id); },
  }), [activeWorkspace]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return v;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/app/WorkspaceContext.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/app/workspaces.ts web/src/app/WorkspaceContext.tsx web/src/app/WorkspaceContext.test.tsx
git commit -m "feat(web): workspace registry + WorkspaceContext (Phase 0 shell foundation)"
```

---

### Task 2: SideNav component

**Files:**
- Create: `web/src/components/chrome/SideNav.tsx`
- Test: `web/src/components/chrome/SideNav.test.tsx`

**Interfaces:**
- Consumes: `WORKSPACES`, `WorkspaceId` from `app/workspaces`; `useWorkspace` from `app/WorkspaceContext`.
- Produces: `SideNav()` — renders `<nav aria-label="Workspaces">` with one `<button>` per workspace; active button has `aria-current="page"`; `soon` buttons render a "soon" text badge and `data-status="soon"`.

- [ ] **Step 1: Write the failing test**

`web/src/components/chrome/SideNav.test.tsx`:
```tsx
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceProvider, useWorkspace } from '../../app/WorkspaceContext';
import { SideNav } from './SideNav';

function probeWrap(ui: React.ReactNode) {
  let ctx!: ReturnType<typeof useWorkspace>;
  function Probe() { ctx = useWorkspace(); return null; }
  render(<WorkspaceProvider>{ui}<Probe /></WorkspaceProvider>);
  return () => ctx;
}

it('renders one nav item per workspace', () => {
  probeWrap(<SideNav />);
  expect(screen.getByRole('button', { name: /Close/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Reconciliation/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Onboarding/ })).toBeInTheDocument();
});

it('marks the active workspace with aria-current', () => {
  probeWrap(<SideNav />);
  expect(screen.getByRole('button', { name: /Close/ })).toHaveAttribute('aria-current', 'page');
});

it('clicking a soon workspace switches the active workspace', async () => {
  const get = probeWrap(<SideNav />);
  await userEvent.click(screen.getByRole('button', { name: /Reconciliation/ }));
  expect(get().activeWorkspace).toBe('reconciliation');
});

it('soon workspaces carry a non-color status marker (text), not color alone', () => {
  probeWrap(<SideNav />);
  const recon = screen.getByRole('button', { name: /Reconciliation/ });
  expect(recon).toHaveAttribute('data-status', 'soon');
  expect(recon.textContent).toMatch(/soon/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/chrome/SideNav.test.tsx`
Expected: FAIL — cannot resolve `./SideNav`.

- [ ] **Step 3: Write minimal implementation**

`web/src/components/chrome/SideNav.tsx`:
```tsx
import { WORKSPACES } from '../../app/workspaces';
import { useWorkspace } from '../../app/WorkspaceContext';

export function SideNav() {
  const { activeWorkspace, setWorkspace } = useWorkspace();
  return (
    <nav
      aria-label="Workspaces"
      style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
        padding: 'var(--space-3)', minWidth: 200,
      }}
    >
      {WORKSPACES.map((w) => {
        const active = w.id === activeWorkspace;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => setWorkspace(w.id)}
            aria-current={active ? 'page' : undefined}
            data-status={w.status}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid transparent',
              background: active ? 'var(--brass-fill)' : 'transparent',
              color: 'var(--ink)',
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              fontWeight: active ? 600 : 400,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span aria-hidden style={{ fontSize: 16 }}>{w.icon}</span>
            <span style={{ flex: 1 }}>{w.label}</span>
            {w.status === 'soon' && (
              <span
                style={{
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)',
                }}
              >
                soon
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/chrome/SideNav.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify token `--radius-md` exists**

Run: `cd web && grep -n "radius-md\|radius-sm\|radius-lg" src/styles/tokens.css || grep -rn "radius" src/**/*.css`
Expected: confirm `--radius-md` is defined. If it is NOT, replace `var(--radius-md)` in SideNav with the nearest defined radius token (e.g. `var(--radius-sm)`). Do not invent a token.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/chrome/SideNav.tsx web/src/components/chrome/SideNav.test.tsx
git commit -m "feat(web): SideNav workspace navigation (active + soon states)"
```

---

### Task 3: TopBar + EntitySwitcher + PeriodPill (absorb Header)

**Files:**
- Create: `web/src/components/chrome/EntitySwitcher.tsx`
- Create: `web/src/components/chrome/PeriodPill.tsx`
- Create: `web/src/components/chrome/TopBar.tsx`
- Test: `web/src/components/chrome/TopBar.test.tsx`

**Interfaces:**
- Consumes: `useEntities` from `api/hooks`; `useEntityCtx` from `app/EntityContext`; `Mascot` from `./Mascot`; `ConnectButton` from `@mysten/dapp-kit-react/ui`.
- Produces:
  - `EntitySwitcher()` — `<select aria-label="Entity">` of entities; onChange → `setEntity`; shows placeholder option when `entity === null`.
  - `PeriodPill()` — read-only `<span>` showing `periodId`.
  - `TopBar()` — full-bleed navy bar: logo+Mascot left, `EntitySwitcher`+`PeriodPill`+`.wallet-slot`(ConnectButton) right. Inner row centered to 1200.

- [ ] **Step 1: Write the failing test**

`web/src/components/chrome/TopBar.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { EntityProvider } from '../../app/EntityContext';

vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));
vi.mock('../../api/hooks', () => ({
  useEntities: () => ({
    data: [
      { id: 'acme', displayName: 'Acme Pilot', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' },
    ],
    isLoading: false,
  }),
}));

import { TopBar } from './TopBar';

function renderTopBar() {
  return render(<EntityProvider><TopBar /></EntityProvider>);
}

it('renders the brand name and the connect button', () => {
  renderTopBar();
  expect(screen.getByText('TallyMarina')).toBeInTheDocument();
  expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
});

it('renders an entity selector populated from useEntities', () => {
  renderTopBar();
  const select = screen.getByLabelText('Entity') as HTMLSelectElement;
  expect(select).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Acme Pilot' })).toBeInTheDocument();
});

it('shows the read-only period pill', () => {
  renderTopBar();
  expect(screen.getByText('2026-Q2')).toBeInTheDocument();
});

it('keeps the wallet inside a .wallet-slot stacking context', () => {
  const { container } = renderTopBar();
  expect(container.querySelector('.wallet-slot')).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/chrome/TopBar.test.tsx`
Expected: FAIL — cannot resolve `./TopBar`.

- [ ] **Step 3: Write EntitySwitcher**

`web/src/components/chrome/EntitySwitcher.tsx`:
```tsx
import { useEntities } from '../../api/hooks';
import { useEntityCtx } from '../../app/EntityContext';

export function EntitySwitcher() {
  const { data: entities, isLoading } = useEntities();
  const { entity, setEntity } = useEntityCtx();

  if (isLoading) {
    return <span className="font-body" style={{ color: 'var(--paper)', opacity: 0.7 }}>Loading…</span>;
  }
  const list = entities ?? [];
  return (
    <select
      aria-label="Entity"
      value={entity?.id ?? ''}
      onChange={(e) => {
        const next = list.find((x) => x.id === e.target.value) ?? null;
        setEntity(next);
      }}
      style={{
        background: 'rgba(255,255,255,0.08)',
        color: 'var(--paper)',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 'var(--radius-pill)',
        padding: 'var(--space-1) var(--space-3)',
        fontFamily: 'var(--font-display)',
        fontSize: 14,
      }}
    >
      {entity === null && <option value="">Select entity…</option>}
      {list.map((x) => (
        <option key={x.id} value={x.id} style={{ color: 'var(--ink)' }}>{x.displayName}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: Write PeriodPill**

`web/src/components/chrome/PeriodPill.tsx`:
```tsx
import { useEntityCtx } from '../../app/EntityContext';

export function PeriodPill() {
  const { periodId } = useEntityCtx();
  return (
    <span
      aria-label="Accounting period"
      style={{
        background: 'rgba(255,255,255,0.08)',
        color: 'var(--paper)',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 'var(--radius-pill)',
        padding: 'var(--space-1) var(--space-3)',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
      }}
    >
      {periodId}
    </span>
  );
}
```

- [ ] **Step 5: Write TopBar (port from Header.tsx)**

`web/src/components/chrome/TopBar.tsx`:
```tsx
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Mascot } from './Mascot';
import { EntitySwitcher } from './EntitySwitcher';
import { PeriodPill } from './PeriodPill';

export function TopBar() {
  return (
    <header
      style={{
        background: 'var(--ink)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: 'var(--space-3) clamp(16px, 4vw, 48px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Mascot pose="sailing" size={32} />
          <span
            style={{
              fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--paper)',
              fontWeight: 560, letterSpacing: '-0.02em',
            }}
          >
            TallyMarina
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <EntitySwitcher />
          <PeriodPill />
          <div className="wallet-slot">
            <ConnectButton />
          </div>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/chrome/TopBar.test.tsx`
Expected: PASS (4 tests). If `--radius-pill` is unexpectedly undefined, confirm via `grep -n "radius-pill" src/styles/tokens.css` (it was added in commit 6950ec7); only then fall back to a defined radius.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/chrome/EntitySwitcher.tsx web/src/components/chrome/PeriodPill.tsx web/src/components/chrome/TopBar.tsx web/src/components/chrome/TopBar.test.tsx
git commit -m "feat(web): TopBar with entity switcher + period pill + wallet slot"
```

---

### Task 4: App shell wiring + lift GuardrailBanner + regression/monkey

**Files:**
- Modify: `web/src/App.tsx` (whole `Shell`/`App` rewrite — current full file in Global Constraints context)
- Delete: `web/src/components/chrome/Header.tsx` (after confirming only App referenced it)
- Test: `web/src/App.test.tsx` (already exists — must stay green)
- Test: `web/src/test/monkey.shell.test.tsx` (new)

**Interfaces:**
- Consumes: `WorkspaceProvider`, `useWorkspace`; `WORKSPACES`; `EntityProvider`, `useEntityCtx`; `TopBar`, `SideNav`, `StepRail`, `EmptyState`, `AppBackground`; `GuardrailBanner`; the 5 step components.
- Produces: shell layout — `close` renders `StepRail` + step section; any `soon` workspace renders `EmptyState`; `GuardrailBanner` persists across workspaces.

- [ ] **Step 1: Confirm Header has no other consumers**

Run: `cd web && grep -rn "chrome/Header'" src | grep -v Header.test`
Expected: only `src/App.tsx`. (If anything else imports it, keep `Header.tsx` and skip its deletion.)

- [ ] **Step 2: Write the new App.tsx**

`web/src/App.tsx`:
```tsx
import { EntityProvider, useEntityCtx } from './app/EntityContext';
import { WorkspaceProvider, useWorkspace } from './app/WorkspaceContext';
import { WORKSPACES } from './app/workspaces';
import { AppBackground } from './components/chrome/AppBackground';
import { TopBar } from './components/chrome/TopBar';
import { SideNav } from './components/chrome/SideNav';
import { StepRail } from './components/chrome/StepRail';
import { EmptyState } from './components/chrome/EmptyState';
import { GuardrailBanner } from './components/data/GuardrailBanner';
import { IngestStep } from './steps/IngestStep';
import { ClassifyStep } from './steps/ClassifyStep';
import { ReviewStep } from './steps/ReviewStep';
import { JournalStep } from './steps/JournalStep';
import { AnchorStep } from './steps/AnchorStep';

function CloseWorkspace() {
  const { step } = useEntityCtx();
  return (
    <>
      <StepRail current={step} />
      <section style={{ marginTop: 'var(--space-6)' }} data-step={step}>
        {step === 'ingest' && <IngestStep />}
        {step === 'classify' && <ClassifyStep />}
        {step === 'review' && <ReviewStep />}
        {step === 'journal' && <JournalStep />}
        {step === 'anchor' && <AnchorStep />}
      </section>
    </>
  );
}

function WorkspaceContent() {
  const { activeWorkspace } = useWorkspace();
  if (activeWorkspace === 'close') return <CloseWorkspace />;
  const meta = WORKSPACES.find((w) => w.id === activeWorkspace);
  return (
    <EmptyState
      title={`${meta?.label ?? 'Workspace'} — coming soon`}
      body="此工作面尚未啟用。目前 demo 的可操作流程在 Close workspace。"
    />
  );
}

function Shell() {
  return (
    <>
      <TopBar />
      <div style={{ display: 'flex', maxWidth: 1200, margin: '0 auto', alignItems: 'flex-start' }}>
        <aside style={{ position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
          <SideNav />
        </aside>
        <main
          aria-label="TallyMarina"
          style={{ flex: 1, minWidth: 0, padding: '0 clamp(16px, 4vw, 48px) var(--space-10)' }}
        >
          <GuardrailBanner />
          <div style={{ marginTop: 'var(--space-4)' }}>
            <WorkspaceContent />
          </div>
        </main>
      </div>
    </>
  );
}

export default function App() {
  return (
    <EntityProvider>
      <WorkspaceProvider>
        <AppBackground />
        <Shell />
      </WorkspaceProvider>
    </EntityProvider>
  );
}
```

- [ ] **Step 3: Delete Header.tsx (only if Step 1 confirmed sole consumer)**

```bash
cd web && git rm src/components/chrome/Header.tsx
```
(If a `Header.test.tsx` exists, `git rm` it too.)

- [ ] **Step 4: Run the existing App test (regression)**

Run: `cd web && npx vitest run src/App.test.tsx`
Expected: PASS — `getByLabelText('TallyMarina')` still resolves (now the `<main>`).

- [ ] **Step 5: Write the shell monkey/integration test**

`web/src/test/monkey.shell.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppProviders } from '../providers/AppProviders';
import App from '../App';

vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));

function renderApp() {
  return render(<AppProviders><App /></AppProviders>);
}

it('starts in the Close workspace showing the step rail', () => {
  renderApp();
  expect(screen.getByLabelText('Close-the-period progress')).toBeInTheDocument();
});

it('switching to a soon workspace shows EmptyState and HIDES the close step rail', async () => {
  renderApp();
  await userEvent.click(screen.getByRole('button', { name: /Reconciliation/ }));
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  // Why this matters: an empty workspace must not leak the previous workspace's content.
  expect(screen.queryByLabelText('Close-the-period progress')).not.toBeInTheDocument();
});

it('switching back to Close restores the step rail', async () => {
  renderApp();
  await userEvent.click(screen.getByRole('button', { name: /Audit/ }));
  await userEvent.click(screen.getByRole('button', { name: /Close/ }));
  expect(screen.getByLabelText('Close-the-period progress')).toBeInTheDocument();
});

it('GuardrailBanner persists across workspaces (AI-no-posting governance always visible)', async () => {
  renderApp();
  await userEvent.click(screen.getByRole('button', { name: /Policy/ }));
  // GuardrailBanner declares AI-suggestions-only; assert its hallmark copy is present.
  expect(screen.getByText(/AI/i)).toBeInTheDocument();
});

it('rapid workspace switching leaves no stale content', async () => {
  renderApp();
  for (const name of [/Exceptions/, /Export/, /Onboarding/, /Close/]) {
    await userEvent.click(screen.getByRole('button', { name }));
  }
  expect(screen.getByLabelText('Close-the-period progress')).toBeInTheDocument();
});
```

- [ ] **Step 6: Run the monkey/integration test**

Run: `cd web && npx vitest run src/test/monkey.shell.test.tsx`
Expected: PASS (5 tests). If the GuardrailBanner copy assertion fails, open `src/components/data/GuardrailBanner.tsx`, read its actual text, and adjust the matcher to the real hallmark phrase (do not change the banner).

- [ ] **Step 7: Full suite + build (regression gate)**

Run: `cd web && npx vitest run && npm run build`
Expected: all tests green (≥ 133 prior + new), build exit 0. Fix any close-flow regression before continuing.

- [ ] **Step 8: Commit**

```bash
git add web/src/App.tsx web/src/test/monkey.shell.test.tsx
git add -u web/src/components/chrome/
git commit -m "feat(web): wire Workspace Shell into App; lift GuardrailBanner; retire Header"
```

---

### Task 5: RWD + visual/geometry verification + review-gate handoff

**Files:**
- Modify: `web/src/components/chrome/SideNav.tsx` (responsive collapse)
- Modify: `web/src/App.tsx` (responsive flex direction)
- Test: manual geometry assertions via Playwright MCP `browser_evaluate` (no new test file)

**Interfaces:** none new — refines layout of Task 2/4 output.

- [ ] **Step 1: Add a responsive flag (CSS, no JS resize listener)**

Append to the project stylesheet that already holds layout rules (find it: `cd web && grep -rln "wallet-slot" src | grep css`). Add:
```css
/* Workspace shell: stack sidenav above content on narrow viewports */
@media (max-width: 768px) {
  .shell-body { flex-direction: column; }
  .shell-sidenav { position: static !important; width: 100%; }
  .shell-sidenav nav { flex-direction: row; flex-wrap: wrap; min-width: 0; }
}
```

- [ ] **Step 2: Add the className hooks in App.tsx**

In `web/src/App.tsx` `Shell()`, add `className="shell-body"` to the flex `<div>` and `className="shell-sidenav"` to the `<aside>`:
```tsx
      <div className="shell-body" style={{ display: 'flex', maxWidth: 1200, margin: '0 auto', alignItems: 'flex-start' }}>
        <aside className="shell-sidenav" style={{ position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
          <SideNav />
        </aside>
```

- [ ] **Step 3: Run full suite + build again**

Run: `cd web && npx vitest run && npm run build`
Expected: green + exit 0 (CSS/className additions must not break jsdom tests).

- [ ] **Step 4: Geometry verification in a real browser**

Start dev server (`cd web && npm run dev`), then via Playwright MCP `browser_navigate` to the local URL and `browser_evaluate` the following at viewport 1280px wide:
```js
() => {
  const topbar = document.querySelector('header');
  const side = document.querySelector('.shell-sidenav');
  const main = document.querySelector('main[aria-label="TallyMarina"]');
  return {
    topbarFullBleed: Math.abs(topbar.getBoundingClientRect().width - window.innerWidth) < 2,
    sidenavWidth: side.getBoundingClientRect().width,
    mainLeftAfterSidenav: main.getBoundingClientRect().left >= side.getBoundingClientRect().right - 2,
  };
}
```
Expected: `topbarFullBleed === true`; `sidenavWidth > 0`; `mainLeftAfterSidenav === true` (content sits right of the sidebar, no overlap). Lessons 2026-06-23: assert element-rect-vs-viewport, not just computed style.

- [ ] **Step 5: Resize to 375px and re-evaluate stacking**

Via `browser_resize` to 375×800, then `browser_evaluate`:
```js
() => {
  const side = document.querySelector('.shell-sidenav');
  const main = document.querySelector('main[aria-label="TallyMarina"]');
  return { stacked: side.getBoundingClientRect().bottom <= main.getBoundingClientRect().top + 2 };
}
```
Expected: `stacked === true` (sidenav above content, not side-by-side). Take a `browser_take_screenshot` at both widths and eyeball: no overlap, navy TopBar spans full width, wallet popover not clipped.

- [ ] **Step 6: Commit**

```bash
git add -u web/src
git commit -m "feat(web): responsive Workspace Shell (sidenav collapses < 768px) + geometry-verified"
```

- [ ] **Step 7: Review-gate handoff (spec §3.1 — MANDATORY, not optional)**

Phase 0 code-complete. Per spec §3.1, before declaring Phase 0 done, run BOTH UI reviews and integrate findings:
1. **`sui-frontend` skill review** — shell structure, dapp-kit ConnectButton/wallet-slot behavior in the new TopBar, SUI frontend best practice.
2. **`frontend-design` skill review** — 美感/排版: visual hierarchy, spacing rhythm, sidenav↔TopBar↔content proportions, navy-brass-cream consistency, mascot governance (§8.4), RWD breakpoint feel; avoid generic AI aesthetics.

Integrate findings → fix → re-verify (geometry + screenshot). Only then mark Phase 0 complete and update `tasks/progress.md`.

---

## Self-Review

**Spec coverage (against `2026-06-23-workspace-shell-design.md` §1–5):**
- §1.2 WorkspaceContext + workspaces.ts → Task 1 ✅
- §1.3 layout (TopBar/SideNav/content switch, GuardrailBanner lifted) → Task 3 (TopBar), Task 2 (SideNav), Task 4 (wiring + banner) ✅
- §1.3 CopilotDock — explicitly NOT lifted (Rule 7 deviation documented in Global Constraints) ✅
- §1.4 EntitySwitcher (real GET /entities) + read-only PeriodPill → Task 3 ✅
- §1.5 state-based nav, no router → Task 1 ✅
- §1.6 backend boundary (only GET /entities) → Task 3 (no other endpoints touched) ✅
- §1.7 RWD ≤768px collapse → Task 5 ✅
- §2 component manifest → Tasks 1–4 cover every listed file ✅
- §3 tests (context/render/switcher/monkey/regression) → Tasks 1,2,3,4 ✅
- §3.1 review gate (sui-frontend + frontend-design) → Task 5 Step 7 ✅
- §4 success criteria (133 green, tsc, build, geometry) → Task 4 Step 7 + Task 5 Steps 4–5 ✅
- §5 YAGNI (no router/multi-period/RBAC) → honored; none added ✅

**Placeholder scan:** No TBD/TODO; every code step has full code. Token-existence steps (Task 2 Step 5, Task 3 Step 6) are guards, not placeholders. Stylesheet target in Task 5 Step 1 is discovered via grep, not assumed.

**Type consistency:** `WorkspaceId`/`WORKSPACES`/`isWorkspaceId` (Task 1) used verbatim in Tasks 2,4. `useWorkspace().{activeWorkspace,setWorkspace}` consistent across Tasks 2,4. `EntityDTO` fields (`id`,`displayName`) match `api/types.ts`. `useEntities()` shape `{data,isLoading}` matches `api/hooks.ts`. `EmptyState({title,body,cta})` matches existing signature. `StepRail current={step}` prop matches existing.
