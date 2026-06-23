# Period Close Cockpit (Phase 2 B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `close` workspace from a linear 5-step flow into a six-light readiness cockpit gating a mock period-lock, with the existing real on-chain anchor layered on top (lock-before-anchor) and a reopen/restatement path.

**Architecture:** Net-new off-chain period state machine (`OPEN`/`LOCKED`) persisted in a new `period_lock` SQLite table, recompute-on-read six-light aggregation reusing existing close-readiness/journal/review signals, and a frontend cockpit landing. Zero Move changes — chain authority untouched. Spec: `docs/superpowers/specs/2026-06-24-period-close-cockpit-design.md`.

**Tech Stack:** Backend Fastify + better-sqlite3 (`services/api`), Vitest. Frontend Vite + React + @mysten/dapp-kit-react (`web/`), Vitest + jsdom.

## Global Constraints

- **Backend test runner:** `cd services/api && npx vitest run <file>` ; full suite `npm test`. Type-check `npx tsc --noEmit`.
- **Frontend test runner:** `cd web && npx vitest run <file>` ; build gate `npm run build` (NOT only `tsc --noEmit` — vite.config is excluded from app tsconfig).
- **Money:** minor-unit integer **strings**, compared with `BigInt` — never JS number arithmetic on amounts.
- **Fail-closed / no-trust-client:** state gates recompute on the server; never trust client-sent light values or actor identity. Actor fields (`lockedBy`/`requestedBy`/`approvedBy`) are the server const `'demo-controller'` (matches existing `decidedBy`).
- **DB writes:** multi-row writes wrapped in `db.transaction(() => {...})()` with a compare-and-set read inside the transaction (mirror `services/api/src/exceptions/disposition.ts`).
- **DEFAULT_PERIOD** = `'2026-Q2'` (existing const in `routes.ts`).
- **Period scope:** lock/reopen are `(entityId, periodId)`-scoped; `anchored` must be per-period (NOT the entity-wide `hasAnchoredSnapshot`). Single-period demo; `period_id`-on-events is blocking-for-production (spec §9).
- **No raw px / no new color tokens in CSS:** use `--s-N`/`--r-*` aliases and `--credit`/`--debit`/`--warn`/`--ink-soft`/`--ink`/`--paper-card`. `--aqua` is reserved for on-chain provenance ONLY — never for a light state.
- **Monkey testing mandatory** (backend.md) after unit/integration on every backend task that adds an endpoint or write path.

---

## File Structure

**Backend (new):**
- `services/api/src/periodLock/state.ts` — pure transition allowlist + reason-code enum.
- `services/api/src/periodLock/store.ts` — `period_lock` table read/write (transactional CAS).
- `services/api/src/periodLock/cockpit.ts` — six-light aggregation (recompute-on-read).
- `services/api/src/store/schema.sql` — **modify**: add `period_lock` table.
- `services/api/src/store/snapshotStore.ts` — **modify**: add `hasAnchoredSnapshotForPeriod`.
- `services/api/src/http/routes.ts` — **modify**: 3 new endpoints + `/snapshot` LOCKED-gate-inside-mutex.

**Frontend (new):**
- `web/src/workspaces/close/CloseCockpit.tsx`, `LightCard.tsx`, `LockPanel.tsx`, `ReopenDialog.tsx`, `close.css`.
- `web/src/hooks/useCloseCockpit.ts`.
- `web/src/api/types.ts` — **modify**: add cockpit DTO types.
- `web/src/App.tsx` — **modify**: route `close` workspace to CloseCockpit; StepRail secondary.

---

## Task 1: Period state machine (pure)

**Files:**
- Create: `services/api/src/periodLock/state.ts`
- Test: `services/api/src/periodLock/state.test.ts`

**Interfaces:**
- Produces: `type PeriodStatus = 'OPEN' | 'LOCKED'`; `type PeriodAction = 'lock' | 'reopen'`; `REOPEN_REASON_CODES` (readonly string[]); `type ReopenReasonCode`; `assertPeriodTransition(from: PeriodStatus, action: PeriodAction): PeriodStatus` (returns the resulting status, throws `Error('ILLEGAL_TRANSITION: ...')` on illegal).

- [ ] **Step 1: Write the failing test**

```ts
// services/api/src/periodLock/state.test.ts
import { describe, it, expect } from 'vitest';
import { assertPeriodTransition, REOPEN_REASON_CODES } from './state.js';

describe('period state machine', () => {
  it('OPEN --lock--> LOCKED', () => {
    expect(assertPeriodTransition('OPEN', 'lock')).toBe('LOCKED');
  });
  it('LOCKED --reopen--> OPEN', () => {
    expect(assertPeriodTransition('LOCKED', 'reopen')).toBe('OPEN');
  });
  // WHY: a closed period must not be re-lockable without a reopen first; an open
  // period must not be reopen-able. Both are accounting-control violations.
  it('rejects lock when already LOCKED', () => {
    expect(() => assertPeriodTransition('LOCKED', 'lock')).toThrow(/ILLEGAL_TRANSITION/);
  });
  it('rejects reopen when OPEN', () => {
    expect(() => assertPeriodTransition('OPEN', 'reopen')).toThrow(/ILLEGAL_TRANSITION/);
  });
  it('exposes a non-empty reason-code enum', () => {
    expect(REOPEN_REASON_CODES.length).toBeGreaterThan(0);
    expect(REOPEN_REASON_CODES).toContain('ERROR_CORRECTION');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/periodLock/state.test.ts`
Expected: FAIL — cannot find module `./state.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// services/api/src/periodLock/state.ts
export type PeriodStatus = 'OPEN' | 'LOCKED';
export type PeriodAction = 'lock' | 'reopen';

// Restatement classification — drives disclosure treatment (ASC 250 / IAS 8).
// Stored on reopen so the audit trail records WHY a closed period was unwound.
export const REOPEN_REASON_CODES = [
  'ERROR_CORRECTION',
  'ESTIMATE_CHANGE',
  'LATE_ARRIVING_TXN',
  'RECLASSIFICATION',
  'OTHER',
] as const;
export type ReopenReasonCode = (typeof REOPEN_REASON_CODES)[number];

const LEGAL: Record<PeriodStatus, Partial<Record<PeriodAction, PeriodStatus>>> = {
  OPEN: { lock: 'LOCKED' },
  LOCKED: { reopen: 'OPEN' },
};

export function assertPeriodTransition(from: PeriodStatus, action: PeriodAction): PeriodStatus {
  const to = LEGAL[from]?.[action];
  if (!to) throw new Error(`ILLEGAL_TRANSITION: ${from} --${action}-->`);
  return to;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run src/periodLock/state.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/periodLock/state.ts services/api/src/periodLock/state.test.ts
git commit -m "feat(api): period-lock state machine (OPEN/LOCKED) + reopen reason codes"
```

---

## Task 2: period_lock table + transactional store

**Files:**
- Modify: `services/api/src/store/schema.sql` (append table)
- Create: `services/api/src/periodLock/store.ts`
- Test: `services/api/src/periodLock/store.test.ts`

**Interfaces:**
- Consumes: `PeriodStatus`, `PeriodAction`, `ReopenReasonCode`, `assertPeriodTransition` from Task 1; `Db` from `../store/db.js`.
- Produces:
  - `interface PeriodLockRow { entityId; periodId; status: PeriodStatus; lockedAt: number|null; lockedBy: string|null; lightsSnapshot: string|null; reopenedAt: number|null; reopenCount: number; restatementReason: string|null; reasonCode: ReopenReasonCode|null; affectedAmountEstimate: string|null; wasAnchoredAtReopen: number|null; requestedBy: string|null; approvedBy: string|null }`
  - `getPeriodLock(db, entityId, periodId): PeriodLockRow` — returns a synthetic `OPEN` row (reopenCount 0, all nullable null) when no row exists.
  - `lockPeriod(db, {entityId, periodId, lightsSnapshot, lockedBy, now}): PeriodLockRow`
  - `reopenPeriod(db, {entityId, periodId, restatementReason, reasonCode, affectedAmountEstimate, wasAnchored, requestedBy, approvedBy, now}): PeriodLockRow`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/src/periodLock/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../store/db.js';
