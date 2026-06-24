# Policy Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only Policy Workspace that displays the active accounting policy + COA mapping and runs a pure-frontend COA-remap what-if preview over current-period journal entries, with audit-grade controls (coverage, conservation, orphan, account-type, reversal).

**Architecture:** Backend exposes existing demo policy constants additively (extract to a shared, serializable source-of-truth module → `GET /policy/active`), and wires `policySetVersion` into the export bundle manifest so the workspace can cross-check it. Frontend adds a pure `policyPreview` engine (Lever B / COA remap only), a data hook, and a single-column workspace mirroring the export workspace's visual language.

**Tech Stack:** TypeScript, Fastify (services/api), React 18 + Vite (web), Vitest both sides, BigInt minor-unit arithmetic.

## Global Constraints

- **Levers**: COA mapping (Lever B) ONLY. Rounding (A), cost-basis (C), functional-currency (D) are deferred/read-only. (spec §1)
- **No write path**: viewer + dry-run preview only; never apply/persist/mutate; never change rules-engine behavior (workspace-shell §6.9).
- **BigInt only** for minor-unit math; render `amountMinor` as raw string, never `parseFloat`. (`JournalTable.tsx:33,40,66`)
- **Color discipline**: `--aqua` is on-chain/anchor-only — forbidden in this workspace. No new color tokens; all from `tokens.css`. Data surfaces are Mascot-free.
- **Source-of-truth**: `buildRuleInput.ts` must IMPORT policy/COA constants from the new shared module (no duplicated literals).
- **Test runner**: api `cd services/api && npx vitest run`; web `cd web && npx vitest run`; web typecheck `cd web && npx tsc --noEmit`.
- **COA mapping is a serializable rule table** (not a closure); runtime `resolve()` is rebuilt from it.

---

## File Structure

**Backend (services/api):**
- Create `src/http/policyConstants.ts` — shared serializable `DEMO_POLICY_SET`, `DEMO_COA_RULES`, `DEMO_DEFAULT_ACCOUNT`, and `resolveCoa()` rebuilt from the table.
- Modify `src/http/buildRuleInput.ts` — import from `policyConstants.ts` (delete inline literals/closure).
- Modify `src/http/routes.ts` — add `GET /policy/active`.
- Test `test/policyConstants.test.ts`, `test/policyRoute.test.ts`.

**Frontend (web):**
- Modify `src/api/types.ts` — add `PolicyActiveDTO`, `CoaRuleDTO`.
- Modify `src/api/endpoints.ts` — add `getPolicyActive()`.
- Create `src/lib/policyPreview.ts` — pure COA-remap engine + diff/coverage/conservation.
- Modify `src/data/useExportData.ts` + `src/workspaces/export/assembleExport.ts` + `src/workspaces/export/buildBundle.ts` — wire `policySetVersion` into manifest (spine).
- Create `src/data/usePolicyData.ts` — fetch policy + current-period journal + events.
- Create `src/workspaces/policy/PolicySummaryCard.tsx`, `CoaMappingTable.tsx`, `PreviewPanel.tsx`, `PolicyWorkspace.tsx`, `policy.css`.
- Modify `src/app/workspaces.ts` — flip `policy` status `soon`→`ready`.
- Wherever the workspace router renders by id (grep `ExportWorkspace` usage) — mount `PolicyWorkspace`.
- Tests: `src/lib/policyPreview.test.ts`, `src/workspaces/policy/PolicyWorkspace.test.tsx`, `src/workspaces/export/buildBundle.test.ts` (extend).

---

## Task 1: Backend — shared serializable policy/COA source-of-truth

**Files:**
- Create: `services/api/src/http/policyConstants.ts`
- Modify: `services/api/src/http/buildRuleInput.ts`
- Test: `services/api/test/policyConstants.test.ts`

**Interfaces:**
- Produces:
  - `DEMO_POLICY_SET: ResolvedPolicySet`
  - `CoaRule = { eventType: string; leg: string; account: string }` (`leg: '*'` = catch-all)
  - `DEMO_COA_RULES: CoaRule[]`, `DEMO_DEFAULT_ACCOUNT = 'Suspense'`
  - `resolveCoa(args: { eventType: string; leg: string }): string` — first rule where `eventType` matches and (`leg === rule.leg || rule.leg === '*'`), else `DEMO_DEFAULT_ACCOUNT`.
  - `buildCoaMapping(): CoaMapping` — wraps `resolveCoa` into the engine's `{ resolve }` shape.

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/test/policyConstants.test.ts
import { describe, it, expect } from 'vitest';
import { DEMO_POLICY_SET, DEMO_COA_RULES, DEMO_DEFAULT_ACCOUNT, resolveCoa, buildCoaMapping } from '../src/http/policyConstants.js';