import { getPeriodLock, lockPeriod, reopenPeriod } from './store.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0x1','0x2','0x3')").run();
});

it('absent period defaults to OPEN with reopenCount 0', () => {
  const r = getPeriodLock(db, 'e1', 'P1');
  expect(r.status).toBe('OPEN');
  expect(r.reopenCount).toBe(0);
});

it('lock persists status + immutable lights snapshot', () => {
  const r = lockPeriod(db, { entityId: 'e1', periodId: 'P1', lightsSnapshot: '{"je":"green"}', lockedBy: 'demo-controller', now: 1000 });
  expect(r.status).toBe('LOCKED');
  expect(r.lockedAt).toBe(1000);
  expect(r.lightsSnapshot).toBe('{"je":"green"}');
});

// WHY: locking an already-LOCKED period is an illegal transition; the CAS guard
// must reject it rather than silently overwrite the lock evidence.
it('lock on already-LOCKED throws ILLEGAL_TRANSITION', () => {
  lockPeriod(db, { entityId: 'e1', periodId: 'P1', lightsSnapshot: '{}', lockedBy: 'x', now: 1 });
  expect(() => lockPeriod(db, { entityId: 'e1', periodId: 'P1', lightsSnapshot: '{}', lockedBy: 'x', now: 2 })).toThrow(/ILLEGAL_TRANSITION/);
});

it('reopen flips to OPEN, bumps count, records restatement fields', () => {
  lockPeriod(db, { entityId: 'e1', periodId: 'P1', lightsSnapshot: '{}', lockedBy: 'x', now: 1 });
  const r = reopenPeriod(db, { entityId: 'e1', periodId: 'P1', restatementReason: 'fix fx', reasonCode: 'ERROR_CORRECTION', affectedAmountEstimate: '500', wasAnchored: true, requestedBy: 'demo-controller', approvedBy: 'demo-controller', now: 2 });
  expect(r.status).toBe('OPEN');
  expect(r.reopenCount).toBe(1);
  expect(r.reasonCode).toBe('ERROR_CORRECTION');
  expect(r.wasAnchoredAtReopen).toBe(1);
});

it('reopen on OPEN throws ILLEGAL_TRANSITION', () => {
  expect(() => reopenPeriod(db, { entityId: 'e1', periodId: 'P1', restatementReason: 'x', reasonCode: 'OTHER', affectedAmountEstimate: null, wasAnchored: false, requestedBy: 'a', approvedBy: 'b', now: 1 })).toThrow(/ILLEGAL_TRANSITION/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/periodLock/store.test.ts`
Expected: FAIL — cannot find `./store.js`.

- [ ] **Step 3a: Append the table to schema.sql**

Append to `services/api/src/store/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS period_lock (
  entity_id               TEXT NOT NULL REFERENCES entities(id),
  period_id               TEXT NOT NULL,
  status                  TEXT NOT NULL,
  locked_at               INTEGER,
  locked_by               TEXT,
  lights_snapshot         TEXT,
  reopened_at             INTEGER,
  reopen_count            INTEGER NOT NULL DEFAULT 0,
  restatement_reason      TEXT,
  reason_code             TEXT,
  affected_amount_estimate TEXT,
  was_anchored_at_reopen  INTEGER,
  requested_by            TEXT,
  approved_by             TEXT,
  PRIMARY KEY (entity_id, period_id)
);
```

- [ ] **Step 3b: Write the store**

```ts
// services/api/src/periodLock/store.ts
import type { Db } from '../store/db.js';
import { assertPeriodTransition, type PeriodStatus, type ReopenReasonCode } from './state.js';

export interface PeriodLockRow {
  entityId: string; periodId: string; status: PeriodStatus;
  lockedAt: number | null; lockedBy: string | null; lightsSnapshot: string | null;
  reopenedAt: number | null; reopenCount: number;
  restatementReason: string | null; reasonCode: ReopenReasonCode | null;
  affectedAmountEstimate: string | null; wasAnchoredAtReopen: number | null;
  requestedBy: string | null; approvedBy: string | null;
}

function map(r: Record<string, unknown>): PeriodLockRow {
  return {
    entityId: r.entity_id as string, periodId: r.period_id as string, status: r.status as PeriodStatus,
    lockedAt: (r.locked_at as number | null) ?? null, lockedBy: (r.locked_by as string | null) ?? null,
    lightsSnapshot: (r.lights_snapshot as string | null) ?? null,
    reopenedAt: (r.reopened_at as number | null) ?? null, reopenCount: (r.reopen_count as number) ?? 0,
    restatementReason: (r.restatement_reason as string | null) ?? null,
    reasonCode: (r.reason_code as ReopenReasonCode | null) ?? null,
    affectedAmountEstimate: (r.affected_amount_estimate as string | null) ?? null,
    wasAnchoredAtReopen: (r.was_anchored_at_reopen as number | null) ?? null,
    requestedBy: (r.requested_by as string | null) ?? null, approvedBy: (r.approved_by as string | null) ?? null,
  };
}

export function getPeriodLock(db: Db, entityId: string, periodId: string): PeriodLockRow {
  const r = db.prepare('SELECT * FROM period_lock WHERE entity_id = ? AND period_id = ?').get(entityId, periodId) as Record<string, unknown> | undefined;
  if (r) return map(r);
  // Synthetic default — an un-touched period is OPEN.
  return {
    entityId, periodId, status: 'OPEN', lockedAt: null, lockedBy: null, lightsSnapshot: null,
    reopenedAt: null, reopenCount: 0, restatementReason: null, reasonCode: null,
    affectedAmountEstimate: null, wasAnchoredAtReopen: null, requestedBy: null, approvedBy: null,
  };
}

export function lockPeriod(
  db: Db,
  a: { entityId: string; periodId: string; lightsSnapshot: string; lockedBy: string; now: number },
): PeriodLockRow {
  let out!: PeriodLockRow;
  db.transaction(() => {
    const cur = getPeriodLock(db, a.entityId, a.periodId);
    assertPeriodTransition(cur.status, 'lock'); // CAS: throws if not OPEN
    db.prepare(
      `INSERT INTO period_lock (entity_id, period_id, status, locked_at, locked_by, lights_snapshot, reopen_count)
       VALUES (?, ?, 'LOCKED', ?, ?, ?, ?)
       ON CONFLICT(entity_id, period_id) DO UPDATE SET
         status='LOCKED', locked_at=excluded.locked_at, locked_by=excluded.locked_by, lights_snapshot=excluded.lights_snapshot`,
    ).run(a.entityId, a.periodId, a.now, a.lockedBy, a.lightsSnapshot, cur.reopenCount);
    out = getPeriodLock(db, a.entityId, a.periodId);
  })();
  return out;
}

export function reopenPeriod(
  db: Db,
  a: { entityId: string; periodId: string; restatementReason: string; reasonCode: ReopenReasonCode;
       affectedAmountEstimate: string | null; wasAnchored: boolean; requestedBy: string; approvedBy: string; now: number },
): PeriodLockRow {
  let out!: PeriodLockRow;
  db.transaction(() => {
    const cur = getPeriodLock(db, a.entityId, a.periodId);
    assertPeriodTransition(cur.status, 'reopen'); // CAS: throws if not LOCKED
    db.prepare(
      `UPDATE period_lock SET status='OPEN', reopened_at=?, reopen_count=?, restatement_reason=?, reason_code=?,
         affected_amount_estimate=?, was_anchored_at_reopen=?, requested_by=?, approved_by=?
       WHERE entity_id=? AND period_id=?`,
    ).run(a.now, cur.reopenCount + 1, a.restatementReason, a.reasonCode, a.affectedAmountEstimate,
          a.wasAnchored ? 1 : 0, a.requestedBy, a.approvedBy, a.entityId, a.periodId);
    out = getPeriodLock(db, a.entityId, a.periodId);
  })();
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run src/periodLock/store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/store/schema.sql services/api/src/periodLock/store.ts services/api/src/periodLock/store.test.ts
git commit -m "feat(api): period_lock table + transactional CAS lock/reopen store"
```

---

## Task 3: Per-period anchored helper + six-light aggregation

**Files:**
- Modify: `services/api/src/store/snapshotStore.ts` (add helper)
- Create: `services/api/src/periodLock/cockpit.ts`
- Test: `services/api/src/periodLock/cockpit.test.ts`

**Interfaces:**
- Consumes: `getPeriodLock` (Task 2); `listJournal` from `../store/journalStore.js`; `collectExceptions` from `../exceptions/collect.js`; `BLOCKING_CATEGORIES` from `../exceptions/types.js`; `getDisposition` from `../store/dispositionStore.js`; `openMaterialReconBlockers` from `../reconciliation/collect.js`; `listByStatus` from `../store/eventStore.js`.
- Produces:
  - `hasAnchoredSnapshotForPeriod(db, entityId, periodId): boolean` (snapshotStore).
  - `type LightStatus = 'green' | 'red' | 'derived' | 'mock'`
  - `interface Light { key: string; status: LightStatus; label: string; real: boolean }`
  - `interface CockpitView { lights: Light[]; status: PeriodStatus; anchored: boolean; staleAnchor: boolean; closeable: boolean; reopenCount: number; restatementReason: string|null; reasonCode: string|null }`
  - `buildCockpit(db, entityId, periodId, lowConf: number): CockpitView`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/src/periodLock/cockpit.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../store/db.js';
import { buildCockpit } from './cockpit.js';
import { hasAnchoredSnapshotForPeriod } from '../store/snapshotStore.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0x1','0x2','0x3')").run();
});

it('pricing and export lights are mock and never green', () => {
  const v = buildCockpit(db, 'e1', '2026-Q2', 0.7);
  const pricing = v.lights.find((l) => l.key === 'pricing')!;
  const exp = v.lights.find((l) => l.key === 'export')!;
  expect(pricing.status).toBe('mock');
  expect(exp.status).toBe('mock');
  expect(pricing.real).toBe(false);
});

// WHY: closeable must ignore mock lights (no signal) but require every real/derived
// blocking light green — else "all green = closeable" overstates what was verified.
it('closeable ignores mock lights', () => {
  // No events => completeness red (presence check fails) => not closeable.
  const v = buildCockpit(db, 'e1', '2026-Q2', 0.7);
  expect(v.closeable).toBe(false);
});

// WHY: JE light bundles per-JE balance AND aggregate trial-balance tie-out;
// individually-balanced JEs whose entity TB nets non-zero must NOT show green.
it('JE light is red when trial balance does not net to zero', () => {
  db.prepare("INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1','{}','AUTO')").run();
  // One JE internally balanced; a second JE balanced alone but skews entity TB.
  const balanced = JSON.stringify({ lines: [{ side: 'DEBIT', amountMinor: '100' }, { side: 'CREDIT', amountMinor: '100' }] });
  const skew = JSON.stringify({ lines: [{ side: 'DEBIT', amountMinor: '50' }, { side: 'CREDIT', amountMinor: '50' }, { side: 'DEBIT', amountMinor: '7' }] });
  db.prepare("INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash) VALUES ('j1','e1','ev1',?, 'k1','h1')").run(balanced);
  db.prepare("INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash) VALUES ('j2','e1','ev1',?, 'k2','h2')").run(skew);
  const je = buildCockpit(db, 'e1', '2026-Q2', 0.7).lights.find((l) => l.key === 'je')!;
  expect(je.status).toBe('red');
});

it('hasAnchoredSnapshotForPeriod is false for a different period', () => {
  db.prepare("INSERT INTO snapshots (id, entity_id, period_id, manifest_json, manifest_hash, merkle_root, leaf_count, supersedes_seq, status) VALUES ('s1','e1','2026-Q1','{}','h','r',1,NULL,'ANCHORED')").run();
  expect(hasAnchoredSnapshotForPeriod(db, 'e1', '2026-Q1')).toBe(true);
  expect(hasAnchoredSnapshotForPeriod(db, 'e1', '2026-Q2')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/periodLock/cockpit.test.ts`
Expected: FAIL — cannot find `./cockpit.js` / `hasAnchoredSnapshotForPeriod`.

- [ ] **Step 3a: Add the per-period helper to snapshotStore.ts**

Append to `services/api/src/store/snapshotStore.ts`:

```ts
// Per-period anchored check — distinct from the entity-wide hasAnchoredSnapshot.
// The cockpit must attribute "anchored" to the selected period, not the whole entity.
export function hasAnchoredSnapshotForPeriod(db: Db, entityId: string, periodId: string): boolean {
  const r = db.prepare("SELECT 1 FROM snapshots WHERE entity_id = ? AND period_id = ? AND status = 'ANCHORED' LIMIT 1").get(entityId, periodId);
  return r !== undefined;
}
```

- [ ] **Step 3b: Write cockpit.ts**

```ts
// services/api/src/periodLock/cockpit.ts
import type { Db } from '../store/db.js';
import type { PeriodStatus } from './state.js';
import { getPeriodLock } from './store.js';
import { hasAnchoredSnapshotForPeriod } from '../store/snapshotStore.js';
import { listJournal } from '../store/journalStore.js';
import { collectExceptions } from '../exceptions/collect.js';
import { getDisposition } from '../store/dispositionStore.js';
import { BLOCKING_CATEGORIES } from '../exceptions/types.js';
import { openMaterialReconBlockers } from '../reconciliation/collect.js';
import { listByStatus, listEvents } from '../store/eventStore.js';

export type LightStatus = 'green' | 'red' | 'derived' | 'mock';
export interface Light { key: string; status: LightStatus; label: string; real: boolean }
export interface CockpitView {
  lights: Light[]; status: PeriodStatus; anchored: boolean; staleAnchor: boolean;
  closeable: boolean; reopenCount: number; restatementReason: string | null; reasonCode: string | null;
}

interface JeLine { side: 'DEBIT' | 'CREDIT'; amountMinor: string }
interface Je { lines: JeLine[] }

function classificationLight(db: Db, entityId: string, periodId: string, lowConf: number): Light {
  const pending = listByStatus(db, entityId, 'NEEDS_REVIEW').length;
  const blocking = collectExceptions(db, entityId, periodId, lowConf)
    .filter((e) => BLOCKING_CATEGORIES.includes(e.category))
    .filter((e) => { const d = getDisposition(db, e.category, e.eventId); return d === null || d.state === 'open'; }).length;
  const green = pending === 0 && blocking === 0;
  return { key: 'classification', status: green ? 'green' : 'red', label: 'Classification', real: true };
}

function jeLight(db: Db, entityId: string): Light {
  const jes = listJournal(db, entityId);
  if (jes.length === 0) return { key: 'je', status: 'red', label: 'Journal entries', real: true };
  let tbDebit = 0n, tbCredit = 0n, perJeOk = true;
  for (const r of jes) {
    const je = JSON.parse(r.jeJson) as Je;
    let d = 0n, c = 0n;
    for (const l of je.lines) {
      const amt = BigInt(l.amountMinor);
      if (l.side === 'DEBIT') { d += amt; tbDebit += amt; } else { c += amt; tbCredit += amt; }
    }
    if (d !== c) perJeOk = false;
  }
  const green = perJeOk && tbDebit === tbCredit;
  return { key: 'je', status: green ? 'green' : 'red', label: 'Journal entries (TB tie-out)', real: true };
}

function reconLight(db: Db, entityId: string, periodId: string): Light {
  const blocking = openMaterialReconBlockers(db, entityId, periodId).length;
  return { key: 'recon', status: blocking === 0 ? 'green' : 'red', label: 'Reconciliation', real: true };
}

function completenessLight(db: Db, entityId: string): Light {
  const events = listEvents(db, entityId);
  const pendingIngest = listByStatus(db, entityId, 'INGESTED').length;
  // DERIVED: presence only — NOT a cutoff assurance (no period_id on events). Labeled honestly.
  const ok = events.length > 0 && pendingIngest === 0;
  return { key: 'completeness', status: ok ? 'green' : 'red', label: 'Ingest presence (no cutoff assurance)', real: false };
}

const MOCK = (key: string, label: string): Light => ({ key, status: 'mock', label, real: false });

export function buildCockpit(db: Db, entityId: string, periodId: string, lowConf: number): CockpitView {
  const lights: Light[] = [
    classificationLight(db, entityId, periodId, lowConf),
    jeLight(db, entityId),
    reconLight(db, entityId, periodId),
    completenessLight(db, entityId),
    MOCK('pricing', 'Pricing coverage'),
    MOCK('export', 'ERP export'),
  ];
  const lock = getPeriodLock(db, entityId, periodId);
  const anchored = hasAnchoredSnapshotForPeriod(db, entityId, periodId);
  // staleAnchor: was anchored then reopened with no subsequent re-anchor.
  const staleAnchor = lock.reopenCount > 0 && lock.wasAnchoredAtReopen === 1 && lock.status === 'OPEN';
  // closeable = every BLOCKING (real OR derived) light green; mock lights carry no signal.
  const blocking = lights.filter((l) => l.status !== 'mock');
  const closeable = blocking.every((l) => l.status === 'green' || l.status === 'derived' && false ? false : l.status === 'green');
  return {
    lights, status: lock.status, anchored, staleAnchor, closeable,
    reopenCount: lock.reopenCount, restatementReason: lock.restatementReason, reasonCode: lock.reasonCode,
  };
}
```

> Note on `closeable`: a `derived` light is treated as blocking and must be `green` to close. `completenessLight` returns `green`/`red` (the `derived`-ness is a UI label via `real:false`), so the simple `every(l => l.status === 'green')` over non-mock lights is correct. Simplify Step 3b's `closeable` line to:
> ```ts
> const closeable = lights.filter((l) => l.status !== 'mock').every((l) => l.status === 'green');
> ```

- [ ] **Step 3c: Apply the simplified `closeable` line** (replace the convoluted expression with the one in the note).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run src/periodLock/cockpit.test.ts`
Expected: PASS (4 tests). If `listByStatus`/`listEvents` signatures differ, check `services/api/src/store/eventStore.js` exports and adjust the status string constants (`'NEEDS_REVIEW'`, `'INGESTED'`, `'AUTO'`) to the actual enum used.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/store/snapshotStore.ts services/api/src/periodLock/cockpit.ts services/api/src/periodLock/cockpit.test.ts
git commit -m "feat(api): six-light cockpit aggregation + per-period anchored helper"
```

---

## Task 4: Endpoints + /snapshot LOCKED-gate + integration + Monkey

**Files:**
- Modify: `services/api/src/http/routes.ts`
- Test: `services/api/src/http/routes.periodLock.test.ts` (new), and a Monkey test `services/api/src/http/monkey.periodLock.test.ts` (new)

**Interfaces:**
- Consumes: everything from Tasks 1–3; existing `requireEntity`, `ApiError`, `DEFAULT_PERIOD`, `cfg.exceptionLowConfidence`, `deps.mutex`.
- Produces: `GET /entities/:id/close-cockpit`, `POST /entities/:id/period/lock`, `POST /entities/:id/period/reopen`; modified `POST /entities/:id/snapshot`.

- [ ] **Step 1: Write the failing integration + monkey tests**

Follow the existing harness in `services/api/src/http/*.test.ts` (build the Fastify app via the same factory those tests use; reuse their entity/event seeding helpers). Tests to add:

```ts
// routes.periodLock.test.ts — sketch (use the project's app-build helper, e.g. buildApp(db, deps))
// 1. GET /close-cockpit returns 6 lights + status OPEN for a fresh entity.
// 2. POST /period/lock with a red blocking light => 409 LIGHTS_NOT_GREEN.
// 3. Seed all blocking lights green, POST /period/lock => 200, status LOCKED, cockpit shows LOCKED.
//    WHY: lock must recompute server-side — a forged client body cannot flip a red light.
// 4. POST /entities/:id/snapshot while OPEN => 409 PERIOD_NOT_LOCKED.
// 5. After lock, POST /period/lock again => 409 ILLEGAL_TRANSITION.
// 6. POST /period/reopen with empty restatementReason => 400 VALIDATION.
// 7. POST /period/reopen with unknown reasonCode => 400 VALIDATION.
// 8. Lock then reopen (valid reason+code) => 200, status OPEN, reopenCount 1.
```

```ts
// monkey.periodLock.test.ts — extreme/adversarial
// M1. reopen on a never-locked period => 409 ILLEGAL_TRANSITION.
// M2. restatementReason of 600 chars => 400 VALIDATION (>512).
// M3. concurrent lock + reopen on the same period (Promise.all) — exactly one mutates,
//     the other 409s; final state is deterministic (not corrupted).
// M4. POST /period/lock with body { lights: {recon:'green'} } while recon is really red
//     => still 409 LIGHTS_NOT_GREEN (server ignores client lights).
// M5. re-freeze (POST /snapshot) after reopen WITHOUT re-lock => 409 PERIOD_NOT_LOCKED.
```

- [ ] **Step 2: Run to verify failure**

Run: `cd services/api && npx vitest run src/http/routes.periodLock.test.ts src/http/monkey.periodLock.test.ts`
Expected: FAIL — routes not registered.

- [ ] **Step 3a: Add imports + endpoints in routes.ts**

Add near the other imports:

```ts
import { REOPEN_REASON_CODES, type ReopenReasonCode } from '../periodLock/state.js';
import { getPeriodLock, lockPeriod, reopenPeriod } from '../periodLock/store.js';
import { buildCockpit } from '../periodLock/cockpit.js';
import { hasAnchoredSnapshotForPeriod } from '../store/snapshotStore.js';
```

Register the three endpoints (place them after the `close-readiness` route):

```ts
const LOCKED_BY = 'demo-controller'; // server-const until auth (spec §9 SoD blocking-for-production)

app.get<{ Params: { id: string }; Querystring: { periodId?: string } }>('/entities/:id/close-cockpit', async (req) => {
  requireEntity(db, req.params.id);
  const periodId = req.query.periodId ?? DEFAULT_PERIOD;
  return buildCockpit(db, req.params.id, periodId, cfg.exceptionLowConfidence);
});

app.post<{ Params: { id: string }; Body: { periodId?: string } }>('/entities/:id/period/lock', async (req) => {
  requireEntity(db, req.params.id);
  const periodId = req.body?.periodId ?? DEFAULT_PERIOD;
  // Recompute server-side — NEVER trust client-sent lights.
  const view = buildCockpit(db, req.params.id, periodId, cfg.exceptionLowConfidence);
  if (!view.closeable) {
    const reds = view.lights.filter((l) => l.status !== 'mock' && l.status !== 'green').map((l) => l.key);
    throw new ApiError(409, 'LIGHTS_NOT_GREEN', `blocking lights not green: ${reds.join(', ')}`);
  }
  try {
    const row = lockPeriod(db, { entityId: req.params.id, periodId, lightsSnapshot: JSON.stringify(view.lights), lockedBy: LOCKED_BY, now: Date.now() });
    return { lock: row };
  } catch (err) {
    if ((err as Error).message.startsWith('ILLEGAL_TRANSITION')) throw new ApiError(409, 'ILLEGAL_TRANSITION', (err as Error).message);
    throw err;
  }
});

app.post<{ Params: { id: string }; Body: { periodId?: string; restatementReason?: string; reasonCode?: string; affectedAmountEstimate?: string } }>('/entities/:id/period/reopen', async (req) => {
  requireEntity(db, req.params.id);
  const periodId = req.body?.periodId ?? DEFAULT_PERIOD;
  const reason = (req.body?.restatementReason ?? '').trim();
  if (!reason) throw new ApiError(400, 'VALIDATION', 'restatementReason required');
  if (reason.length > 512) throw new ApiError(400, 'VALIDATION', 'restatementReason exceeds 512 chars');
  if (!req.body?.reasonCode || !REOPEN_REASON_CODES.includes(req.body.reasonCode as ReopenReasonCode)) {
    throw new ApiError(400, 'VALIDATION', `unknown reasonCode ${req.body?.reasonCode}`);
  }
  const wasAnchored = hasAnchoredSnapshotForPeriod(db, req.params.id, periodId);
  try {
    const row = reopenPeriod(db, {
      entityId: req.params.id, periodId, restatementReason: reason, reasonCode: req.body.reasonCode as ReopenReasonCode,
      affectedAmountEstimate: req.body.affectedAmountEstimate ?? null, wasAnchored,
      requestedBy: LOCKED_BY, approvedBy: LOCKED_BY, now: Date.now(),
    });
    return { lock: row };
  } catch (err) {
    if ((err as Error).message.startsWith('ILLEGAL_TRANSITION')) throw new ApiError(409, 'ILLEGAL_TRANSITION', (err as Error).message);
    throw err;
  }
});
```

- [ ] **Step 3b: Add the LOCKED-gate inside the /snapshot mutex**

In the existing `POST /entities/:id/snapshot` handler, the body runs inside `deps.mutex.run(req.params.id, async () => {...})`. **Inside that callback, before the close-gate/build**, add:

```ts
const lock = getPeriodLock(db, req.params.id, periodId);
if (lock.status !== 'LOCKED') {
  throw new ApiError(409, 'PERIOD_NOT_LOCKED', 'lock the period before anchoring');
}
```

(If the current handler does not yet wrap its work in `deps.mutex.run`, wrap the existing freeze/build/insert body in it now so this read is consistent with the snapshot insert — architect I3.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && npx vitest run src/http/routes.periodLock.test.ts src/http/monkey.periodLock.test.ts && npx tsc --noEmit`
Expected: PASS (8 + 5), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/http/routes.ts services/api/src/http/routes.periodLock.test.ts services/api/src/http/monkey.periodLock.test.ts
git commit -m "feat(api): close-cockpit/lock/reopen endpoints + /snapshot LOCKED-gate-in-mutex + monkey"
```

---

## Task 5: Frontend cockpit data hook

**Files:**
- Modify: `web/src/api/types.ts` (add DTO types)
- Create: `web/src/hooks/useCloseCockpit.ts`
- Test: `web/src/hooks/useCloseCockpit.test.tsx`

**Interfaces:**
- Produces: `CloseCockpitResponse` type; `useCloseCockpit(entityId): { data?, loading, error?, refetch }` (mirror `useReconciliation` incl. the `genRef` stale-request guard).

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/hooks/useCloseCockpit.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCloseCockpit } from './useCloseCockpit';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ lights: [{ key: 'je', status: 'green', label: 'JE', real: true }], status: 'OPEN', anchored: false, staleAnchor: false, closeable: false, reopenCount: 0, restatementReason: null, reasonCode: null }),
  })) as unknown as typeof fetch);
});