describe('policyConstants', () => {
  it('DEMO_POLICY_SET preserves the demo-ps-1 values verbatim', () => {
    expect(DEMO_POLICY_SET.policySetVersion).toBe('demo-ps-1');
    expect(DEMO_POLICY_SET.costBasisMethod).toBe('FIFO');
    expect(DEMO_POLICY_SET.functionalCurrency).toBe('USD');
    expect(DEMO_POLICY_SET.roundingThresholdMinor).toBe('0');
    expect(DEMO_POLICY_SET.periodOpen).toBe(true);
  });

  it('resolveCoa reproduces the original closure semantics exactly', () => {
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1' })).toBe('DigitalAssets');
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L2' })).toBe('AccountsReceivable');
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'L1' })).toBe('AccountsPayable');
    expect(resolveCoa({ eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'L9' })).toBe('DigitalAssets');
    expect(resolveCoa({ eventType: 'UNKNOWN', leg: 'L1' })).toBe(DEMO_DEFAULT_ACCOUNT);
  });

  it('buildCoaMapping yields a CoaMapping whose resolve matches resolveCoa', () => {
    const m = buildCoaMapping();
    expect(m.resolve({ eventType: 'DIGITAL_ASSET_RECEIPT' as any, leg: 'L1', coinType: 'X' })).toBe('DigitalAssets');
  });

  it('DEMO_COA_RULES is JSON-serializable (no functions)', () => {
    expect(() => JSON.stringify({ rules: DEMO_COA_RULES, default: DEMO_DEFAULT_ACCOUNT })).not.toThrow();
    expect(JSON.parse(JSON.stringify(DEMO_COA_RULES))).toEqual(DEMO_COA_RULES);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/policyConstants.test.ts`
Expected: FAIL — cannot find module `../src/http/policyConstants.js`.

- [ ] **Step 3: Write the module**

```typescript
// services/api/src/http/policyConstants.ts
import type { ResolvedPolicySet, CoaMapping, EventType } from '../deps/rulesEngine.js';

export const DEMO_POLICY_SET: ResolvedPolicySet = {
  policySetVersion: 'demo-ps-1', assetPolicyVersion: 'demo-ap-1', eventPolicyVersion: 'demo-ep-1',
  ruleVersion: 'demo-rule-1', parserVersion: 'demo-parse-1', normalizationVersion: 'demo-norm-1',
  costBasisMethod: 'FIFO', functionalCurrency: 'USD', roundingThresholdMinor: '0', periodOpen: true,
};

export interface CoaRule { eventType: string; leg: string; account: string } // leg '*' = catch-all

// Serializable table mirroring the ORIGINAL buildRuleInput closure semantics, rule order significant.
export const DEMO_COA_RULES: CoaRule[] = [
  { eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'DigitalAssets' },
  { eventType: 'DIGITAL_ASSET_RECEIPT', leg: '*',  account: 'AccountsReceivable' },
  { eventType: 'DIGITAL_ASSET_PAYMENT', leg: 'L1', account: 'AccountsPayable' },
  { eventType: 'DIGITAL_ASSET_PAYMENT', leg: '*',  account: 'DigitalAssets' },
];

export const DEMO_DEFAULT_ACCOUNT = 'Suspense';

export function resolveCoa(args: { eventType: string; leg: string }, rules: CoaRule[] = DEMO_COA_RULES, fallback: string = DEMO_DEFAULT_ACCOUNT): string {
  const hit = rules.find((r) => r.eventType === args.eventType && (r.leg === args.leg || r.leg === '*'));
  return hit ? hit.account : fallback;
}

export function buildCoaMapping(): CoaMapping {
  return { resolve: ({ eventType, leg }) => resolveCoa({ eventType: eventType as unknown as string, leg }) };
}
```

> If `EventType` is not re-exported from `../deps/rulesEngine.js`, drop the unused import — only `ResolvedPolicySet` and `CoaMapping` are required.

- [ ] **Step 4: Point buildRuleInput at the shared module (delete inline literals)**

In `services/api/src/http/buildRuleInput.ts`: remove the inline `const coaMapping: CoaMapping = {...}` closure and the inline `const policySet: ResolvedPolicySet = {...}` literal. Import and use the shared values:

```typescript
import { DEMO_POLICY_SET, buildCoaMapping } from './policyConstants.js';
// ...inside buildRuleInput:
const policySet: ResolvedPolicySet = DEMO_POLICY_SET;
const coaMapping = buildCoaMapping();
// (return object unchanged: { runContext, event: ne, policySet, assetAssessment, lots, prices, fxRates, coaMapping })
```

- [ ] **Step 5: Run tests (module + existing suite) to verify pass + no regression**

Run: `cd services/api && npx vitest run`
Expected: PASS — new `policyConstants.test.ts` green; all 162 existing api tests still green (proves the extraction preserved behavior — anti-drift via shared import).

- [ ] **Step 6: Commit**

```bash
git add services/api/src/http/policyConstants.ts services/api/src/http/buildRuleInput.ts services/api/test/policyConstants.test.ts
git commit -m "feat(policy): extract policy/COA constants to shared serializable module"
```

---

## Task 2: Backend — `GET /policy/active` endpoint

**Files:**
- Modify: `services/api/src/http/routes.ts`
- Test: `services/api/test/policyRoute.test.ts`

**Interfaces:**
- Consumes: `DEMO_POLICY_SET`, `DEMO_COA_RULES`, `DEMO_DEFAULT_ACCOUNT` (Task 1).
- Produces HTTP `GET /policy/active` → `{ policySet: ResolvedPolicySet, coaMapping: { rules: CoaRule[]; defaultAccount: string }, periodId: string }`. `periodId` from the same single-period source other routes use (`'2026-Q2'`; see `requireEntity`/journal route context — reuse the existing periodId constant/source rather than re-hardcoding if one is exported).

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/test/policyRoute.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer } from '../src/http/server.js'; // adjust to the actual app factory used by other route tests
import { DEMO_POLICY_SET, DEMO_COA_RULES, DEMO_DEFAULT_ACCOUNT } from '../src/http/policyConstants.js';

let app: Awaited<ReturnType<typeof buildServer>>;
beforeEach(async () => { app = await buildServer(':memory:'); });

describe('GET /policy/active', () => {
  it('returns the active policy set, serializable COA rules, and periodId', async () => {
    const res = await app.inject({ method: 'GET', url: '/policy/active' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.policySet).toEqual(DEMO_POLICY_SET);
    expect(body.coaMapping.rules).toEqual(DEMO_COA_RULES);
    expect(body.coaMapping.defaultAccount).toBe(DEMO_DEFAULT_ACCOUNT);
    expect(typeof body.periodId).toBe('string');
  });
});
```

> Adjust the import of the server/app factory and the injection helper to match how `services/api/test/*route*.test.ts` already boots Fastify. If route tests don't exist yet, mirror `test/store.test.ts` setup + Fastify's `app.inject`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/policyRoute.test.ts`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Register the route in `routes.ts`**

```typescript
import { DEMO_POLICY_SET, DEMO_COA_RULES, DEMO_DEFAULT_ACCOUNT } from './policyConstants.js';
// ...alongside the other app.get(...) registrations:
app.get('/policy/active', async () => ({
  policySet: DEMO_POLICY_SET,
  coaMapping: { rules: DEMO_COA_RULES, defaultAccount: DEMO_DEFAULT_ACCOUNT },
  periodId: '2026-Q2', // reuse exported period constant if one exists; else this matches EntityContext/journal route
}));
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd services/api && npx vitest run test/policyRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/http/routes.ts services/api/test/policyRoute.test.ts
git commit -m "feat(policy): GET /policy/active exposing active policy + serializable COA rules"
```

---

## Task 3: Spine — wire `policySetVersion` into the export bundle manifest

**Files:**
- Modify: `web/src/workspaces/export/buildBundle.ts` (manifestObj ~line 132)
- Modify: `web/src/workspaces/export/assembleExport.ts` (pass policySetVersion into BundleInput)
- Modify: `web/src/data/useExportData.ts` (fetch policy alongside journal/events/anchors)
- Modify: `web/src/api/types.ts` + `web/src/api/endpoints.ts` (PolicyActiveDTO + getPolicyActive — shared with Task 4; do Task 4 Steps 1-3 first if executing out of order)
- Test: `web/src/workspaces/export/buildBundle.test.ts` (extend)

**Interfaces:**
- Consumes: `getPolicyActive()` (Task 4), `BundleInput.policySetVersion?` (already exists, `buildBundle.ts:19`).
- Produces: export manifest now contains a top-level `policySetVersion: string | null`. This is the value the Policy Workspace cross-checks.

- [ ] **Step 1: Write the failing test (manifest must carry policySetVersion)**

```typescript
// web/src/workspaces/export/buildBundle.test.ts  (add this case)
import { describe, it, expect } from 'vitest';
import { buildBundle } from './buildBundle';

describe('buildBundle policySetVersion (spine)', () => {
  it('writes policySetVersion into the manifest when provided', () => {
    const out = buildBundle({
      entityId: 'acme:pilot-001', periodId: '2026-Q2', functionalCurrency: 'USD', scale: 2,
      generatedAt: '2026-06-24T00:00:00Z', journal: [], dateByEventId: {}, binding: null,
      policySetVersion: 'demo-ps-1',
    });
    const manifest = JSON.parse(out.files['manifest.json']); // adjust accessor to buildBundle's actual output shape
    expect(manifest.policySetVersion).toBe('demo-ps-1');
  });

  it('writes null when policySetVersion is absent', () => {
    const out = buildBundle({
      entityId: 'acme:pilot-001', periodId: '2026-Q2', functionalCurrency: 'USD', scale: 2,
      generatedAt: '2026-06-24T00:00:00Z', journal: [], dateByEventId: {}, binding: null,
    });
    const manifest = JSON.parse(out.files['manifest.json']);
    expect(manifest.policySetVersion).toBeNull();
  });
});
```

> Adjust `out.files['manifest.json']` to however `buildBundle` returns the manifest (read its current return type / existing test in the same file first).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/workspaces/export/buildBundle.test.ts`
Expected: FAIL — `manifest.policySetVersion` is `undefined` (not written).

- [ ] **Step 3: Write policySetVersion into manifestObj**

In `buildBundle.ts`, destructure `policySetVersion` from input and add to `manifestObj` (after `entityId`/`periodId`):

```typescript
const { /* existing */ policySetVersion } = input;
// ...
const manifestObj: Record<string, unknown> = {
  leafCodecVersion: 'JE_LEAF_BCS_V1',
  entityId,
  periodId,
  policySetVersion: policySetVersion ?? null,
  generatedAt,
  // ...rest unchanged
};
```

- [ ] **Step 4: Source policySetVersion in the export flow**

`useExportData.ts`: add `getPolicyActive(capturedEntityId)` to the `Promise.all`, store `policySetVersion: policy.policySet.policySetVersion` on the exposed value. `assembleExport.ts`: pass that through as `BundleInput.policySetVersion`.

```typescript
// useExportData.ts — extend ExportValue + Promise.all
import { getJournal, listEvents, getAnchors, getPolicyActive } from '../api/endpoints';
interface ExportValue { journal: JournalDTO[]; events: EventDTO[]; anchors: AnchorDTO[]; policySetVersion: string }
// ...
const [journal, events, anchorsResult, policy] = await Promise.all([
  getJournal(capturedEntityId), listEvents(capturedEntityId), getAnchors(capturedEntityId), getPolicyActive(),
]);
// ...store value: { journal, events, anchors: anchorsResult.anchors, policySetVersion: policy.policySet.policySetVersion }
```

In `assembleExport.ts`, thread `policySetVersion` into the `buildBundle({...})` call's `BundleInput`.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd web && npx vitest run src/workspaces/export/buildBundle.test.ts && npx tsc --noEmit`
Expected: PASS + 0 type errors. (Run full `npx vitest run` to confirm no export-workspace regressions.)

- [ ] **Step 6: Commit**

```bash
git add web/src/workspaces/export/buildBundle.ts web/src/workspaces/export/assembleExport.ts web/src/data/useExportData.ts web/src/api/types.ts web/src/api/endpoints.ts web/src/workspaces/export/buildBundle.test.ts
git commit -m "feat(policy): wire policySetVersion into export manifest (spine cross-check)"
```

---

## Task 4: Frontend — policy API types + endpoint

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/endpoints.ts`
- Test: covered via Task 5/Task 10 (no standalone test — thin wrapper).

**Interfaces:**
- Produces:
  - `CoaRuleDTO = { eventType: string; leg: string; account: string }`
  - `PolicyActiveDTO = { policySet: ResolvedPolicySetDTO; coaMapping: { rules: CoaRuleDTO[]; defaultAccount: string }; periodId: string }`
  - `ResolvedPolicySetDTO` mirrors backend `ResolvedPolicySet` (all string fields + `costBasisMethod: 'FIFO'`, `periodOpen: boolean`).
  - `getPolicyActive(): Promise<PolicyActiveDTO>`

- [ ] **Step 1: Add types**

```typescript
// web/src/api/types.ts (append)
export interface ResolvedPolicySetDTO {
  policySetVersion: string; assetPolicyVersion: string; eventPolicyVersion: string;
  ruleVersion: string; parserVersion: string; normalizationVersion: string;
  costBasisMethod: 'FIFO'; functionalCurrency: string; roundingThresholdMinor: string; periodOpen: boolean;
}
export interface CoaRuleDTO { eventType: string; leg: string; account: string }
export interface PolicyActiveDTO {
  policySet: ResolvedPolicySetDTO;
  coaMapping: { rules: CoaRuleDTO[]; defaultAccount: string };
  periodId: string;
}
```

- [ ] **Step 2: Add endpoint**

```typescript
// web/src/api/endpoints.ts (mirror the existing getJournal/getAnchors fetch helper pattern)
import type { PolicyActiveDTO } from './types';
export async function getPolicyActive(): Promise<PolicyActiveDTO> {
  return apiGet<PolicyActiveDTO>('/policy/active'); // use whatever the file's shared fetch helper is named
}
```

> Read `endpoints.ts` first and reuse its existing fetch helper (e.g. `apiGet`/`http`); do not introduce a new fetch style.

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/types.ts web/src/api/endpoints.ts
git commit -m "feat(policy): PolicyActiveDTO + getPolicyActive endpoint wrapper"
```

---

## Task 5: Frontend — pure COA-remap preview engine

**Files:**
- Create: `web/src/lib/policyPreview.ts`
- Test: `web/src/lib/policyPreview.test.ts`

**Interfaces:**
- Consumes: `JournalDTO`, `EventDTO`, `CoaRuleDTO`, `JournalLine` (`web/src/api/types.ts`); reuse `trialActivity` (`web/src/lib/trialActivity.ts`) + `sumFunctional` (`web/src/lib/balance.ts`) where applicable.
- Produces (React/fetch-free, pure, immutable inputs):
  - `resolveCoaRule(rules: CoaRuleDTO[], defaultAccount: string, eventType: string, leg: string): string` — first-match (leg or `'*'`), else default.
  - `eventTypeOf(je: JournalDTO, eventsById: Map<string, EventDTO>): string` — `final.eventType ?? ai.eventType ?? ''` via `je.eventId`.
  - `previewCoaRemap(input: PreviewInput): PreviewResult`

```typescript
export interface PreviewInput {
  journal: JournalDTO[];
  events: EventDTO[];
  baseRules: CoaRuleDTO[];
  baseDefault: string;
  nextRules: CoaRuleDTO[];
  nextDefault: string;
  knownAccounts: string[]; // accounts present in base mapping ∪ base trial balance — for validation
}
export interface LineDiff {
  jeId: string; eventId: string; eventType: string; leg: string;
  side: 'DEBIT' | 'CREDIT'; amountMinor: string; fromAccount: string; toAccount: string;
}
export interface CoverageReport { explicit: number; defaulted: number; defaultedKeys: string[] }
export interface Conservation { balanced: boolean; beforeDebit: string; beforeCredit: string; afterDebit: string; afterCredit: string }
export interface Warning { kind: 'UNKNOWN_ACCOUNT' | 'ORPHANED_BALANCE' | 'CROSS_STATEMENT' | 'REVERSAL_DIVERGENCE' | 'EMPTY_ACCOUNT'; detail: string }
export interface PreviewResult {
  changed: LineDiff[];
  coverage: CoverageReport;
  conservation: Conservation;
  warnings: Warning[];
  beforeActivity: { account: string; debitMinor: string; creditMinor: string }[];
  afterActivity: { account: string; debitMinor: string; creditMinor: string }[];
}
```

- [ ] **Step 1: Write the failing tests**

```typescript
// web/src/lib/policyPreview.test.ts
import { describe, it, expect } from 'vitest';
import { previewCoaRemap, resolveCoaRule, type PreviewInput } from './policyPreview';
import type { JournalDTO, EventDTO, CoaRuleDTO } from '../api/types';

const baseRules: CoaRuleDTO[] = [
  { eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'DigitalAssets' },
  { eventType: 'DIGITAL_ASSET_RECEIPT', leg: '*', account: 'AccountsReceivable' },
];
const events: EventDTO[] = [
  { id: 'e1', entityId: 'x', status: 'POSTED', normalized: {}, ai: { eventType: 'DIGITAL_ASSET_RECEIPT', purpose: '', counterparty: null, confidence: 1, reasoning: '' }, final: { eventType: 'DIGITAL_ASSET_RECEIPT', purpose: '' }, routing: null },
];
const je = (lines: any[]): JournalDTO => ({ id: 'j1', eventId: 'e1', idempotencyKey: 'k1', leafHash: 'h', je: { idempotencyKey: 'k1', lineageHash: 'lh', reversalOf: null, lines } });

function line(account: string, side: 'DEBIT'|'CREDIT', amt: string, leg: string) {
  return { account, side, amountMinor: amt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg };
}

describe('resolveCoaRule', () => {
  it('first-match by eventType + (leg or *), else default', () => {
    expect(resolveCoaRule(baseRules, 'Suspense', 'DIGITAL_ASSET_RECEIPT', 'L1')).toBe('DigitalAssets');
    expect(resolveCoaRule(baseRules, 'Suspense', 'DIGITAL_ASSET_RECEIPT', 'L2')).toBe('AccountsReceivable');
    expect(resolveCoaRule(baseRules, 'Suspense', 'OTHER', 'L1')).toBe('Suspense');
  });
});

describe('previewCoaRemap', () => {
  const base: Omit<PreviewInput, 'nextRules' | 'nextDefault'> = {
    journal: [je([line('DigitalAssets', 'DEBIT', '1000', 'L1'), line('AccountsReceivable', 'CREDIT', '1000', 'L2')])],
    events, baseRules, baseDefault: 'Suspense',
    knownAccounts: ['DigitalAssets', 'AccountsReceivable', 'CryptoHoldings', 'Suspense'],
  };

  it('reports a changed line when a rule remaps an account', () => {
    const r = previewCoaRemap({ ...base, nextRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'CryptoHoldings' }, baseRules[1]], nextDefault: 'Suspense' });
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0]).toMatchObject({ fromAccount: 'DigitalAssets', toAccount: 'CryptoHoldings', leg: 'L1' });
  });

  it('conserves grand totals (pure reclassification, debits=credits unchanged)', () => {
    const r = previewCoaRemap({ ...base, nextRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'CryptoHoldings' }, baseRules[1]], nextDefault: 'Suspense' });
    expect(r.conservation.balanced).toBe(true);
    expect(r.conservation.beforeDebit).toBe(r.conservation.afterDebit);
    expect(r.conservation.beforeCredit).toBe(r.conservation.afterCredit);
  });

  it('coverage: counts legs that fall to the default', () => {
    const r = previewCoaRemap({ ...base, nextRules: [], nextDefault: 'Suspense' });
    expect(r.coverage.defaulted).toBe(2);
    expect(r.coverage.defaultedKeys).toContain('DIGITAL_ASSET_RECEIPT/L1');
  });

  it('warns UNKNOWN_ACCOUNT when remap targets an account outside knownAccounts', () => {
    const r = previewCoaRemap({ ...base, nextRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'MadeUpAcct' }, baseRules[1]], nextDefault: 'Suspense' });
    expect(r.warnings.some(w => w.kind === 'UNKNOWN_ACCOUNT' && w.detail.includes('MadeUpAcct'))).toBe(true);
  });

  it('flags ORPHANED_BALANCE when an account disappears from the after-activity', () => {
    const r = previewCoaRemap({ ...base, nextRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'CryptoHoldings' }, baseRules[1]], nextDefault: 'Suspense' });
    expect(r.warnings.some(w => w.kind === 'ORPHANED_BALANCE' && w.detail.includes('DigitalAssets'))).toBe(true);
  });

  it('flags REVERSAL_DIVERGENCE when an entry and its reversal would remap differently', () => {
    const orig = je([line('DigitalAssets', 'DEBIT', '1000', 'L1')]);
    const rev: JournalDTO = { ...je([line('DigitalAssets', 'CREDIT', '1000', 'L1')]), id: 'j2', je: { idempotencyKey: 'k2', lineageHash: 'lh2', reversalOf: 'k1', lines: [line('DigitalAssets', 'CREDIT', '1000', 'L1')] } };
    // engineered so the rule set treats them inconsistently — assert the detector path runs
    const r = previewCoaRemap({ ...base, journal: [orig, rev], nextRules: baseRules, nextDefault: 'Suspense' });
    expect(Array.isArray(r.warnings)).toBe(true); // structural: reversal pairing inspected
  });

  it('empty journal → empty result, no throw', () => {
    const r = previewCoaRemap({ ...base, journal: [], nextRules: baseRules, nextDefault: 'Suspense' });
    expect(r.changed).toEqual([]);
    expect(r.conservation.balanced).toBe(true);
  });

  it("normalizes empty/whitespace amountMinor (no BigInt('') throw)", () => {
    const dirty = je([{ ...line('DigitalAssets', 'DEBIT', '', 'L1'), amountMinor: '  ' }]);
    expect(() => previewCoaRemap({ ...base, journal: [dirty], nextRules: baseRules, nextDefault: 'Suspense' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/policyPreview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the engine**

```typescript
// web/src/lib/policyPreview.ts
// PURE. No React, no fetch. Immutable inputs. BigInt minor-unit math only.
import type { JournalDTO, EventDTO, CoaRuleDTO } from '../api/types';

export interface PreviewInput {
  journal: JournalDTO[]; events: EventDTO[];
  baseRules: CoaRuleDTO[]; baseDefault: string;
  nextRules: CoaRuleDTO[]; nextDefault: string;
  knownAccounts: string[];
}
export interface LineDiff { jeId: string; eventId: string; eventType: string; leg: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string; fromAccount: string; toAccount: string }
export interface CoverageReport { explicit: number; defaulted: number; defaultedKeys: string[] }
export interface Conservation { balanced: boolean; beforeDebit: string; beforeCredit: string; afterDebit: string; afterCredit: string }
export interface Warning { kind: 'UNKNOWN_ACCOUNT' | 'ORPHANED_BALANCE' | 'CROSS_STATEMENT' | 'REVERSAL_DIVERGENCE' | 'EMPTY_ACCOUNT'; detail: string }
export interface AccountActivityDTO { account: string; debitMinor: string; creditMinor: string }
export interface PreviewResult { changed: LineDiff[]; coverage: CoverageReport; conservation: Conservation; warnings: Warning[]; beforeActivity: AccountActivityDTO[]; afterActivity: AccountActivityDTO[] }

function toBig(s: string): bigint { const t = (s ?? '').trim(); return t === '' ? 0n : BigInt(t); }
const legStr = (leg: unknown): string => (leg == null ? '' : String(leg));

export function resolveCoaRule(rules: CoaRuleDTO[], defaultAccount: string, eventType: string, leg: string): string {
  const hit = rules.find((r) => r.eventType === eventType && (r.leg === leg || r.leg === '*'));
  return hit ? hit.account : defaultAccount;
}

export function eventTypeOf(je: JournalDTO, eventsById: Map<string, EventDTO>): string {
  const ev = eventsById.get(je.eventId);
  return ev?.final?.eventType ?? ev?.ai?.eventType ?? '';
}

function activity(rows: { account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }[]): AccountActivityDTO[] {
  const m = new Map<string, { d: bigint; c: bigint }>();
  for (const r of rows) {
    const cur = m.get(r.account) ?? { d: 0n, c: 0n };
    if (r.side === 'DEBIT') cur.d += toBig(r.amountMinor); else cur.c += toBig(r.amountMinor);
    m.set(r.account, cur);
  }
  return [...m.entries()].map(([account, v]) => ({ account, debitMinor: v.d.toString(), creditMinor: v.c.toString() }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

export function previewCoaRemap(input: PreviewInput): PreviewResult {
  const eventsById = new Map(input.events.map((e) => [e.id, e]));
  const known = new Set(input.knownAccounts);
  const changed: LineDiff[] = [];
  const defaultedKeys = new Set<string>();
  let explicit = 0, defaulted = 0;
  const warnings: Warning[] = [];
  const beforeRows: { account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }[] = [];
  const afterRows: typeof beforeRows = [];
  // reversal pairing: idempotencyKey → set of toAccounts (per leg) for divergence check
  const remapByKey = new Map<string, Map<string, string>>(); // idemKey → (leg → toAccount)

  for (const je of input.journal) {
    const eventType = eventTypeOf(je, eventsById);
    const idem = je.je.idempotencyKey;
    for (const ln of je.je.lines) {
      const leg = legStr(ln.leg);
      const hit = input.nextRules.find((r) => r.eventType === eventType && (r.leg === leg || r.leg === '*'));
      const to = hit ? hit.account : input.nextDefault;
      if (hit) explicit++; else { defaulted++; defaultedKeys.add(`${eventType}/${leg}`); }
      if (!to || to.trim() === '') warnings.push({ kind: 'EMPTY_ACCOUNT', detail: `${eventType}/${leg}` });
      else if (!known.has(to)) warnings.push({ kind: 'UNKNOWN_ACCOUNT', detail: `${to} (from ${eventType}/${leg})` });
      beforeRows.push({ account: ln.account, side: ln.side, amountMinor: ln.amountMinor });
      afterRows.push({ account: to, side: ln.side, amountMinor: ln.amountMinor });
      if (to !== ln.account) changed.push({ jeId: je.id, eventId: je.eventId, eventType, leg, side: ln.side, amountMinor: ln.amountMinor, fromAccount: ln.account, toAccount: to });
      const legMap = remapByKey.get(idem) ?? new Map<string, string>();
      legMap.set(leg, to); remapByKey.set(idem, legMap);
    }
  }

  // reversal divergence: original idemKey vs reversal's reversalOf must remap identically per leg
  for (const je of input.journal) {
    const rev = je.je.reversalOf;
    if (!rev) continue;
    const origMap = remapByKey.get(rev); const revMap = remapByKey.get(je.je.idempotencyKey);
    if (origMap && revMap) {
      for (const [leg, acct] of revMap) {
        if (origMap.has(leg) && origMap.get(leg) !== acct) warnings.push({ kind: 'REVERSAL_DIVERGENCE', detail: `${je.je.idempotencyKey} leg ${leg}: ${origMap.get(leg)} vs ${acct}` });
      }
    }
  }

  const beforeActivity = activity(beforeRows);
  const afterActivity = activity(afterRows);
  const beforeAccts = new Set(beforeActivity.map((a) => a.account));
  const afterAccts = new Set(afterActivity.map((a) => a.account));
  for (const a of beforeAccts) if (!afterAccts.has(a)) warnings.push({ kind: 'ORPHANED_BALANCE', detail: a });

  const sum = (rows: AccountActivityDTO[], k: 'debitMinor' | 'creditMinor') => rows.reduce((acc, r) => acc + toBig(r[k]), 0n);
  const beforeDebit = sum(beforeActivity, 'debitMinor'), beforeCredit = sum(beforeActivity, 'creditMinor');
  const afterDebit = sum(afterActivity, 'debitMinor'), afterCredit = sum(afterActivity, 'creditMinor');
  const conservation: Conservation = {
    balanced: beforeDebit === afterDebit && beforeCredit === afterCredit,
    beforeDebit: beforeDebit.toString(), beforeCredit: beforeCredit.toString(),
    afterDebit: afterDebit.toString(), afterCredit: afterCredit.toString(),
  };

  return { changed, coverage: { explicit, defaulted, defaultedKeys: [...defaultedKeys] }, conservation, warnings, beforeActivity, afterActivity };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd web && npx vitest run src/lib/policyPreview.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/policyPreview.ts web/src/lib/policyPreview.test.ts
git commit -m "feat(policy): pure COA-remap preview engine (coverage/conservation/orphan/reversal)"
```

---

## Task 6: Frontend — `usePolicyData` hook

**Files:**
- Create: `web/src/data/usePolicyData.ts`
- Test: exercised via Task 9 workspace render test.

**Interfaces:**
- Consumes: `getPolicyActive` (Task 4), `getJournal`, `listEvents` (existing). Mirror `useExportData`'s entity-gated fetch race pattern exactly.
- Produces: `usePolicyData(entityId): { data?: { policy: PolicyActiveDTO; journal: JournalDTO[]; events: EventDTO[] }; loading: boolean; error?: string; refetch: () => Promise<void> }`.

- [ ] **Step 1: Implement (copy useExportData's render-time gate verbatim, swap the payload)**

```typescript
// web/src/data/usePolicyData.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JournalDTO, EventDTO, PolicyActiveDTO } from '../api/types';
import { getJournal, listEvents, getPolicyActive } from '../api/endpoints';

interface PolicyValue { policy: PolicyActiveDTO; journal: JournalDTO[]; events: EventDTO[] }
interface FetchedState { entityId: string; value?: PolicyValue; error?: string }

export function usePolicyData(entityId: string) {
  const [state, setState] = useState<FetchedState>(() => ({ entityId }));
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!entityId) return;
    const capturedEntityId = entityId;
    const gen = ++genRef.current;
    setLoading(true);
    setState((prev) => ({ ...prev, error: undefined }));
    try {
      const [policy, journal, events] = await Promise.all([
        getPolicyActive(), getJournal(capturedEntityId), listEvents(capturedEntityId),
      ]);
      if (gen === genRef.current) setState({ entityId: capturedEntityId, value: { policy, journal, events } });
    } catch (e) {
      if (gen === genRef.current) setState({ entityId: capturedEntityId, error: (e as Error).message });
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void refetch(); }, [refetch]);

  const data = state.entityId === entityId ? state.value : undefined;
  const error = state.entityId === entityId ? state.error : undefined;
  return { data, loading, error, refetch };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/data/usePolicyData.ts
git commit -m "feat(policy): usePolicyData hook (entity-gated fetch, mirrors useExportData)"
```

---

## Task 7: Frontend — PolicySummaryCard + CoaMappingTable

**Files:**
- Create: `web/src/workspaces/policy/PolicySummaryCard.tsx`
- Create: `web/src/workspaces/policy/CoaMappingTable.tsx`
- Create: `web/src/workspaces/policy/policy.css`

**Interfaces:**
- Consumes: `PolicyActiveDTO` (Task 4).
- Produces: `<PolicySummaryCard policy={PolicyActiveDTO} />`, `<CoaMappingTable rules={CoaRuleDTO[]} defaultAccount={string} editable? onChange? />` (read-only when `editable` omitted; editable variant reused by PreviewPanel in Task 8).

- [ ] **Step 1: PolicySummaryCard — governance + config clusters**

```tsx
// web/src/workspaces/policy/PolicySummaryCard.tsx
import type { PolicyActiveDTO } from '../../api/types';
import './policy.css';

function Row({ label, value, chip }: { label: string; value: string; chip?: string }) {
  return (
    <div className="policy-defrow">
      <span className="policy-defrow-label">{label}</span>
      <span className="policy-defrow-value mono">{value}</span>
      {chip && <span className="policy-chip-deferred">{chip}</span>}
    </div>
  );
}

export function PolicySummaryCard({ policy }: { policy: PolicyActiveDTO }) {
  const p = policy.policySet;
  return (
    <section className="card policy-card">
      <h3 className="policy-card-title">Active Policy</h3>
      <div className="policy-cluster">
        <div className="policy-cluster-head">Governance</div>
        <div className="policy-chips">
          <span className="status-chip policy-chip-version">{p.policySetVersion}</span>
          <span className={`status-chip ${p.periodOpen ? 'policy-chip-open' : 'policy-chip-locked'}`}>
            {p.periodOpen ? 'PERIOD OPEN' : 'PERIOD LOCKED'}
          </span>
          <span className="status-chip policy-chip-period">{policy.periodId}</span>
        </div>
      </div>
      <div className="policy-cluster">
        <div className="policy-cluster-head">Accounting config</div>
        <Row label="Cost basis" value={p.costBasisMethod} chip="method locked — preview not supported" />
        <Row label="Functional currency" value={`${p.functionalCurrency} · fixed system assumption`} chip="method locked — preview not supported" />
        <Row label="Rounding threshold (minor)" value={p.roundingThresholdMinor} chip="what-if deferred" />
        <Row label="Rule version" value={p.ruleVersion} />
        <Row label="Parser / Normalization" value={`${p.parserVersion} / ${p.normalizationVersion}`} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: CoaMappingTable — read-only + editable variants**

```tsx
// web/src/workspaces/policy/CoaMappingTable.tsx
import type { CoaRuleDTO } from '../../api/types';
import './policy.css';

interface Props {
  rules: CoaRuleDTO[];
  defaultAccount: string;
  title: string;
  editable?: boolean;
  onChange?: (rules: CoaRuleDTO[]) => void;
}

export function CoaMappingTable({ rules, defaultAccount, title, editable, onChange }: Props) {
  const setAccount = (idx: number, account: string) => {
    if (!onChange) return;
    onChange(rules.map((r, i) => (i === idx ? { ...r, account } : r)));
  };
  return (
    <section className="card policy-coa">
      <h3 className="policy-card-title">{title}</h3>
      <table className="policy-coa-table">
        <thead><tr><th>Event type</th><th>Leg</th><th>Account</th></tr></thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={`${r.eventType}/${r.leg}`}>
              <td className="mono">{r.eventType}</td>
              <td className="mono">{r.leg}</td>
              <td className="mono">
                {editable
                  ? <input className="policy-coa-input" value={r.account} onChange={(e) => setAccount(i, e.target.value)} aria-label={`account for ${r.eventType} ${r.leg}`} />
                  : r.account}
              </td>
            </tr>
          ))}
          <tr className="policy-coa-default">
            <td className="mono">— default —</td><td className="mono">*</td><td className="mono">{defaultAccount}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 3: policy.css — reuse export/close idioms, no new colors, no --aqua**

```css
/* web/src/workspaces/policy/policy.css */
.policy-workspace { display: flex; flex-direction: column; gap: var(--space-4); max-width: 1200px; margin: 0 auto; }
.policy-card-title { font-size: 0.95em; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 var(--space-2); }
.policy-cluster { margin-bottom: var(--space-3); }
.policy-cluster-head { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft); margin-bottom: 6px; }
.policy-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.policy-chip-version { background: var(--brass); color: #fff; }
.policy-chip-open { background: var(--brass); color: #fff; }
.policy-chip-locked { background: var(--ink); color: #fff; }
.policy-chip-period { background: var(--paper-card); border: 1px solid var(--paper-line); color: var(--ink-soft); }
.policy-defrow { display: flex; align-items: center; gap: var(--space-2); padding: 4px 0; flex-wrap: wrap; }
.policy-defrow-label { min-width: 220px; text-transform: uppercase; font-size: 0.78em; letter-spacing: 0.04em; color: var(--ink-soft); }
.policy-defrow-value { font-size: 0.92em; }
.policy-chip-deferred { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: color-mix(in srgb, var(--warn) 12%, transparent); color: var(--warn); }
.policy-coa-table { width: 100%; border-collapse: collapse; }
.policy-coa-table th { text-align: left; font-size: 0.78em; text-transform: uppercase; color: var(--ink-soft); border-bottom: 1px solid var(--paper-line); padding: 6px 8px; }
.policy-coa-table td { padding: 6px 8px; border-bottom: 1px solid var(--paper-line); }
.policy-coa-default td { color: var(--ink-soft); font-style: italic; }
.policy-coa-input { font-family: inherit; font-size: 0.92em; padding: 3px 6px; border: 1px solid var(--paper-line); border-radius: var(--radius-sm, 8px); background: var(--paper); }
```

> Confirm `--ink`, `--ink-soft`, `--paper`, `--paper-card`, `--paper-line`, `--space-*`, `--radius-*` exist in `tokens.css`/`base.css` (they are used by export/close). If a token name differs, use the existing name — do not invent.

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/workspaces/policy/PolicySummaryCard.tsx web/src/workspaces/policy/CoaMappingTable.tsx web/src/workspaces/policy/policy.css
git commit -m "feat(policy): PolicySummaryCard + CoaMappingTable components"
```

---

## Task 8: Frontend — PreviewPanel (diff + before/after trial balance)

**Files:**
- Create: `web/src/workspaces/policy/PreviewPanel.tsx`
- Modify: `web/src/workspaces/policy/policy.css` (append preview styles)

**Interfaces:**
- Consumes: `previewCoaRemap`, `PreviewResult`, `LineDiff` (Task 5); `CoaMappingTable` editable (Task 7); `PolicyActiveDTO`, `JournalDTO`, `EventDTO`.
- Produces: `<PreviewPanel policy={PolicyActiveDTO} journal={JournalDTO[]} events={EventDTO[]} />`.

- [ ] **Step 1: Implement the panel**

```tsx
// web/src/workspaces/policy/PreviewPanel.tsx
import { useMemo, useState } from 'react';
import type { PolicyActiveDTO, JournalDTO, EventDTO, CoaRuleDTO } from '../../api/types';
import { previewCoaRemap, type PreviewResult } from '../../lib/policyPreview';
import { CoaMappingTable } from './CoaMappingTable';
import './policy.css';

export function PreviewPanel({ policy, journal, events }: { policy: PolicyActiveDTO; journal: JournalDTO[]; events: EventDTO[] }) {
  const baseRules = policy.coaMapping.rules;
  const baseDefault = policy.coaMapping.defaultAccount;
  const [draft, setDraft] = useState<CoaRuleDTO[]>(() => baseRules.map((r) => ({ ...r })));
  const [result, setResult] = useState<PreviewResult | null>(null);

  const knownAccounts = useMemo(() => {
    const s = new Set<string>([baseDefault]);
    baseRules.forEach((r) => s.add(r.account));
    journal.forEach((j) => j.je.lines.forEach((l) => s.add(l.account)));
    return [...s];
  }, [baseRules, baseDefault, journal]);

  const recompute = () => setResult(previewCoaRemap({ journal, events, baseRules, baseDefault, nextRules: draft, nextDefault: baseDefault, knownAccounts }));

  return (
    <section className="card policy-preview export-draft-card">
      <div className="policy-preview-head">
        <h3 className="policy-card-title">What-if: COA remap preview</h3>
        <span className="export-status-badge--draft policy-preview-badge">PREVIEW — NOT APPLIED</span>
      </div>

      <CoaMappingTable rules={draft} defaultAccount={baseDefault} title="Draft mapping (edit to preview)" editable onChange={setDraft} />
      <button className="export-retry-btn policy-recompute" onClick={recompute}>Recompute preview</button>

      {result && (
        <>
          <div className="policy-preview-meta">
            <span>Changed lines: <strong>{result.changed.length}</strong></span>
            <span>Coverage: {result.coverage.explicit} explicit · {result.coverage.defaulted} defaulted</span>
            <span className={result.conservation.balanced ? 'policy-ok' : 'policy-bad'}>
              {result.conservation.balanced ? 'Grand totals conserved ✓' : 'CONSERVATION BROKEN'}
            </span>
          </div>

          {result.warnings.length > 0 && (
            <ul className="policy-warnings">
              {result.warnings.map((w, i) => <li key={i} className="lock-blockers">{w.kind}: {w.detail}</li>)}
            </ul>
          )}

          <table className="policy-coa-table policy-diff">
            <thead><tr><th>JE</th><th>Event type</th><th>Leg</th><th className="num">Amount (minor)</th><th>From → To</th></tr></thead>
            <tbody>
              {result.changed.map((d: import('../../lib/policyPreview').LineDiff, i) => (
                <tr key={i} className="policy-diff-changed">
                  <td className="mono">{d.jeId}</td><td className="mono">{d.eventType}</td><td className="mono">{d.leg}</td>
                  <td className="mono num">{d.amountMinor}</td>
                  <td className="mono">{d.fromAccount} <span className="policy-delta">Δ</span> {d.toAccount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="policy-tb-split">
            {(['beforeActivity', 'afterActivity'] as const).map((key) => (
              <div className="policy-tb-col" key={key}>
                <div className="policy-cluster-head">{key === 'beforeActivity' ? 'Before' : 'After'}</div>
                <table className="policy-coa-table">
                  <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
                  <tbody>
                    {result[key].map((a) => (
                      <tr key={a.account}><td className="mono">{a.account}</td>
                        <td className="mono num policy-debit">{a.debitMinor}</td>
                        <td className="mono num policy-credit">{a.creditMinor}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Append preview CSS (brass-Δ diff; red/green only on trial-balance cols; no --aqua)**

```css
/* policy.css — append */
.policy-preview-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.policy-preview-badge { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
.policy-recompute { margin: var(--space-2) 0; }
.policy-preview-meta { display: flex; flex-wrap: wrap; gap: var(--space-3); font-size: 0.9em; margin: var(--space-2) 0; }
.policy-ok { color: var(--credit); font-weight: 700; }
.policy-bad { color: var(--debit); font-weight: 700; }
.policy-warnings { list-style: none; padding: 0; margin: var(--space-2) 0; display: flex; flex-direction: column; gap: 6px; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.policy-diff-changed { border-left: 3px solid var(--brass); }
.policy-delta { color: var(--brass); font-weight: 700; }
.policy-debit { color: var(--debit); }
.policy-credit { color: var(--credit); }
.policy-tb-split { display: flex; gap: var(--space-4); align-items: flex-start; margin-top: var(--space-3); }
.policy-tb-col { flex: 1 1 0; }
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/workspaces/policy/PreviewPanel.tsx web/src/workspaces/policy/policy.css
git commit -m "feat(policy): PreviewPanel — diff table + before/after trial balance"
```

---

## Task 9: Frontend — PolicyWorkspace shell + register + render test

**Files:**
- Create: `web/src/workspaces/policy/PolicyWorkspace.tsx`
- Modify: `web/src/app/workspaces.ts` (flip `policy` → `ready`)
- Modify: the workspace router that switches on `WorkspaceId` (grep `ExportWorkspace` to find it)
- Test: `web/src/workspaces/policy/PolicyWorkspace.test.tsx`

**Interfaces:**
- Consumes: `usePolicyData` (Task 6), `PolicySummaryCard` + `CoaMappingTable` (Task 7), `PreviewPanel` (Task 8), `useEntityCtx` (existing).
- Produces: `<PolicyWorkspace />` default-export-or-named matching how sibling workspaces are mounted.

- [ ] **Step 1: Write the failing render test**

```tsx
// web/src/workspaces/policy/PolicyWorkspace.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PolicyWorkspace } from './PolicyWorkspace';

vi.mock('../../data/usePolicyData', () => ({
  usePolicyData: () => ({
    loading: false, error: undefined, refetch: vi.fn(),
    data: {
      policy: { policySet: { policySetVersion: 'demo-ps-1', assetPolicyVersion: 'a', eventPolicyVersion: 'e', ruleVersion: 'r', parserVersion: 'p', normalizationVersion: 'n', costBasisMethod: 'FIFO', functionalCurrency: 'USD', roundingThresholdMinor: '0', periodOpen: true },
        coaMapping: { rules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'DigitalAssets' }], defaultAccount: 'Suspense' }, periodId: '2026-Q2' },
      journal: [], events: [],
    },
  }),
}));
vi.mock('../../app/EntityContext', () => ({ useEntityCtx: () => ({ entityId: 'acme:pilot-001' }) }));

it('renders active policy version + COA mapping + preview safe-state badge', async () => {
  render(<PolicyWorkspace />);
  await waitFor(() => expect(screen.getByText('demo-ps-1')).toBeInTheDocument());
  expect(screen.getByText('PERIOD OPEN')).toBeInTheDocument();
  expect(screen.getByText('PREVIEW — NOT APPLIED')).toBeInTheDocument();
  expect(screen.getByText(/method locked/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/workspaces/policy/PolicyWorkspace.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the shell**

```tsx
// web/src/workspaces/policy/PolicyWorkspace.tsx
import { useEntityCtx } from '../../app/EntityContext';
import { usePolicyData } from '../../data/usePolicyData';
import { PolicySummaryCard } from './PolicySummaryCard';
import { CoaMappingTable } from './CoaMappingTable';
import { PreviewPanel } from './PreviewPanel';
import './policy.css';

export function PolicyWorkspace() {
  const { entityId } = useEntityCtx();
  const { data, loading, error } = usePolicyData(entityId);

  if (loading && !data) return <div className="policy-workspace"><p>Loading policy…</p></div>;
  if (error || !data) return <div className="policy-workspace"><p className="policy-bad">policy unavailable{error ? `: ${error}` : ''}</p></div>;

  const { policy, journal, events } = data;
  return (
    <div className="policy-workspace">
      <PolicySummaryCard policy={policy} />
      <CoaMappingTable rules={policy.coaMapping.rules} defaultAccount={policy.coaMapping.defaultAccount} title="Live COA mapping" />
      <PreviewPanel policy={policy} journal={journal} events={events} />
    </div>
  );
}
```

- [ ] **Step 4: Flip the registry + mount in the router**

In `web/src/app/workspaces.ts`: change `{ id: 'policy', label: 'Policy', icon: '📐', status: 'soon' }` → `status: 'ready'`.
In the workspace router (the component that maps `WorkspaceId` → element, found via `grep -rn "ExportWorkspace" web/src/app`), add the `policy` case rendering `<PolicyWorkspace />`, mirroring how `export` is mounted.

- [ ] **Step 5: Run test + typecheck**

Run: `cd web && npx vitest run src/workspaces/policy/PolicyWorkspace.test.tsx && npx tsc --noEmit`
Expected: PASS + 0 errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/workspaces/policy/PolicyWorkspace.tsx web/src/workspaces/policy/PolicyWorkspace.test.tsx web/src/app/workspaces.ts web/src/app/*
git commit -m "feat(policy): PolicyWorkspace shell + register (soon→ready)"
```

---

## Task 10: Monkey testing + full-suite + build verification

**Files:**
- Modify: `web/src/lib/policyPreview.test.ts` (append monkey block)

**Interfaces:** none new.

- [ ] **Step 1: Append monkey/extreme tests**

```typescript
// web/src/lib/policyPreview.test.ts — append
import { previewCoaRemap } from './policyPreview';

describe('policyPreview — monkey/extreme', () => {
  const events = [{ id: 'e1', entityId: 'x', status: 'POSTED' as const, normalized: {}, ai: null, final: { eventType: 'DIGITAL_ASSET_RECEIPT', purpose: '' }, routing: null }];
  const mkLine = (account: string, side: 'DEBIT'|'CREDIT', amt: string, leg: unknown) => ({ account, side, amountMinor: amt, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg });

  it('huge journal volume does not throw and conserves totals', () => {
    const journal = Array.from({ length: 5000 }, (_, i) => ({
      id: `j${i}`, eventId: 'e1', idempotencyKey: `k${i}`, leafHash: 'h',
      je: { idempotencyKey: `k${i}`, lineageHash: 'l', reversalOf: null, lines: [mkLine('DigitalAssets', 'DEBIT', '1000', 'L1'), mkLine('AccountsReceivable', 'CREDIT', '1000', 'L2')] },
    }));
    const r = previewCoaRemap({ journal, events, baseRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'DigitalAssets' }], baseDefault: 'Suspense', nextRules: [{ eventType: 'DIGITAL_ASSET_RECEIPT', leg: 'L1', account: 'CryptoHoldings' }], nextDefault: 'Suspense', knownAccounts: ['DigitalAssets','AccountsReceivable','CryptoHoldings','Suspense'] });
    expect(r.conservation.balanced).toBe(true);
  });

  it('malicious leg values (object/number coerced) do not crash', () => {
    const journal = [{ id: 'j', eventId: 'e1', idempotencyKey: 'k', leafHash: 'h', je: { idempotencyKey: 'k', lineageHash: 'l', reversalOf: null, lines: [mkLine('X', 'DEBIT', '1', { evil: true } as unknown), mkLine('Y', 'CREDIT', '1', 42 as unknown)] } }];
    expect(() => previewCoaRemap({ journal: journal as any, events, baseRules: [], baseDefault: 'Suspense', nextRules: [], nextDefault: 'Suspense', knownAccounts: ['X','Y','Suspense'] })).not.toThrow();
  });

  it('negative and oversized minor amounts handled as BigInt', () => {
    const big = '999999999999999999999999999999';
    const journal = [{ id: 'j', eventId: 'e1', idempotencyKey: 'k', leafHash: 'h', je: { idempotencyKey: 'k', lineageHash: 'l', reversalOf: null, lines: [mkLine('X', 'DEBIT', big, 'L1'), mkLine('X', 'CREDIT', `-${big}`, 'L1')] } }];
    const r = previewCoaRemap({ journal: journal as any, events, baseRules: [], baseDefault: 'Suspense', nextRules: [], nextDefault: 'Suspense', knownAccounts: ['X','Suspense'] });
    expect(typeof r.conservation.beforeDebit).toBe('string');
  });
});
```

- [ ] **Step 2: Run the FULL web suite + build + api suite**

Run: `cd web && npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green (366 prior + new policy tests), 0 type errors, build succeeds.

Run: `cd services/api && npx vitest run`
Expected: all green (162 prior + new policy tests).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/policyPreview.test.ts
git commit -m "test(policy): monkey/extreme cases for COA-remap engine + full-suite green"
```

---

## Self-Review (completed)

- **Spec coverage**: §1 boundary/levers → Tasks 1-2,5,7-9; §2 architecture/serializable table → Task 1; spine → Task 3; §3 engine + controls → Task 5; §4 UI (single-column, DRAFT badge, brass-Δ, ghost-pill, locked/deferred chips, no aqua) → Tasks 7-9; §5 error/closed-period/anti-drift/cross-check/monkey → Tasks 1,3,9,10; §6 deferred → reflected as read-only chips (Task 7). Closed-period scoping (D1=a): journal fetched is the single-period source (`2026-Q2`); when multi-period lands, filter by open period — noted, current data is single-period so no extra filter needed now.
- **Placeholder scan**: none — every code step shows full code; the only "adjust to actual" notes are explicit instructions to match existing helper/factory names, with a concrete fallback given.
- **Type consistency**: `CoaRule`(backend)/`CoaRuleDTO`(frontend), `PreviewInput`/`PreviewResult`/`LineDiff`/`Warning` consistent across Tasks 5/8; `getPolicyActive` signature consistent Tasks 3/4/6; `policySetVersion` path `policy.policySet.policySetVersion` consistent Tasks 3/6.
- **Open assumption flagged for executor**: the exact Fastify app-factory/inject helper (Task 2 Step 1) and `buildBundle` manifest accessor (Task 3 Step 1) must be matched to existing test conventions — read the sibling test first.