it('fetches cockpit for an entity', async () => {
  const { result } = renderHook(() => useCloseCockpit('e1'));
  await waitFor(() => expect(result.current.data?.status).toBe('OPEN'));
  expect(result.current.data?.lights[0].key).toBe('je');
});

it('does not fetch when entityId is null', () => {
  renderHook(() => useCloseCockpit(null));
  expect(fetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/hooks/useCloseCockpit.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3a: Add types to web/src/api/types.ts**

```ts
export type LightStatus = 'green' | 'red' | 'derived' | 'mock';
export interface CockpitLight { key: string; status: LightStatus; label: string; real: boolean }
export interface CloseCockpitResponse {
  lights: CockpitLight[];
  status: 'OPEN' | 'LOCKED';
  anchored: boolean; staleAnchor: boolean; closeable: boolean;
  reopenCount: number; restatementReason: string | null; reasonCode: string | null;
}
```

- [ ] **Step 3b: Write the hook** (copy `useReconciliation` structure verbatim, swap the URL + type):

```ts
// web/src/hooks/useCloseCockpit.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloseCockpitResponse } from '../api/types';
import { API_BASE } from '../api/client';

export function useCloseCockpit(entityId: string | null) {
  const [data, setData] = useState<CloseCockpitResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const genRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!entityId) return;
    const gen = ++genRef.current;
    setLoading(true); setError(undefined);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/close-cockpit`);
      if (!res.ok) throw new Error(`close-cockpit ${res.status}`);
      const json = await res.json() as CloseCockpitResponse;
      if (gen === genRef.current) setData(json);
    } catch (e) {
      if (gen === genRef.current) setError((e as Error).message);
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/hooks/useCloseCockpit.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/hooks/useCloseCockpit.ts web/src/hooks/useCloseCockpit.test.tsx
git commit -m "feat(web): useCloseCockpit hook + cockpit DTO types"
```

---

## Task 6: LightCard — four states, severity sort, dispatch

**Files:**
- Create: `web/src/workspaces/close/LightCard.tsx`, `web/src/workspaces/close/lightMeta.ts`, `web/src/workspaces/close/close.css`
- Test: `web/src/workspaces/close/LightCard.test.tsx`

**Interfaces:**
- Consumes: `CockpitLight`, `LightStatus` from `../../api/types`.
- Produces:
  - `lightMeta.ts`: `LIGHT_META: Record<LightStatus, { glyph: string; word: string; cls: string }>`; `severityRank(status): number` (red=0, derived=1, mock=2, green=3); `sortLights(lights): CockpitLight[]`; `dispatchTarget(key): WorkspaceId | StepId | null`.
  - `LightCard.tsx`: `function LightCard({ light, onDispatch }: { light: CockpitLight; onDispatch: (key: string) => void })`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/workspaces/close/LightCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LightCard } from './LightCard';
import { sortLights, LIGHT_META } from './lightMeta';
import type { CockpitLight } from '../../api/types';

const L = (key: string, status: CockpitLight['status']): CockpitLight => ({ key, status, label: key, real: status !== 'mock' });

it('renders glyph + word (not color-only)', () => {
  render(<LightCard light={L('recon', 'red')} onDispatch={() => {}} />);
  // WHY: red must be legible without color — assert the textual word + glyph are present.
  expect(screen.getByText(LIGHT_META.red.word)).toBeInTheDocument();
  expect(screen.getByText(LIGHT_META.red.glyph)).toBeInTheDocument();
});

it('mock light shows the not-wired word and never the green word', () => {
  render(<LightCard light={L('pricing', 'mock')} onDispatch={() => {}} />);
  expect(screen.getByText(LIGHT_META.mock.word)).toBeInTheDocument();
  expect(screen.queryByText(LIGHT_META.green.word)).not.toBeInTheDocument();
});

it('sortLights orders red -> derived -> mock -> green', () => {
  const sorted = sortLights([L('a', 'green'), L('b', 'mock'), L('c', 'red'), L('d', 'derived')]);
  expect(sorted.map((l) => l.status)).toEqual(['red', 'derived', 'mock', 'green']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/workspaces/close/LightCard.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3a: lightMeta.ts**

```ts
// web/src/workspaces/close/lightMeta.ts
import type { CockpitLight, LightStatus } from '../../api/types';
import type { WorkspaceId } from '../../app/workspaces';
import type { StepId } from '../../app/steps';

export const LIGHT_META: Record<LightStatus, { glyph: string; word: string; cls: string }> = {
  green:   { glyph: '✓', word: 'Ready',           cls: 'light--green' },
  red:     { glyph: '!', word: 'Blocking',        cls: 'light--red' },
  derived: { glyph: '≈', word: 'Derived',         cls: 'light--derived' },
  mock:    { glyph: '◌', word: '未接真訊號',       cls: 'light--mock' },
};

const RANK: Record<LightStatus, number> = { red: 0, derived: 1, mock: 2, green: 3 };
export function severityRank(s: LightStatus): number { return RANK[s]; }
export function sortLights(lights: CockpitLight[]): CockpitLight[] {
  return [...lights].sort((a, b) => RANK[a.status] - RANK[b.status]);
}

// Where a non-green real light sends the user. Returns a workspace id or a close-flow step id.
export function dispatchTarget(key: string): WorkspaceId | StepId | null {
  switch (key) {
    case 'recon': return 'reconciliation';
    case 'classification': return 'review';
    case 'je': return 'journal';
    case 'completeness': return 'ingest';
    default: return null; // pricing/export are mock — nowhere to go yet
  }
}
```

- [ ] **Step 3b: LightCard.tsx**

```tsx
// web/src/workspaces/close/LightCard.tsx
import type { CockpitLight } from '../../api/types';
import { LIGHT_META, dispatchTarget } from './lightMeta';
import './close.css';

export function LightCard({ light, onDispatch }: { light: CockpitLight; onDispatch: (key: string) => void }) {
  const meta = LIGHT_META[light.status];
  const actionable = light.status === 'red' && dispatchTarget(light.key) !== null;
  return (
    <div className={`light-card ${meta.cls}`} role="group" aria-label={`${light.label}: ${meta.word}`}>
      <div className="light-card__head">
        <span className="light-card__glyph" aria-hidden="true">{meta.glyph}</span>
        <span className="light-card__word">{meta.word}</span>
      </div>
      <div className="light-card__label">{light.label}</div>
      {actionable && (
        <button type="button" className="light-card__cta" onClick={() => onDispatch(light.key)}>
          Resolve →
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3c: close.css** (uses aliases + state tokens; NO `--aqua`)

```css
/* web/src/workspaces/close/close.css */
.lights-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--s-3, 12px); }
.light-card { padding: var(--s-3, 12px); border: 1px solid var(--line, #e0d9cc); border-radius: var(--r-md, 12px); background: var(--paper-card, #fbf7ee); box-shadow: var(--shadow-md, 0 1px 3px rgba(0,0,0,.08)); }
.light-card__head { display: flex; align-items: center; gap: var(--s-2, 8px); font-weight: 700; }
.light-card__glyph { font-size: 1.1em; }
.light-card__label { color: var(--ink-soft, #8a8175); font-size: .9em; margin-top: var(--s-1, 4px); }
.light-card__cta { margin-top: var(--s-2, 8px); }
.light--green  { color: var(--credit, #2f7a5a); }
.light--red    { color: var(--debit, #b5532e); box-shadow: inset 3px 0 var(--debit, #b5532e), var(--shadow-md, 0 1px 3px rgba(0,0,0,.08)); }
.light--derived{ color: var(--warn, #c28a1e); }
.light--mock   { color: var(--ink-soft, #8a8175); border-style: dashed; }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/workspaces/close/LightCard.test.tsx`
Expected: PASS (3 tests). (If `WorkspaceId`/`StepId` import paths differ, fix to the actual export locations — `app/workspaces.ts` exports `WorkspaceId`; `app/steps.ts` exports `StepId`.)

- [ ] **Step 5: Commit**

```bash
git add web/src/workspaces/close/LightCard.tsx web/src/workspaces/close/lightMeta.ts web/src/workspaces/close/close.css web/src/workspaces/close/LightCard.test.tsx
git commit -m "feat(web): LightCard four-state encoding + severity sort + dispatch targets"
```

---

## Task 7: CloseCockpit — ribbon + grid + RWD

**Files:**
- Create: `web/src/workspaces/close/CloseCockpit.tsx`
- Modify: `web/src/workspaces/close/close.css` (ribbon + RWD)
- Test: `web/src/workspaces/close/CloseCockpit.test.tsx`

**Interfaces:**
- Consumes: `useCloseCockpit` (Task 5), `LightCard`/`sortLights` (Task 6), `useWorkspace().setWorkspace` + `useEntityCtx().setStep` for dispatch.
- Produces: `function CloseCockpit({ entityId }: { entityId: string })`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/workspaces/close/CloseCockpit.test.tsx — mock the hook
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CloseCockpit } from './CloseCockpit';

vi.mock('../../hooks/useCloseCockpit', () => ({
  useCloseCockpit: () => ({
    data: { lights: [
      { key: 'recon', status: 'red', label: 'Reconciliation', real: true },
      { key: 'je', status: 'green', label: 'JE', real: true },
    ], status: 'OPEN', anchored: false, staleAnchor: false, closeable: false, reopenCount: 0, restatementReason: null, reasonCode: null },
    loading: false, error: undefined, refetch: vi.fn(),
  }),
}));
vi.mock('../../app/WorkspaceContext', () => ({ useWorkspace: () => ({ setWorkspace: vi.fn() }) }));
vi.mock('../../app/EntityContext', () => ({ useEntityCtx: () => ({ setStep: vi.fn() }) }));

it('shows an aria-live verdict counting blocking lights', () => {
  render(<CloseCockpit entityId="e1" />);
  // WHY: the verdict must be reachable without scanning six cards (a11y + glanceability).
  expect(screen.getByRole('status')).toHaveTextContent(/1 light/i);
});

it('renders the period status chip', () => {
  render(<CloseCockpit entityId="e1" />);
  expect(screen.getByText('OPEN')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/workspaces/close/CloseCockpit.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3a: CloseCockpit.tsx**

```tsx
// web/src/workspaces/close/CloseCockpit.tsx
import { useCloseCockpit } from '../../hooks/useCloseCockpit';
import { useWorkspace } from '../../app/WorkspaceContext';
import { useEntityCtx } from '../../app/EntityContext';
import { isWorkspaceId } from '../../app/workspaces';
import { LightCard } from './LightCard';
import { sortLights, dispatchTarget } from './lightMeta';
import './close.css';

export function CloseCockpit({ entityId }: { entityId: string }) {
  const { data, loading } = useCloseCockpit(entityId);
  const { setWorkspace } = useWorkspace();
  const { setStep } = useEntityCtx();

  if (loading && !data) return <p>Loading close cockpit…</p>;
  if (!data) return <p>No cockpit data.</p>;

  const blockingReds = data.lights.filter((l) => l.status === 'red').length;
  const verdict = data.closeable ? 'All controls ready to lock.' : `${blockingReds} light${blockingReds === 1 ? '' : 's'} blocking close.`;

  const onDispatch = (key: string) => {
    const target = dispatchTarget(key);
    if (!target) return;
    if (isWorkspaceId(target)) setWorkspace(target);
    else setStep(target);
  };

  return (
    <div className="close-cockpit">
      <div className={`period-ribbon ${data.status === 'LOCKED' ? 'period-ribbon--locked' : ''}`}>
        <span className={`status-chip status-chip--${data.status.toLowerCase()}`}>{data.status}</span>
        {data.reopenCount > 0 && <span className="reopen-badge">reopened ×{data.reopenCount}</span>}
        {data.staleAnchor && <span className="stale-anchor-warn" role="alert">⚠ stale anchor — re-lock & re-anchor</span>}
      </div>
      <p role="status" aria-live="polite" className="cockpit-verdict">{verdict}</p>
      <div className="lights-grid">
        {sortLights(data.lights).map((l) => <LightCard key={l.key} light={l} onDispatch={onDispatch} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 3b: Append ribbon + RWD css to close.css**

```css
.close-cockpit { display: flex; flex-direction: column; gap: var(--s-4, 16px); }
.period-ribbon { display: flex; align-items: center; gap: var(--s-3, 12px); padding: var(--s-3, 12px); border-radius: var(--r-md, 12px); background: var(--paper-card, #fbf7ee); transition: background 140ms; }
.period-ribbon--locked { background: var(--ink, #1d2733); color: var(--paper, #f4ecd8); }
.status-chip { padding: 2px 10px; border-radius: var(--r-pill, 999px); font-weight: 700; }
.status-chip--open { background: var(--brass, #b08d57); color: #fff; }
.status-chip--locked { background: var(--ink, #1d2733); color: var(--paper, #f4ecd8); border: 1px solid var(--brass, #b08d57); }
.reopen-badge { color: var(--ink-soft, #8a8175); font-size: .85em; }
.stale-anchor-warn { color: var(--warn, #c28a1e); font-weight: 600; }
.cockpit-verdict { font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .period-ribbon { transition: none; } }
@media (max-width: 640px) {
  .lights-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/workspaces/close/CloseCockpit.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/workspaces/close/CloseCockpit.tsx web/src/workspaces/close/close.css web/src/workspaces/close/CloseCockpit.test.tsx
git commit -m "feat(web): CloseCockpit landing — status ribbon, aria-live verdict, severity grid, RWD"
```

---

## Task 8: LockPanel (blocker naming + ink signature) + ReopenDialog (two-step ritual)

**Files:**
- Create: `web/src/workspaces/close/LockPanel.tsx`, `web/src/workspaces/close/ReopenDialog.tsx`
- Modify: `web/src/workspaces/close/close.css`, `web/src/workspaces/close/CloseCockpit.tsx` (wire panel + dialog), `web/src/api/client.ts` (only if a POST helper doesn't already exist — otherwise reuse)
- Test: `web/src/workspaces/close/LockPanel.test.tsx`, `web/src/workspaces/close/ReopenDialog.test.tsx`

**Interfaces:**
- Consumes: `CloseCockpitResponse`, `REOPEN_REASON_CODES` (re-declare in `web/src/api/types.ts` as a const array — see Step 3a), a refetch callback.
- Produces:
  - `LockPanel({ data, entityId, onChanged })` — Lock button (enabled iff `data.closeable && data.status==='OPEN'`); disabled state renders `role="status"` listing blocking light keys as dispatch buttons.
  - `ReopenDialog({ entityId, onChanged, onClose })` — two-step maker→checker dialog; top `mock-until-auth` ribbon; step 2 disabled until reason non-empty.

- [ ] **Step 1: Write the failing tests**

```tsx
// LockPanel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LockPanel } from './LockPanel';
const base = { lights: [{ key: 'recon', status: 'red', label: 'Reconciliation', real: true }], status: 'OPEN', anchored: false, staleAnchor: false, closeable: false, reopenCount: 0, restatementReason: null, reasonCode: null } as const;

it('disables Lock and NAMES the blocker (not a tooltip)', () => {
  render(<LockPanel data={base} entityId="e1" onChanged={vi.fn()} />);
  expect(screen.getByRole('button', { name: /lock/i })).toBeDisabled();
  // WHY: blocker must be visible inline on touch — assert the name is in a status region.
  expect(screen.getByRole('status')).toHaveTextContent(/recon/i);
});

it('enables Lock when closeable and OPEN', () => {
  render(<LockPanel data={{ ...base, lights: [], closeable: true }} entityId="e1" onChanged={vi.fn()} />);
  expect(screen.getByRole('button', { name: /lock/i })).toBeEnabled();
});
```

```tsx
// ReopenDialog.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReopenDialog } from './ReopenDialog';

it('shows mock-until-auth ribbon at top and gates step 2 on reason', () => {
  render(<ReopenDialog entityId="e1" onChanged={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByText(/mock-until-auth/i)).toBeInTheDocument();
  // WHY: SoD ritual must FEEL gated even while mocked — approve disabled until reason typed.
  expect(screen.getByRole('button', { name: /approve & reopen/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/workspaces/close/LockPanel.test.tsx src/workspaces/close/ReopenDialog.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3a: Add reason codes to web/src/api/types.ts**

```ts
// Mirror of services/api/src/periodLock/state.ts REOPEN_REASON_CODES (keep in sync).
export const REOPEN_REASON_CODES = ['ERROR_CORRECTION', 'ESTIMATE_CHANGE', 'LATE_ARRIVING_TXN', 'RECLASSIFICATION', 'OTHER'] as const;
export type ReopenReasonCode = (typeof REOPEN_REASON_CODES)[number];
```

- [ ] **Step 3b: LockPanel.tsx**

```tsx
// web/src/workspaces/close/LockPanel.tsx
import { useState } from 'react';
import type { CloseCockpitResponse } from '../../api/types';
import { API_BASE } from '../../api/client';
import './close.css';

export function LockPanel({ data, entityId, onChanged }: { data: CloseCockpitResponse; entityId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const blockers = data.lights.filter((l) => l.status === 'red').map((l) => l.key);
  const canLock = data.closeable && data.status === 'OPEN';

  const lock = async () => {
    setBusy(true); setErr(undefined);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/period/lock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error(`lock ${res.status}`);
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="lock-panel">
      <button type="button" className="btn-primary" disabled={!canLock || busy} onClick={lock}>
        {data.status === 'LOCKED' ? 'Period locked' : 'Lock the period'}
      </button>
      {!canLock && data.status === 'OPEN' && (
        <p role="status" className="lock-blockers">Locked out by: {blockers.join(', ') || '—'}</p>
      )}
      {err && <p className="lock-err" role="alert">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 3c: ReopenDialog.tsx**

```tsx
// web/src/workspaces/close/ReopenDialog.tsx
import { useState } from 'react';
import { REOPEN_REASON_CODES, type ReopenReasonCode } from '../../api/types';
import { API_BASE } from '../../api/client';
import './close.css';

export function ReopenDialog({ entityId, onChanged, onClose }: { entityId: string; onChanged: () => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [code, setCode] = useState<ReopenReasonCode>('ERROR_CORRECTION');
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const reasonOk = reason.trim().length > 0;

  const approve = async () => {
    setBusy(true); setErr(undefined);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/period/reopen`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restatementReason: reason.trim(), reasonCode: code }),
      });
      if (!res.ok) throw new Error(`reopen ${res.status}`);
      onChanged(); onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="reopen-dialog" role="dialog" aria-label="Reopen period">
      <div className="reopen-ribbon">⚠ mock-until-auth — SoD (maker≠checker) is UI-only until an identity system lands</div>
      <ol className="reopen-steps">
        <li className={requested ? 'step--done' : 'step--active'}>
          <strong>1 · Request</strong>
          <label>Reason code
            <select value={code} onChange={(e) => setCode(e.target.value as ReopenReasonCode)}>
              {REOPEN_REASON_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <textarea placeholder="Restatement reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={512} />
          <button type="button" disabled={!reasonOk} onClick={() => setRequested(true)}>Request reopen</button>
        </li>
        <li className={requested ? 'step--active' : 'step--idle'}>
          <strong>2 · Approve</strong>
          <button type="button" className="btn-primary" disabled={!requested || !reasonOk || busy} onClick={approve}>Approve & reopen</button>
        </li>
      </ol>
      {err && <p role="alert" className="lock-err">{err}</p>}
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  );
}
```

- [ ] **Step 3d: Wire into CloseCockpit + add css**

In `CloseCockpit.tsx`: import `LockPanel`/`ReopenDialog`, get `refetch` from the hook, render `<LockPanel data={data} entityId={entityId} onChanged={refetch} />` below the grid, and a "Reopen…" button shown only when `data.status === 'LOCKED'` that toggles a `useState` to render `<ReopenDialog … onChanged={refetch} onClose={…} />`. Add to `close.css`:

```css
.lock-panel { position: sticky; bottom: 0; background: var(--paper, #f4ecd8); padding: var(--s-3, 12px) 0; }
.lock-blockers { color: var(--debit, #b5532e); font-weight: 600; }
.lock-err { color: var(--debit, #b5532e); }
.reopen-ribbon { background: color-mix(in srgb, var(--warn, #c28a1e) 14%, transparent); color: var(--warn, #c28a1e); padding: var(--s-2, 8px) var(--s-3, 12px); border-radius: var(--r-md, 12px); margin-bottom: var(--s-3, 12px); }
.reopen-steps { list-style: none; padding: 0; display: flex; flex-direction: column; gap: var(--s-3, 12px); }
.step--idle { opacity: .5; }
@media (max-width: 640px) { .reopen-steps { gap: var(--s-2, 8px); } }
```

- [ ] **Step 4: Run to verify pass + build**

Run: `cd web && npx vitest run src/workspaces/close/ && npm run build`
Expected: PASS (all close tests), build exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/workspaces/close/ web/src/api/types.ts
git commit -m "feat(web): LockPanel (inline blocker naming) + ReopenDialog (two-step SoD ritual + mock-until-auth)"
```

---

## Task 9: Wire `close` workspace landing to CloseCockpit

**Files:**
- Modify: `web/src/App.tsx` (CloseWorkspace renders CloseCockpit; StepRail secondary)
- Test: `web/src/App.test.tsx` (or the existing App/shell test) — add a render assertion

**Interfaces:**
- Consumes: `CloseCockpit` (Task 7), existing `useEntityCtx().entity`.

- [ ] **Step 1: Write the failing test**

Add to the existing shell/App test (or create `web/src/App.cockpit.test.tsx`) a case asserting that with `activeWorkspace==='close'` the cockpit verdict (`role="status"`) renders and the 5 step components are NOT all mounted at once. Sketch:

```tsx
// WHY: the close landing is now the cockpit, not the linear step flow; StepRail is secondary.
it('close workspace renders the cockpit verdict', async () => {
  // render the App shell with a seeded entity + mocked fetch returning a cockpit payload
  // expect screen.getByRole('status') to be present (cockpit verdict)
});
```

(Match the existing App test's provider/mocking setup — reuse its `renderApp()` helper if present.)

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/App.cockpit.test.tsx`
Expected: FAIL — cockpit not wired.

- [ ] **Step 3: Modify CloseWorkspace in App.tsx**

```tsx
import { CloseCockpit } from './workspaces/close/CloseCockpit';

function CloseWorkspace() {
  const { step, entity } = useEntityCtx();
  return (
    <>
      <CloseCockpit entityId={entity?.id ?? ''} />
      {/* StepRail + steps are now SECONDARY — the cockpit is the primary landing. */}
      <details className="close-steps-secondary" style={{ marginTop: 'var(--space-6)' }}>
        <summary>Step-by-step close flow</summary>
        <StepRail current={step} />
        <section data-step={step}>
          {step === 'ingest' && <IngestStep />}
          {step === 'classify' && <ClassifyStep />}
          {step === 'review' && <ReviewStep />}
          {step === 'journal' && <JournalStep />}
          {step === 'anchor' && <AnchorStep />}
        </section>
      </details>
    </>
  );
}
```

(If `useEntityCtx()` doesn't expose `entity`, read it the same way `WorkspaceContent` does — `const { entity } = useEntityCtx()` at the call site and pass `entityId` as a prop.)

- [ ] **Step 4: Run tests + full suite + build**

Run: `cd web && npx vitest run && npm run build`
Expected: all PASS, build exit 0. Then backend regression: `cd services/api && npm test && npx tsc --noEmit` — all green.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/App.cockpit.test.tsx
git commit -m "feat(web): wire close workspace landing to Period Close Cockpit; StepRail secondary"
```

---

## Self-Review

**Spec coverage:**
- §2 state machine → Tasks 1,2,4. §3 six lights (incl. JE TB tie-out, completeness relabel, mock-not-green) → Task 3. §4 backend components + endpoints + LOCKED-gate-in-mutex → Tasks 2,3,4. §4 schema columns (reasonCode/affectedAmount/wasAnchored/lightsSnapshot/lockedBy) → Task 2. §5 frontend (LightCard 4-state, severity grid, LockPanel inline blocker, ReopenDialog two-step + top ribbon, RWD 1024/640, ink signature) → Tasks 6,7,8. §6 dataflow → Tasks 5–9. §7 error codes → Task 4. §8 testing incl. Monkey → every backend task + Task 4 monkey file. §9 deferred → documented in spec, no task (correct). §10 adjudication (restatement re-anchor descoped) → no task; staleAnchor surfaced in Task 3/7.
- **Gap check:** Lock signature "ink transition" → Task 7 css (`.period-ribbon--locked` + `transition:background 140ms` + reduced-motion). Brass-seal glyph / Lock-zone-mascot-free → covered by NOT adding a mascot (no task needed; absence is the requirement). StepRail secondary → Task 9.

**Placeholder scan:** No TBD/TODO. Every code step has full code. Test sketches in Tasks 4 & 9 reference the project's existing app-build/render helpers rather than inlining a full harness — flagged explicitly because those helpers already exist and must be reused (DRY); the implementer must open the neighbouring `*.test.ts(x)` to copy the setup.

**Type consistency:** `PeriodStatus`/`PeriodAction`/`ReopenReasonCode` defined Task 1, used Tasks 2–4. `PeriodLockRow` defined Task 2, consumed Task 3 (`getPeriodLock`). `Light`/`LightStatus`/`CockpitView` defined Task 3, mirrored as `CockpitLight`/`CloseCockpitResponse` in Task 5, consumed Tasks 6–8. `dispatchTarget` returns `WorkspaceId|StepId|null` (Task 6) consumed via `isWorkspaceId` guard in Task 7. `REOPEN_REASON_CODES` defined backend Task 1, mirrored frontend Task 8 (sync note added).

**Known verification points for the implementer** (do-if-readable, fix to actual signatures): `eventStore` status enum strings (`'NEEDS_REVIEW'`/`'INGESTED'`/`'AUTO'`) and `listByStatus`/`listEvents` signatures (Task 3); whether `/snapshot` already wraps its body in `deps.mutex.run` (Task 4 Step 3b); the existing App test's render helper name (Task 9).
