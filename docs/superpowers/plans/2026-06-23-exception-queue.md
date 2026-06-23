# Exception Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `exceptions` workspace — a standalone triage surface that aggregates the entity's pending accounting exceptions (3 categories), lets a human disposition each via a fail-closed state machine, and hard-blocks the period freeze when open blocking exceptions remain.

**Architecture:** Backend adds a pure read-aggregator (`collectExceptions`, recompute-on-read, no persistence) + an isolated disposition overlay store (never touches `journalStore`) + a close gate on `/snapshot`. Frontend adds a master-detail workspace reusing existing `ConfidenceBar`/`CopilotDock`/`DecideForm`/`EmptyState`. No change to `decide`/`run-rules`/`copilot`/`anchor`.

**Tech Stack:** Fastify + better-sqlite3 (services/api), Vite + React + @mysten/dapp-kit-react (web), vitest both sides.

## Global Constraints (verbatim from spec)

- **AI zero posting authority unchanged**: disposition module imports nothing from `journalStore`. JE written only by human `decide` → `run-rules`.
- **disposition excluded from anchoring**: never an input to snapshot manifest hash or merkle root (sui-architect F1).
- **RULES_FAILED scoped to non-POSTED events only** (sui-architect F2a).
- **`evaluate()` in `collectExceptions` is read-only** — a GET must never mutate state (sui-architect F2b); import the *same* `evaluate` `run-rules` uses (single source of skip reasons).
- **Disposition table PK = `(category, event_id)`** — never `event_id` alone (sui-architect F3).
- **exceptionId = `${category}:${eventId}`**, re-validated against live `collectExceptions` on every disposition (reject forged/stale).
- **Two-axis visual encoding** (frontend F3): category = icon + text label (never color-only); severity = position + weight + one rare alarm hue. Colorblind-safe age-stamps in mono.
- **Anchored-period read-only** (sui-architect F4): if the entity has any ANCHORED snapshot, disposition controls render read-only.
- **mascot §8.4**: no mascot in DATA ZONE (payload + DecideForm); mascot allowed in suggestion zone (CopilotDock) and the celebratory empty state only.
- Existing tokens (`--space-N`/`--radius-*`/`--paper-card`/`--paper-line`/`--ink-soft`), `.btn-primary` brass pill, navy-brass-cream — reuse, don't redefine.
- Run `npm run build` (not just `tsc --noEmit`) for web tasks.
- Categories: `CLASSIFY_REVIEW`, `LOW_CONFIDENCE_AUTO`, `RULES_FAILED`. States: `open`/`resolved`/`dismissed`/`deferred`. Reason codes: `MAPPING_ADDED`,`RECLASSIFIED`,`DUPLICATE_CONFIRMED`,`IMMATERIAL_WAIVED`,`PENDING_DOC`,`CARRIED_FORWARD`,`OTHER`.
- Blocking categories for the close gate: `RULES_FAILED`, `CLASSIFY_REVIEW`. `LOW_CONFIDENCE_AUTO` is advisory (non-blocking).
- Default period id (matches frontend PeriodPill): `2026-Q2`.

## File Structure

| file | responsibility |
|---|---|
| `services/api/src/exceptions/types.ts` | `ExceptionCategory`, `Exception`, `ExceptionDTO`, `DispositionState`, `ReasonCode`, severity rank |
| `services/api/src/exceptions/collect.ts` | `collectExceptions(db, entityId, periodId)` pure read-aggregator |
| `services/api/src/exceptions/disposition.ts` | transition table + `applyDisposition()` (writes row + append log) — no journalStore import |
| `services/api/src/store/dispositionStore.ts` | SQLite CRUD for `exception_disposition` + `_log` |
| `services/api/src/store/snapshotStore.ts` | add `hasAnchoredSnapshot(db, entityId)` |
| `services/api/src/store/schema.sql` | add 2 tables |
| `services/api/src/config.ts` | add optional `exceptionLowConfidence` (default 0.85) |
| `services/api/src/http/routes.ts` | add 3 endpoints + close gate on `/snapshot` |
| `web/src/api/types.ts` / `hooks.ts` | exception + disposition DTOs/hooks |
| `web/src/app/workspaces.ts` | flip `exceptions` → `ready` |
| `web/src/workspaces/ExceptionsWorkspace.tsx` | master-detail shell |
| `web/src/components/data/ExceptionList.tsx` | left worklist |
| `web/src/components/data/ExceptionDetail.tsx` | right detail |
| `web/src/components/data/DispositionControls.tsx` | segmented state machine + dismiss ceremony |
| `web/src/components/data/EmptyState.tsx` | add celebratory variant |

---

### Task 1: Exception aggregator (`collectExceptions`) + types + config

**Files:**
- Create: `services/api/src/exceptions/types.ts`
- Create: `services/api/src/exceptions/collect.ts`
- Modify: `services/api/src/config.ts`
- Test: `services/api/test/exceptions.collect.test.ts`

**Interfaces:**
- Consumes: `EventRow`, `listEvents`, `listByStatus` from `store/eventStore.js`; `evaluate`, `buildRuleInput` (same as `run-rules`); `getEvent`.
- Produces:
  - `type ExceptionCategory = 'RULES_FAILED' | 'CLASSIFY_REVIEW' | 'LOW_CONFIDENCE_AUTO'`
  - `interface Exception { exceptionId: string; category: ExceptionCategory; eventId: string; severity: number; reason: string; amount: string | null; ai: { eventType: string|null; purpose: string|null; confidence: number|null; reasoning: string|null } | null }`
  - `function collectExceptions(db: Db, entityId: string, periodId: string): Exception[]` (sorted: severity desc, then confidence asc)
  - `function severityRank(c: ExceptionCategory): number` (RULES_FAILED=3, CLASSIFY_REVIEW=2, LOW_CONFIDENCE_AUTO=1)

- [ ] **Step 1: Add config field**

In `services/api/src/config.ts`, add to `ApiConfig` interface after `aiConfidenceThreshold: number;`:
```ts
  /** AUTO events with confidence below this comfort band surface as LOW_CONFIDENCE_AUTO exceptions. Optional; defaults to 0.85. Must be > aiConfidenceThreshold to be meaningful. */
  exceptionLowConfidence: number;
```
In `loadConfig`, before the `return {`:
```ts
  const exLowRaw = env['EXCEPTION_LOW_CONFIDENCE'];
  const exceptionLowConfidence = exLowRaw === undefined || exLowRaw === '' ? 0.85 : Number(exLowRaw);
  if (!Number.isFinite(exceptionLowConfidence) || exceptionLowConfidence < 0 || exceptionLowConfidence > 1) {
    throw new Error(`EXCEPTION_LOW_CONFIDENCE must be a number in [0,1], got ${exLowRaw}`);
  }
```
Add to the returned object (after `aiConfidenceThreshold: threshold,`):
```ts
    exceptionLowConfidence,
```

- [ ] **Step 2: Write `types.ts`**

```ts
// services/api/src/exceptions/types.ts
export type ExceptionCategory = 'RULES_FAILED' | 'CLASSIFY_REVIEW' | 'LOW_CONFIDENCE_AUTO';
export type DispositionState = 'open' | 'resolved' | 'dismissed' | 'deferred';
export type ReasonCode =
  | 'MAPPING_ADDED' | 'RECLASSIFIED' | 'DUPLICATE_CONFIRMED'
  | 'IMMATERIAL_WAIVED' | 'PENDING_DOC' | 'CARRIED_FORWARD' | 'OTHER';

export const REASON_CODES: ReasonCode[] = [
  'MAPPING_ADDED', 'RECLASSIFIED', 'DUPLICATE_CONFIRMED',
  'IMMATERIAL_WAIVED', 'PENDING_DOC', 'CARRIED_FORWARD', 'OTHER',
];

/** Categories that hard-block the period freeze. LOW_CONFIDENCE_AUTO is advisory. */
export const BLOCKING_CATEGORIES: ExceptionCategory[] = ['RULES_FAILED', 'CLASSIFY_REVIEW'];

export function severityRank(c: ExceptionCategory): number {
  return c === 'RULES_FAILED' ? 3 : c === 'CLASSIFY_REVIEW' ? 2 : 1;
}

export interface Exception {
  exceptionId: string;       // `${category}:${eventId}`
  category: ExceptionCategory;
  eventId: string;
  severity: number;          // severityRank
  reason: string;
  amount: string | null;     // best-effort from normalized payload, for future materiality
  ai: { eventType: string | null; purpose: string | null; confidence: number | null; reasoning: string | null } | null;
}
```

- [ ] **Step 3: Write the failing test**

```ts
// services/api/test/exceptions.collect.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion, setDecision, markPosted } from '../src/store/eventStore.js';
import { collectExceptions } from '../src/exceptions/collect.js';

const LOW = 0.85;
function mkDb(): Db {
  const db = openDb(':memory:');
  insertEntity(db, { id: 'e1', name: 'Acme', chainId: null, capId: null } as never);
  return db;
}
// a raw event the rules engine cannot post (unknown type) → RULES_FAILED when APPROVED
function addEvent(db: Db, id: string, raw: object) {
  insertEvent(db, { id, entityId: 'e1', rawJson: JSON.stringify(raw) });
}

describe('collectExceptions', () => {
  let db: Db;
  beforeEach(() => { db = mkDb(); });

  it('classifies NEEDS_REVIEW as CLASSIFY_REVIEW', () => {
    addEvent(db, 'ev1', { kind: 'x' });
    setAiSuggestion(db, 'ev1', { eventType: 'X', purpose: 'p', counterparty: null, confidence: 0.4, reasoning: 'r', routing: 'NEEDS_REVIEW' });
    const out = collectExceptions(db, 'e1', '2026-Q2', LOW);
    expect(out.map((e) => e.category)).toContain('CLASSIFY_REVIEW');
    expect(out[0].exceptionId).toBe('CLASSIFY_REVIEW:ev1');
  });

  it('classifies AUTO below comfort band as LOW_CONFIDENCE_AUTO, not above', () => {
    addEvent(db, 'lo', { kind: 'x' });
    setAiSuggestion(db, 'lo', { eventType: 'X', purpose: 'p', counterparty: null, confidence: 0.8, reasoning: 'r', routing: 'AUTO' });
    addEvent(db, 'hi', { kind: 'x' });
    setAiSuggestion(db, 'hi', { eventType: 'X', purpose: 'p', counterparty: null, confidence: 0.95, reasoning: 'r', routing: 'AUTO' });
    const cats = collectExceptions(db, 'e1', '2026-Q2', LOW).map((e) => e.exceptionId);
    expect(cats).toContain('LOW_CONFIDENCE_AUTO:lo');
    expect(cats).not.toContain('LOW_CONFIDENCE_AUTO:hi'); // 0.95 ≥ 0.85, no comfort issue (RULES_FAILED may still apply, asserted elsewhere)
  });

  it('excludes POSTED events from RULES_FAILED (already produced JE)', () => {
    addEvent(db, 'posted', { kind: 'unmappable' });
    setAiSuggestion(db, 'posted', { eventType: 'UNMAPPABLE', purpose: 'p', counterparty: null, confidence: 0.99, reasoning: 'r', routing: 'AUTO' });
    setDecision(db, 'posted', { finalEventType: 'UNMAPPABLE', finalPurpose: 'p' });
    markPosted(db, 'posted');
    const out = collectExceptions(db, 'e1', '2026-Q2', LOW);
    expect(out.find((e) => e.eventId === 'posted' && e.category === 'RULES_FAILED')).toBeUndefined();
  });

  it('orders by severity desc then confidence asc; GET is read-only (idempotent)', () => {
    addEvent(db, 'rev', { kind: 'x' });
    setAiSuggestion(db, 'rev', { eventType: 'X', purpose: 'p', counterparty: null, confidence: 0.2, reasoning: 'r', routing: 'NEEDS_REVIEW' });
    const a = collectExceptions(db, 'e1', '2026-Q2', LOW);
    const b = collectExceptions(db, 'e1', '2026-Q2', LOW);
    expect(a).toEqual(b); // recompute is deterministic, no state mutated
    for (let i = 1; i < a.length; i++) expect(a[i - 1].severity).toBeGreaterThanOrEqual(a[i].severity);
  });
});
```

> NOTE for implementer: confirm `setAiSuggestion`'s exact parameter object shape against `services/api/src/store/eventStore.ts` before running — adjust the test's `setAiSuggestion(...)` call to match its real signature (it sets `status` from `routing`). If it has no `routing` param, set status via the appropriate store call. The assertions (categories/order/POSTED-exclusion/idempotence) are the intent and must stay.

- [ ] **Step 4: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/exceptions.collect.test.ts`
Expected: FAIL — `collect.js` not found / `collectExceptions` undefined.

- [ ] **Step 5: Write `collect.ts`**

```ts
// services/api/src/exceptions/collect.ts
import type { Db } from '../store/db.js';
import { listEvents } from '../store/eventStore.js';
import type { EventRow } from '../store/eventStore.js';
import { buildRuleInput } from '../http/buildRuleInput.js';
import { evaluate } from '../deps/rulesEngine.js';
import { type Exception, type ExceptionCategory, severityRank } from './types.js';

function aiBlock(e: EventRow) {
  const has = e.aiEventType !== null || e.aiConfidence !== null;
  return has ? { eventType: e.aiEventType, purpose: e.aiPurpose, confidence: e.aiConfidence, reasoning: e.aiReasoning } : null;
}

// Best-effort amount extraction from the normalized payload — surfaced for future
// materiality sorting (spec §9.5). Never throws.
function amountOf(e: EventRow): string | null {
  try {
    const raw = JSON.parse(e.rawJson) as Record<string, unknown>;
    const v = raw.amount ?? raw.value ?? (raw as Record<string, unknown>).quantity;
    return v == null ? null : String(v);
  } catch { return null; }
}

function mk(category: ExceptionCategory, e: EventRow, reason: string): Exception {
  return {
    exceptionId: `${category}:${e.id}`,
    category, eventId: e.id, severity: severityRank(category),
    reason, amount: amountOf(e), ai: aiBlock(e),
  };
}

/**
 * Pure read-aggregator. Projects current events into typed exceptions.
 * NO writes, NO persistence — single source of truth stays in events + rules engine.
 * `evaluate()` is the same pure function run-rules uses; calling it here is side-effect free.
 */
export function collectExceptions(db: Db, entityId: string, periodId: string, lowConfidence: number): Exception[] {
  const out: Exception[] = [];
  for (const e of listEvents(db, entityId)) {
    if (e.status === 'NEEDS_REVIEW') {
      out.push(mk('CLASSIFY_REVIEW', e, 'AI routed to human review (low classification confidence)'));
    }
    if (e.status === 'AUTO' && e.aiConfidence !== null && e.aiConfidence < lowConfidence) {
      out.push(mk('LOW_CONFIDENCE_AUTO', e, `auto-classified at ${e.aiConfidence.toFixed(2)}, below comfort band ${lowConfidence}`));
    }
    // RULES_FAILED: non-POSTED APPROVED/AUTO events that cannot post.
    if ((e.status === 'APPROVED' || e.status === 'AUTO')) {
      let reason = '';
      try {
        const o = evaluate(buildRuleInput(e, { periodId }));
        if (o.decision !== 'POSTABLE' || o.journalEntries.length === 0) {
          reason = o.exceptions[0]?.code ?? (o.decision === 'POSTABLE' ? 'NO_JOURNAL_ENTRIES' : o.decision);
        }
      } catch (err) {
        reason = `EVAL_THREW: ${(err as Error).message}`;
      }
      if (reason) out.push(mk('RULES_FAILED', e, reason));
    }
  }
  out.sort((a, b) => b.severity - a.severity || (a.ai?.confidence ?? 1) - (b.ai?.confidence ?? 1));
  return out;
}
```

> Note: the test calls `collectExceptions(db, e1, period, LOW)` with 4 args — match this signature. The route (Task 3) passes `cfg.exceptionLowConfidence`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/api && npx vitest run test/exceptions.collect.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/exceptions/types.ts services/api/src/exceptions/collect.ts services/api/src/config.ts services/api/test/exceptions.collect.test.ts
git commit -m "feat(api): collectExceptions aggregator (3 categories, recompute-on-read, POSTED-excluded)"
```

---

### Task 2: Disposition state machine + store (no journalStore import)

**Files:**
- Modify: `services/api/src/store/schema.sql`
- Create: `services/api/src/store/dispositionStore.ts`
- Create: `services/api/src/exceptions/disposition.ts`
- Test: `services/api/test/exceptions.disposition.test.ts`
- Test: `services/api/test/exceptions.guardrail.test.ts`

**Interfaces:**
- Consumes: `Db`; `DispositionState`, `ReasonCode` from `exceptions/types.js`.
- Produces:
  - `getDisposition(db, category, eventId): DispositionRow | null`
  - `upsertDisposition(db, row): void`, `appendDispositionLog(db, row): void`
  - `interface DispositionRow { category: string; eventId: string; entityId: string; state: DispositionState; reasonCode: ReasonCode; reasonNote: string | null; decidedBy: string; decidedAt: number }`
  - `assertDispositionTransition(from: DispositionState, to: DispositionState): void` (throws `Error` with code-ish message on illegal)
  - `applyDisposition(db, args): DispositionRow` where `args = { entityId, category, eventId, to, reasonCode, reasonNote?, decidedBy }`

- [ ] **Step 1: Add tables to `schema.sql`**

Append to `services/api/src/store/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS exception_disposition (
  category    TEXT NOT NULL,
  event_id    TEXT NOT NULL REFERENCES events(id),
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  state       TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_note TEXT,
  decided_by  TEXT NOT NULL,
  decided_at  INTEGER NOT NULL,
  PRIMARY KEY (category, event_id)
);
CREATE TABLE IF NOT EXISTS exception_disposition_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  state       TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_note TEXT,
  decided_by  TEXT NOT NULL,
  decided_at  INTEGER NOT NULL
);
```

- [ ] **Step 2: Write `dispositionStore.ts`**

```ts
// services/api/src/store/dispositionStore.ts
import type { Db } from './db.js';
import type { DispositionState, ReasonCode } from '../exceptions/types.js';

export interface DispositionRow {
  category: string; eventId: string; entityId: string;
  state: DispositionState; reasonCode: ReasonCode; reasonNote: string | null;
  decidedBy: string; decidedAt: number;
}

function map(r: Record<string, unknown>): DispositionRow {
  return {
    category: r.category as string, eventId: r.event_id as string, entityId: r.entity_id as string,
    state: r.state as DispositionState, reasonCode: r.reason_code as ReasonCode,
    reasonNote: (r.reason_note as string | null) ?? null,
    decidedBy: r.decided_by as string, decidedAt: r.decided_at as number,
  };
}

export function getDisposition(db: Db, category: string, eventId: string): DispositionRow | null {
  const r = db.prepare('SELECT * FROM exception_disposition WHERE category = ? AND event_id = ?').get(category, eventId) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function listDispositions(db: Db, entityId: string): DispositionRow[] {
  return (db.prepare('SELECT * FROM exception_disposition WHERE entity_id = ?').all(entityId) as Record<string, unknown>[]).map(map);
}

export function upsertDisposition(db: Db, row: DispositionRow): void {
  db.prepare(`INSERT INTO exception_disposition (category, event_id, entity_id, state, reason_code, reason_note, decided_by, decided_at)
    VALUES (@category, @eventId, @entityId, @state, @reasonCode, @reasonNote, @decidedBy, @decidedAt)
    ON CONFLICT(category, event_id) DO UPDATE SET
      state=@state, reason_code=@reasonCode, reason_note=@reasonNote, decided_by=@decidedBy, decided_at=@decidedAt`).run(row as never);
}

export function appendDispositionLog(db: Db, row: DispositionRow): void {
  db.prepare(`INSERT INTO exception_disposition_log (category, event_id, entity_id, state, reason_code, reason_note, decided_by, decided_at)
    VALUES (@category, @eventId, @entityId, @state, @reasonCode, @reasonNote, @decidedBy, @decidedAt)`).run(row as never);
}
```

> Implementer: confirm better-sqlite3 named-param binding style against `journalStore.ts`/`snapshotStore.ts`. If those use positional `?`, mirror that instead of `@named`.

- [ ] **Step 3: Write the failing tests (state machine + guardrail)**

```ts
// services/api/test/exceptions.disposition.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent } from '../src/store/eventStore.js';
import { applyDisposition, assertDispositionTransition } from '../src/exceptions/disposition.js';
import { getDisposition } from '../src/store/dispositionStore.js';

function mkDb(): Db {
  const db = openDb(':memory:');
  insertEntity(db, { id: 'e1', name: 'Acme', chainId: null, capId: null } as never);
  insertEvent(db, { id: 'ev1', entityId: 'e1', rawJson: '{}' });
  insertEvent(db, { id: 'ev2', entityId: 'e1', rawJson: '{}' });
  return db;
}
const base = (over: object) => ({ entityId: 'e1', category: 'CLASSIFY_REVIEW', eventId: 'ev1', reasonCode: 'RECLASSIFIED', decidedBy: 'tester', now: 1000, ...over });

describe('disposition state machine', () => {
  let db: Db;
  beforeEach(() => { db = mkDb(); });

  it('open → resolved/dismissed/deferred are legal', () => {
    for (const to of ['resolved', 'dismissed', 'deferred'] as const) {
      expect(() => assertDispositionTransition('open', to)).not.toThrow();
    }
  });

  it('rejects terminal re-open (resolved → open)', () => {
    expect(() => assertDispositionTransition('resolved', 'open')).toThrow();
    expect(() => assertDispositionTransition('dismissed', 'open')).toThrow();
  });

  it('deferred → resolved is legal; applyDisposition persists + logs', () => {
    applyDisposition(db, base({ to: 'deferred' }) as never);
    const r = applyDisposition(db, base({ to: 'resolved' }) as never);
    expect(r.state).toBe('resolved');
    expect(getDisposition(db, 'CLASSIFY_REVIEW', 'ev1')!.state).toBe('resolved');
    const log = db.prepare('SELECT count(*) c FROM exception_disposition_log').get() as { c: number };
    expect(log.c).toBe(2); // append-only: both transitions retained
  });

  it('composite key isolates two categories on the same event', () => {
    applyDisposition(db, base({ category: 'CLASSIFY_REVIEW', to: 'resolved' }) as never);
    applyDisposition(db, base({ category: 'RULES_FAILED', to: 'deferred' }) as never);
    expect(getDisposition(db, 'CLASSIFY_REVIEW', 'ev1')!.state).toBe('resolved');
    expect(getDisposition(db, 'RULES_FAILED', 'ev1')!.state).toBe('deferred');
  });

  it('rejects illegal transition through applyDisposition', () => {
    applyDisposition(db, base({ to: 'resolved' }) as never);
    expect(() => applyDisposition(db, base({ to: 'deferred' }) as never)).toThrow();
  });
});
```

```ts
// services/api/test/exceptions.guardrail.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// AI/disposition zero posting authority: the disposition module must never reach journalStore.
describe('disposition guardrail', () => {
  it('disposition.ts imports nothing from journalStore', () => {
    const p = fileURLToPath(new URL('../src/exceptions/disposition.ts', import.meta.url));
    const src = readFileSync(p, 'utf8');
    expect(src).not.toMatch(/journalStore/);
    expect(src).not.toMatch(/insertJournalEntry/);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd services/api && npx vitest run test/exceptions.disposition.test.ts test/exceptions.guardrail.test.ts`
Expected: FAIL — `disposition.js` not found.

- [ ] **Step 5: Write `disposition.ts`**

```ts
// services/api/src/exceptions/disposition.ts
// AUDIT OVERLAY ONLY. This module MUST NOT import journalStore or write any JE.
// Disposition is observational triage metadata, excluded from snapshot/anchor.
import type { Db } from '../store/db.js';
import type { DispositionState, ReasonCode } from './types.js';
import { getDisposition, upsertDisposition, appendDispositionLog, type DispositionRow } from '../store/dispositionStore.js';

const LEGAL: Record<DispositionState, DispositionState[]> = {
  open: ['resolved', 'dismissed', 'deferred'],
  deferred: ['open', 'resolved', 'dismissed'],
  resolved: [],   // terminal
  dismissed: [],  // terminal
};

export function assertDispositionTransition(from: DispositionState, to: DispositionState): void {
  if (!LEGAL[from]?.includes(to)) {
    throw new Error(`ILLEGAL_TRANSITION: ${from} → ${to}`);
  }
}

export interface ApplyArgs {
  entityId: string; category: string; eventId: string;
  to: DispositionState; reasonCode: ReasonCode; reasonNote?: string | null;
  decidedBy: string; now: number;
}

export function applyDisposition(db: Db, args: ApplyArgs): DispositionRow {
  const current = getDisposition(db, args.category, args.eventId);
  const from: DispositionState = current?.state ?? 'open';
  assertDispositionTransition(from, args.to);
  const row: DispositionRow = {
    category: args.category, eventId: args.eventId, entityId: args.entityId,
    state: args.to, reasonCode: args.reasonCode, reasonNote: args.reasonNote ?? null,
    decidedBy: args.decidedBy, decidedAt: args.now,
  };
  upsertDisposition(db, row);
  appendDispositionLog(db, row);
  return row;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd services/api && npx vitest run test/exceptions.disposition.test.ts test/exceptions.guardrail.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/store/schema.sql services/api/src/store/dispositionStore.ts services/api/src/exceptions/disposition.ts services/api/test/exceptions.disposition.test.ts services/api/test/exceptions.guardrail.test.ts
git commit -m "feat(api): disposition state machine + audit-log store (fail-closed transitions, no JE access)"
```

---

### Task 3: HTTP endpoints + close gate on /snapshot

**Files:**
- Modify: `services/api/src/store/snapshotStore.ts` (add `hasAnchoredSnapshot`)
- Modify: `services/api/src/http/routes.ts`
- Test: `services/api/test/exceptions.routes.test.ts`

**Interfaces:**
- Consumes: `collectExceptions`, `applyDisposition`, `listDispositions`, `getDisposition`, `BLOCKING_CATEGORIES`, `REASON_CODES`, `hasAnchoredSnapshot`.
- Produces (HTTP):
  - `GET /entities/:id/exceptions?periodId=` → `{ exceptions: ExceptionDTO[], summary: { open, blocking, byCategory } }`
  - `POST /exceptions/:exceptionId/disposition` body `{ state, reasonCode, reasonNote?, decidedBy? }`
  - `GET /entities/:id/close-readiness?periodId=` → `{ blocking: number, blockers: ExceptionDTO[] }`
  - close gate: `POST /entities/:id/snapshot` returns `409 EXCEPTIONS_BLOCKING` when an `open` blocking exception exists.
  - `ExceptionDTO = Exception & { disposition: {state,reasonCode,decidedBy,decidedAt}|null, anchoredReadOnly: boolean }`

- [ ] **Step 1: Add `hasAnchoredSnapshot` to snapshotStore**

```ts
// append to services/api/src/store/snapshotStore.ts
export function hasAnchoredSnapshot(db: Db, entityId: string): boolean {
  const r = db.prepare("SELECT 1 FROM snapshots WHERE entity_id = ? AND status = 'ANCHORED' LIMIT 1").get(entityId);
  return r !== undefined;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// services/api/test/exceptions.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp } from './helpers/app.js'; // implementer: reuse the existing test app factory used by other route tests
import type { FastifyInstance } from 'fastify';

// Discover the existing harness: other tests in services/api/test build the app with stub AI clients.
// Mirror that exact setup here (same db seeding + deps). The assertions below are the intent.

describe('exceptions routes + close gate', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = await buildTestApp(); /* seeds entity e1 */ });

  it('GET /entities/:id/exceptions returns categorized list + summary', async () => {
    // seed a NEEDS_REVIEW event via ingest+classify stub so collectExceptions has input
    const r = await app.inject({ method: 'GET', url: '/entities/e1/exceptions?periodId=2026-Q2' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toHaveProperty('exceptions');
    expect(body.summary).toHaveProperty('blocking');
  });

  it('POST disposition rejects forged exceptionId with 404', async () => {
    const r = await app.inject({ method: 'POST', url: `/exceptions/${encodeURIComponent('RULES_FAILED:does-not-exist')}/disposition`, payload: { state: 'dismissed', reasonCode: 'OTHER', reasonNote: 'x' } });
    expect(r.statusCode).toBe(404);
  });

  it('POST disposition rejects illegal transition with 409', async () => {
    // implementer: first create a real open exception, resolve it, then attempt resolved→deferred
  });

  it('close gate: open blocking exception → /snapshot 409 EXCEPTIONS_BLOCKING', async () => {
    // implementer: seed an open NEEDS_REVIEW (CLASSIFY_REVIEW) exception, then POST /entities/e1/snapshot
    // expect 409 with error code EXCEPTIONS_BLOCKING; then dispose it (deferred) and expect snapshot to proceed.
  });

  it('LOW_CONFIDENCE_AUTO open does NOT block close', async () => {
    // implementer: seed only a low-confidence AUTO event; /snapshot must not 409 on EXCEPTIONS_BLOCKING
  });
});
```

> Implementer: find the existing route-test harness in `services/api/test/` (the file that injects into the Fastify app with stub `classifyClient`/`copilotClient`). Reuse it verbatim for `buildTestApp`; do not invent a new bootstrap. Fill the 3 stubbed `it()` bodies following the comments — each asserts the close-gate / transition intent. All five must pass.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/exceptions.routes.test.ts`
Expected: FAIL — routes not registered.

- [ ] **Step 4: Add endpoints + close gate to `routes.ts`**

Add imports near the top:
```ts
import { collectExceptions } from '../exceptions/collect.js';
import { applyDisposition } from '../exceptions/disposition.js';
import { getDisposition, listDispositions } from '../store/dispositionStore.js';
import { BLOCKING_CATEGORIES, REASON_CODES, type DispositionState } from '../exceptions/types.js';
import { hasAnchoredSnapshot } from '../store/snapshotStore.js';
```

Add a DTO helper (near `eventDTO`):
```ts
const DEFAULT_PERIOD = '2026-Q2';
function exceptionDTO(db: Db, entityId: string, periodId: string, lowConf: number) {
  const anchored = hasAnchoredSnapshot(db, entityId);
  return collectExceptions(db, entityId, periodId, lowConf).map((ex) => {
    const d = getDisposition(db, ex.category, ex.eventId);
    return {
      ...ex,
      disposition: d ? { state: d.state, reasonCode: d.reasonCode, decidedBy: d.decidedBy, decidedAt: d.decidedAt } : null,
      anchoredReadOnly: anchored,
    };
  });
}
function isOpen(d: { state: DispositionState } | null): boolean {
  return d === null || d.state === 'open';
}
```

Add the routes (inside the plugin, alongside the others):
```ts
  // Exception Queue (Phase 1 A-1)
  app.get<{ Params: { id: string }; Querystring: { periodId?: string } }>('/entities/:id/exceptions', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.query.periodId ?? DEFAULT_PERIOD;
    const list = exceptionDTO(db, req.params.id, periodId, cfg.exceptionLowConfidence);
    const blocking = list.filter((e) => BLOCKING_CATEGORIES.includes(e.category) && isOpen(e.disposition)).length;
    const byCategory: Record<string, number> = {};
    for (const e of list) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    return { exceptions: list, summary: { open: list.filter((e) => isOpen(e.disposition)).length, blocking, byCategory } };
  });

  app.get<{ Params: { id: string }; Querystring: { periodId?: string } }>('/entities/:id/close-readiness', async (req) => {
    requireEntity(db, req.params.id);
    const periodId = req.query.periodId ?? DEFAULT_PERIOD;
    const blockers = exceptionDTO(db, req.params.id, periodId, cfg.exceptionLowConfidence)
      .filter((e) => BLOCKING_CATEGORIES.includes(e.category) && isOpen(e.disposition));
    return { blocking: blockers.length, blockers };
  });

  app.post<{ Params: { exceptionId: string }; Body: { state?: string; reasonCode?: string; reasonNote?: string; decidedBy?: string } }>('/exceptions/:exceptionId/disposition', async (req) => {
    const decoded = decodeURIComponent(req.params.exceptionId);
    const sep = decoded.indexOf(':');
    if (sep < 0) throw new ApiError(400, 'VALIDATION', 'exceptionId must be category:eventId');
    const category = decoded.slice(0, sep);
    const eventId = decoded.slice(sep + 1);
    const b = req.body ?? {};
    if (!b.state || !b.reasonCode) throw new ApiError(400, 'VALIDATION', 'state and reasonCode are required');
    if (!REASON_CODES.includes(b.reasonCode as never)) throw new ApiError(400, 'VALIDATION', `unknown reasonCode ${b.reasonCode}`);
    if (b.reasonCode === 'OTHER' && !b.reasonNote) throw new ApiError(400, 'VALIDATION', 'reasonNote required when reasonCode is OTHER');

    // Re-validate against live exceptions — reject forged / stale ids.
    const ev = getEvent(db, eventId);
    if (!ev) throw new ApiError(404, 'EXCEPTION_NOT_FOUND', `no event ${eventId}`);
    const live = collectExceptions(db, ev.entityId, DEFAULT_PERIOD, cfg.exceptionLowConfidence)
      .find((e) => e.category === category && e.eventId === eventId);
    if (!live) throw new ApiError(404, 'EXCEPTION_NOT_FOUND', `no current exception ${decoded}`);

    try {
      const row = applyDisposition(db, {
        entityId: ev.entityId, category, eventId,
        to: b.state as DispositionState, reasonCode: b.reasonCode as never,
        reasonNote: b.reasonNote ?? null, decidedBy: b.decidedBy ?? 'demo-controller', now: Date.now(),
      });
      return { disposition: row };
    } catch (err) {
      if ((err as Error).message.startsWith('ILLEGAL_TRANSITION')) {
        throw new ApiError(409, 'ILLEGAL_TRANSITION', (err as Error).message);
      }
      throw err;
    }
  });
```

Add the close gate at the **start** of the existing `POST /entities/:id/snapshot` handler, right after `requireEntity(...)` and `periodId` validation:
```ts
    // Close gate (spec §4): open blocking exceptions hard-block the freeze.
    const blockers = exceptionDTO(db, req.params.id, periodId, cfg.exceptionLowConfidence)
      .filter((e) => BLOCKING_CATEGORIES.includes(e.category) && isOpen(e.disposition));
    if (blockers.length > 0) {
      throw new ApiError(409, 'EXCEPTIONS_BLOCKING', `${blockers.length} open exception(s) block close: ${blockers.map((b) => b.exceptionId).join(', ')}`);
    }
```

> Implementer: `getEvent` is already imported in routes.ts (used by `requireEvent`); if not, add it. Verify `ApiError` signature `(status, code, message)` matches existing usage.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/api && npx vitest run && npx tsc --noEmit`
Expected: PASS (new + all existing). If a pre-existing snapshot test now 409s on the close gate, it means that test seeds open blocking exceptions implicitly — adjust that test to dispose them first, OR confirm its seeded events are POSTED/none. Document any such change in the commit.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/http/routes.ts services/api/src/store/snapshotStore.ts services/api/test/exceptions.routes.test.ts
git commit -m "feat(api): exceptions + disposition + close-readiness endpoints; close gate on /snapshot (409 EXCEPTIONS_BLOCKING)"
```

---

### Task 4: Frontend — hooks/types, workspace shell, ExceptionList

**Files:**
- Modify: `web/src/api/types.ts`, `web/src/api/hooks.ts`
- Modify: `web/src/app/workspaces.ts` (flip status)
- Create: `web/src/workspaces/ExceptionsWorkspace.tsx`
- Create: `web/src/components/data/ExceptionList.tsx`
- Modify: `web/src/App.tsx` (route `exceptions` workspace to the new component)
- Test: `web/src/components/data/ExceptionList.test.tsx`

**Interfaces:**
- Consumes: `useEntityCtx`, existing query-hook patterns in `hooks.ts`.
- Produces:
  - types `ExceptionDTO`, `ExceptionsResponse`, `DispositionState`, `ReasonCode`
  - hooks `useExceptions(entityId, periodId)`, `useDisposition(entityId)` (mutation)
  - `<ExceptionList exceptions selectedId onSelect />`
  - `<ExceptionsWorkspace />`

- [ ] **Step 1: Add types** (`web/src/api/types.ts`)

```ts
export type ExceptionCategory = 'RULES_FAILED' | 'CLASSIFY_REVIEW' | 'LOW_CONFIDENCE_AUTO';
export type DispositionState = 'open' | 'resolved' | 'dismissed' | 'deferred';
export type ReasonCode = 'MAPPING_ADDED' | 'RECLASSIFIED' | 'DUPLICATE_CONFIRMED' | 'IMMATERIAL_WAIVED' | 'PENDING_DOC' | 'CARRIED_FORWARD' | 'OTHER';
export interface ExceptionDTO {
  exceptionId: string; category: ExceptionCategory; eventId: string; severity: number;
  reason: string; amount: string | null;
  ai: { eventType: string | null; purpose: string | null; confidence: number | null; reasoning: string | null } | null;
  disposition: { state: DispositionState; reasonCode: ReasonCode; decidedBy: string; decidedAt: number } | null;
  anchoredReadOnly: boolean;
}
export interface ExceptionsResponse { exceptions: ExceptionDTO[]; summary: { open: number; blocking: number; byCategory: Record<string, number> }; }
```

- [ ] **Step 2: Add hooks** (`web/src/api/hooks.ts`) — mirror the existing `useReviewQueue`/`useDecide` patterns exactly (same `useQuery`/`useMutation`, queryKey, fetch helper, invalidation):

```ts
export function useExceptions(entityId: string | undefined, periodId = '2026-Q2') {
  return useQuery({
    queryKey: ['exceptions', entityId, periodId],
    enabled: !!entityId,
    queryFn: () => api<ExceptionsResponse>(`/entities/${entityId}/exceptions?periodId=${encodeURIComponent(periodId)}`).then((r) => r),
    select: (r) => r, // keep full {exceptions, summary}
  });
}
export function useDisposition(entityId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { exceptionId: string; state: DispositionState; reasonCode: ReasonCode; reasonNote?: string }) =>
      api(`/exceptions/${encodeURIComponent(v.exceptionId)}/disposition`, { method: 'POST', body: JSON.stringify({ state: v.state, reasonCode: v.reasonCode, reasonNote: v.reasonNote }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exceptions', entityId] }); },
  });
}
```

> Implementer: match the real `api()` helper signature + the existing `useQuery`/`useMutation` import style in `hooks.ts`. Adjust `select`/return shape to the file's convention.

- [ ] **Step 3: Flip workspace status** (`web/src/app/workspaces.ts`)

Change the `exceptions` entry: `status: 'soon'` → `status: 'ready'`.

- [ ] **Step 4: Write the failing test** (`ExceptionList.test.tsx`)

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExceptionList } from './ExceptionList';
import type { ExceptionDTO } from '../../api/types';

const ex = (over: Partial<ExceptionDTO>): ExceptionDTO => ({
  exceptionId: 'X:1', category: 'LOW_CONFIDENCE_AUTO', eventId: '1', severity: 1,
  reason: 'r', amount: null, ai: { eventType: 'T', purpose: 'p', confidence: 0.8, reasoning: '' },
  disposition: null, anchoredReadOnly: false, ...over,
});

describe('ExceptionList', () => {
  it('groups blockers first under a BLOCKS CLOSE label and labels category by text (not color-only)', () => {
    const items = [
      ex({ exceptionId: 'LOW_CONFIDENCE_AUTO:1', eventId: '1', category: 'LOW_CONFIDENCE_AUTO', severity: 1 }),
      ex({ exceptionId: 'RULES_FAILED:2', eventId: '2', category: 'RULES_FAILED', severity: 3 }),
    ];
    render(<ExceptionList exceptions={items} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/BLOCKS CLOSE/i)).toBeInTheDocument();
    // category conveyed by text label, a11y (not color alone)
    expect(screen.getByText(/RULES_FAILED|Rule/i)).toBeInTheDocument();
  });

  it('calls onSelect with exceptionId on row click', () => {
    const onSelect = vi.fn();
    render(<ExceptionList exceptions={[ex({ exceptionId: 'RULES_FAILED:2', eventId: '2', category: 'RULES_FAILED', severity: 3 })]} selectedId={null} onSelect={onSelect} />);
    screen.getByText(/RULES_FAILED|Rule/i).click();
    expect(onSelect).toHaveBeenCalledWith('RULES_FAILED:2');
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/data/ExceptionList.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 6: Implement `ExceptionList.tsx`**

Two-axis encoding (Global Constraints): category = icon glyph + text label; severity = grouping + brass accent for blockers; mono age/amount. Group `BLOCKS CLOSE` (severity≥2) above `HOLD` (rest). Code:

```tsx
import type { ExceptionDTO, ExceptionCategory } from '../../api/types';

const CAT_META: Record<ExceptionCategory, { glyph: string; label: string }> = {
  RULES_FAILED: { glyph: '⛓', label: 'Rule failed' },
  CLASSIFY_REVIEW: { glyph: '⑂', label: 'Classify review' },
  LOW_CONFIDENCE_AUTO: { glyph: '◌', label: 'Low confidence' },
};

function Row({ e, selected, onSelect }: { e: ExceptionDTO; selected: boolean; onSelect(id: string): void }) {
  const blocker = e.severity >= 2;
  const m = CAT_META[e.category];
  return (
    <button
      onClick={() => onSelect(e.exceptionId)}
      aria-current={selected ? 'true' : undefined}
      style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 'var(--s-3)', width: '100%',
        textAlign: 'left', alignItems: 'center', padding: 'var(--s-3)',
        borderLeft: blocker ? '3px solid var(--brass)' : '3px solid transparent',
        background: selected ? 'var(--paper-card)' : 'transparent', border: 'none',
        borderBottom: '1px solid var(--paper-line)', cursor: 'pointer',
      }}
    >
      <span aria-hidden style={{ fontSize: 18 }}>{m.glyph}</span>
      <span>
        <span style={{ fontSize: 12, fontWeight: blocker ? 700 : 500, color: 'var(--ink)' }}>{m.label}</span>
        <span className="mono" style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}>{e.eventId}</span>
      </span>
      <span className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
        {e.disposition ? e.disposition.state : 'open'}
      </span>
    </button>
  );
}

export function ExceptionList({ exceptions, selectedId, onSelect }: {
  exceptions: ExceptionDTO[]; selectedId: string | null; onSelect(id: string): void;
}) {
  const blockers = exceptions.filter((e) => e.severity >= 2);
  const rest = exceptions.filter((e) => e.severity < 2);
  const section = (label: string, items: ExceptionDTO[]) => items.length === 0 ? null : (
    <div key={label}>
      <div style={{ padding: 'var(--s-2) var(--s-3)', fontSize: 11, letterSpacing: '0.08em', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>
        {label} · {items.length}
      </div>
      {items.map((e) => <Row key={e.exceptionId} e={e} selected={e.exceptionId === selectedId} onSelect={onSelect} />)}
    </div>
  );
  return <div style={{ display: 'flex', flexDirection: 'column' }}>{section('Blocks close', blockers)}{section('Hold', rest)}</div>;
}
```

> Implementer: if `--brass`/`--ink` aren't the exact token names, grep `tokens.css` and use the real ones (brass pill uses the brass token; reuse it). Do NOT invent tokens.

- [ ] **Step 7: Wire `ExceptionsWorkspace.tsx` + App routing**

```tsx
// web/src/workspaces/ExceptionsWorkspace.tsx
import { useState } from 'react';
import { useEntityCtx } from '../app/EntityContext';
import { useExceptions } from '../api/hooks';
import { ExceptionList } from '../components/data/ExceptionList';
import { ExceptionDetail } from '../components/data/ExceptionDetail';
import { EmptyState } from '../components/data/EmptyState';

export function ExceptionsWorkspace() {
  const { entity } = useEntityCtx();
  const { data } = useExceptions(entity?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const exceptions = data?.exceptions ?? [];
  const selected = exceptions.find((e) => e.exceptionId === selectedId) ?? null;

  if (exceptions.length === 0) return <EmptyState variant="clear-seas" />;

  return (
    <div className="exceptions-layout" style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'flex-start' }}>
      <div className="card" style={{ flex: '0 0 320px', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 'var(--s-3)', fontSize: 13 }}>
          {data?.summary.open ?? 0} open · {data?.summary.blocking ?? 0} blocking close
        </div>
        <ExceptionList exceptions={exceptions} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div style={{ flex: '1 1 360px' }}>
        {selected ? <ExceptionDetail exception={selected} entityId={entity!.id} /> : <EmptyState variant="pick-one" />}
      </div>
    </div>
  );
}
```

In `web/src/App.tsx`, where the active workspace is switched (currently `close` → step flow, `soon` → EmptyState), add a branch: `activeWorkspace === 'exceptions'` → `<ExceptionsWorkspace />`. (ExceptionDetail is built in Task 5; for this task, stub it with a one-line placeholder component so the build passes, then replace in Task 5. Mark with `// TODO Task 5`.)

> NOTE: To keep Task 4 independently green, create a minimal `web/src/components/data/ExceptionDetail.tsx` that renders `<div className="card">{exception.exceptionId}</div>` and `EmptyState` `variant` prop accepting `'clear-seas'|'pick-one'` falling back to existing default. Task 5 replaces ExceptionDetail fully; Task 6 builds the real EmptyState variants.

- [ ] **Step 8: Run tests + build**

Run: `cd web && npx vitest run src/components/data/ExceptionList.test.tsx && npm run build`
Expected: PASS, build exit 0.

- [ ] **Step 9: Commit**

```bash
git add web/src/api/types.ts web/src/api/hooks.ts web/src/app/workspaces.ts web/src/workspaces/ExceptionsWorkspace.tsx web/src/components/data/ExceptionList.tsx web/src/components/data/ExceptionDetail.tsx web/src/components/data/EmptyState.tsx web/src/App.tsx web/src/components/data/ExceptionList.test.tsx
git commit -m "feat(web): exceptions workspace shell + severity-weighted ExceptionList + hooks"
```

---

### Task 5: Frontend — ExceptionDetail + DispositionControls (dismiss ceremony, anchored read-only)

**Files:**
- Replace: `web/src/components/data/ExceptionDetail.tsx`
- Create: `web/src/components/data/DispositionControls.tsx`
- Test: `web/src/components/data/DispositionControls.test.tsx`

**Interfaces:**
- Consumes: `useDisposition`, `useCopilot` (existing), `ConfidenceBar`, `CopilotDock`, `DecideForm`, `useDecide` (existing).
- Produces: `<ExceptionDetail exception entityId />`, `<DispositionControls exception entityId />`.

- [ ] **Step 1: Write the failing test** (`DispositionControls.test.tsx`)

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DispositionControls } from './DispositionControls';
import type { ExceptionDTO } from '../../api/types';

const ex = (over: Partial<ExceptionDTO> = {}): ExceptionDTO => ({
  exceptionId: 'RULES_FAILED:2', category: 'RULES_FAILED', eventId: '2', severity: 3,
  reason: 'NO_MAPPING', amount: null, ai: null, disposition: null, anchoredReadOnly: false, ...over,
});
const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

describe('DispositionControls', () => {
  it('shows only valid transitions for open state (resolve/defer/dismiss)', () => {
    render(wrap(<DispositionControls exception={ex()} entityId="e1" />));
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /defer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('dismiss requires a reason: confirm disabled until reasonCode chosen (ceremony)', () => {
    render(wrap(<DispositionControls exception={ex()} entityId="e1" />));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    // inline expansion appears with a required reason; explicit confirm is disabled initially
    const confirm = screen.getByRole('button', { name: /dismiss this exception/i });
    expect(confirm).toBeDisabled();
  });

  it('anchoredReadOnly disables all controls with an informational note', () => {
    render(wrap(<DispositionControls exception={ex({ anchoredReadOnly: true })} entityId="e1" />));
    expect(screen.getByText(/anchored/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolve/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/data/DispositionControls.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `DispositionControls.tsx`**

Segmented buttons (only valid transitions), brass Resolve / ghost Defer / dangerous Dismiss with inline-expand + required reasonCode. Anchored → read-only note. Use `useDisposition`. Reason codes from a local const mirroring `REASON_CODES`.

```tsx
import { useState } from 'react';
import { useDisposition } from '../../api/hooks';
import type { ExceptionDTO, DispositionState, ReasonCode } from '../../api/types';

const REASON_CODES: ReasonCode[] = ['MAPPING_ADDED', 'RECLASSIFIED', 'DUPLICATE_CONFIRMED', 'IMMATERIAL_WAIVED', 'PENDING_DOC', 'CARRIED_FORWARD', 'OTHER'];
const LEGAL: Record<DispositionState, DispositionState[]> = {
  open: ['resolved', 'deferred', 'dismissed'],
  deferred: ['resolved', 'dismissed'],
  resolved: [], dismissed: [],
};

export function DispositionControls({ exception, entityId }: { exception: ExceptionDTO; entityId: string }) {
  const dispose = useDisposition(entityId);
  const [dismissing, setDismissing] = useState(false);
  const [reasonCode, setReasonCode] = useState<ReasonCode | ''>('');
  const [note, setNote] = useState('');
  const cur: DispositionState = exception.disposition?.state ?? 'open';

  if (exception.anchoredReadOnly) {
    return <p className="font-body" style={{ color: 'var(--ink-soft)', fontSize: 13 }}>⚓ Period anchored — exceptions are informational (read-only).</p>;
  }
  const valid = LEGAL[cur];
  if (valid.length === 0) {
    return <p className="font-body" style={{ color: 'var(--ink-soft)', fontSize: 13 }}>Disposition: <b>{cur}</b> (terminal).</p>;
  }

  const submit = (state: DispositionState, code: ReasonCode) =>
    dispose.mutate({ exceptionId: exception.exceptionId, state, reasonCode: code, reasonNote: note || undefined });

  return (
    <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
        {valid.includes('resolved') && <button className="btn-primary" disabled={dispose.isPending} onClick={() => submit('resolved', 'RECLASSIFIED')}>Resolve</button>}
        {valid.includes('deferred') && <button style={ghost} disabled={dispose.isPending} onClick={() => submit('deferred', 'CARRIED_FORWARD')}>Defer</button>}
        {valid.includes('dismissed') && <button style={ghost} onClick={() => setDismissing((v) => !v)}>Dismiss…</button>}
      </div>
      {dismissing && (
        <div style={{ border: '1px solid var(--paper-line)', borderRadius: 'var(--r-sm)', padding: 'var(--s-3)', display: 'grid', gap: 'var(--s-2)' }}>
          <label style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            Reason (required)
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as ReasonCode)} style={{ width: '100%' }}>
              <option value="">— choose —</option>
              {REASON_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {reasonCode === 'OTHER' && <input className="mono" placeholder="note" value={note} onChange={(e) => setNote(e.target.value)} />}
          <p className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>will record: demo-controller · {new Date().toISOString().slice(0, 10)}</p>
          <button className="btn-primary" disabled={!reasonCode || (reasonCode === 'OTHER' && !note) || dispose.isPending}
            onClick={() => reasonCode && submit('dismissed', reasonCode)}>Dismiss this exception</button>
        </div>
      )}
    </div>
  );
}
const ghost: React.CSSProperties = { background: 'none', border: '1px solid var(--paper-line)', borderRadius: 'var(--radius-pill)', padding: 'var(--s-2) var(--s-4)', cursor: 'pointer' };
```

> Implementer: `new Date()` for the display stamp is fine in a browser component (not a workflow script). Match `--r-sm`/`--radius-pill` to real tokens.

- [ ] **Step 4: Implement `ExceptionDetail.tsx`** (DATA zone vs suggestion zone seam, sticky disposition)

```tsx
import { useState } from 'react';
import type { ExceptionDTO } from '../../api/types';
import { ConfidenceBar } from './ConfidenceBar';
import { CopilotDock } from '../chrome/CopilotDock';
import { DecideForm } from './DecideForm';
import { DispositionControls } from './DispositionControls';
import { useCopilot, useDecide } from '../../api/hooks';
import type { CopilotAdvice } from '../../api/types';

export function ExceptionDetail({ exception, entityId }: { exception: ExceptionDTO; entityId: string }) {
  const copilot = useCopilot();
  const decide = useDecide(entityId);
  const [advice, setAdvice] = useState<CopilotAdvice | null>(null);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      {/* DATA ZONE — ledger feel, no mascot */}
      <div className="card" style={{ padding: 'var(--s-6)', background: 'var(--paper-card)' }}>
        <p className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>{exception.exceptionId}</p>
        <p className="font-body">{exception.reason}</p>
        {exception.ai && <ConfidenceBar value={exception.ai.confidence ?? 0} />}
      </div>
      {/* SUGGESTION ZONE — warmer, mascot allowed */}
      {exception.category === 'CLASSIFY_REVIEW' && (
        <>
          <button className="btn-primary" disabled={copilot.isPending} onClick={() => copilot.mutate(exception.eventId, { onSuccess: setAdvice })}>
            {copilot.isPending ? 'Asking…' : 'Ask copilot'}
          </button>
          <CopilotDock advice={advice} loading={copilot.isPending} pose={advice ? 'confident' : 'raising-hand'} />
        </>
      )}
      {/* DECISION ZONE */}
      <div className="card" style={{ padding: 'var(--s-6)', position: 'sticky', bottom: 0 }}>
        {exception.category === 'CLASSIFY_REVIEW' && (
          <DecideForm event={{ id: exception.eventId, ai: exception.ai } as never} draft={null} pending={decide.isPending}
            onDecide={(t, p) => decide.mutate({ eventId: exception.eventId, finalEventType: t, finalPurpose: p })} />
        )}
        <DispositionControls exception={exception} entityId={entityId} />
      </div>
    </div>
  );
}
```

> Implementer: confirm `DecideForm`/`CopilotDock`/`ConfidenceBar` real props (Task 0 reads). The `event` shape DecideForm needs is `EventDTO`; pass a minimal compatible object or fetch the full event. Keep mascot OUT of the DATA/decision card; only CopilotDock carries it.

- [ ] **Step 5: Run tests + build**

Run: `cd web && npx vitest run src/components/data/DispositionControls.test.tsx && npm run build`
Expected: PASS, build exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/data/ExceptionDetail.tsx web/src/components/data/DispositionControls.tsx web/src/components/data/DispositionControls.test.tsx
git commit -m "feat(web): ExceptionDetail (data/suggestion seam) + DispositionControls (dismiss ceremony, anchored read-only)"
```

---

### Task 6: Celebratory EmptyState + RWD + monkey tests + regression

**Files:**
- Modify: `web/src/components/data/EmptyState.tsx`
- Modify: `web/src/index.css` or the workspace's stylesheet (RWD for `.exceptions-layout`)
- Test: `web/src/test/monkey.exceptions.test.tsx`

**Interfaces:**
- Consumes: existing `EmptyState`, `Mascot`.
- Produces: `EmptyState` `variant?: 'clear-seas' | 'pick-one' | undefined`.

- [ ] **Step 1: Implement celebratory EmptyState variant**

Extend `EmptyState` with an optional `variant`. `'clear-seas'`: otter-at-helm mascot, cream bg, `Clear seas · 0 exceptions blocking close`, brass "Period ready to close →" affordance (visual only — clicking switches to `close` workspace via WorkspaceContext if available, else inert). `'pick-one'`: quiet "Select an exception to triage." Default: existing behavior unchanged (regression-safe).

> Implementer: read the current `EmptyState.tsx` first; add the `variant` prop without breaking existing callers (default path identical). Mascot here is correct (celebration zone, §8.4).

- [ ] **Step 2: Write the failing test**

```tsx
// web/src/test/monkey.exceptions.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../components/data/EmptyState';
import { ExceptionList } from '../components/data/ExceptionList';

describe('exceptions monkey', () => {
  it('clear-seas empty state celebrates with a blocking-zero message', () => {
    render(<EmptyState variant="clear-seas" />);
    expect(screen.getByText(/clear seas|ready to close|0 exceptions/i)).toBeInTheDocument();
  });
  it('ExceptionList renders nothing dangerous with empty input', () => {
    const { container } = render(<ExceptionList exceptions={[]} selectedId={null} onSelect={() => {}} />);
    expect(container.querySelectorAll('button').length).toBe(0);
  });
  it('handles a category it does not special-case without crashing', () => {
    // forge an unknown-ish severity ordering; component must not throw
    render(<ExceptionList exceptions={[{ exceptionId: 'RULES_FAILED:x', category: 'RULES_FAILED', eventId: 'x', severity: 3, reason: 'r', amount: null, ai: null, disposition: { state: 'dismissed', reasonCode: 'OTHER', decidedBy: 'a', decidedAt: 0 }, anchoredReadOnly: false }]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/dismissed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then implement variant to pass**

Run: `cd web && npx vitest run src/test/monkey.exceptions.test.tsx`
Expected: FAIL first (variant missing), PASS after Step 1 implementation.

- [ ] **Step 4: RWD — stack-push below 768px**

Add to the workspace stylesheet: below `768px`, `.exceptions-layout` becomes single-column; when a row is selected the list hides and detail is full-width with a back affordance. Simplest robust approach: drive it with a `selectedId` state already in `ExceptionsWorkspace` — render a `‹ Queue · N left` back button (mobile only via CSS) that clears `selectedId`. Add the button in `ExceptionsWorkspace` (visible only when `selected` on narrow widths via a CSS class). Disposition controls already `position: sticky; bottom: 0`.

```css
@media (max-width: 768px) {
  .exceptions-layout { flex-direction: column; }
  .exceptions-layout > .card { flex: 1 1 auto !important; width: 100%; }
}
```

> Implementer: mirror the `!important`-over-inline lesson from Phase 0 — the list card has inline `flex: '0 0 320px'`; the media query must override it (hence `!important`). Verify in a real browser at 375px that the back affordance clears selection and detail is full-width.

- [ ] **Step 5: Full regression + build**

Run: `cd web && npx vitest run && npm run build` and `cd services/api && npx vitest run && npx tsc --noEmit`
Expected: ALL green, build exit 0. Record the new web/api test counts.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/data/EmptyState.tsx web/src/test/monkey.exceptions.test.tsx web/src/index.css web/src/workspaces/ExceptionsWorkspace.tsx
git commit -m "feat(web): celebratory clear-seas empty state + exceptions RWD stack-push + monkey tests"
```

---

## Self-Review

**Spec coverage:**
- §2 categories + recompute-on-read + POSTED-excluded + evaluate purity → Task 1 ✓
- §2.2 composite key / exceptionId → Task 2 (PK) + Task 3 (id parse/validate) ✓
- §3 disposition state machine + reason codes + append log + no-JE invariant → Task 2 ✓
- §4 close gate + anchored read-only → Task 3 (gate, hasAnchoredSnapshot) + Task 5 (UI read-only) ✓
- §5 three endpoints → Task 3 ✓
- §6 master-detail, two-axis encoding, data/suggestion seam, dismiss ceremony, sticky, empty state, RWD → Tasks 4/5/6 ✓
- §7 red team vectors 1–6 → guardrail test (T2), forged/stale id (T3), illegal transition (T2/T3), mass-dismiss reason required (T3/T5), anchored read-only (T5) ✓
- §8 tests incl. monkey → Tasks 1/2/3/6 ✓
- §9 deferred → not implemented by design (recorded in spec) ✓

**Placeholder scan:** Frontend tasks delegate exact token names / hook-helper signatures / test-harness factory to the implementer with explicit "grep the real one" notes rather than guessing — these are codebase-discovery instructions, not lazy placeholders; the logic and assertions are fully specified. Backend tasks have complete code.

**Type consistency:** `collectExceptions(db, entityId, periodId, lowConfidence)` 4-arg signature consistent across Task 1 def, test, and Task 3 caller. `Exception`/`ExceptionDTO`/`DispositionState`/`ReasonCode` names consistent api↔web. `applyDisposition` arg `{...; now}` consistent T2 def/test and T3 caller (`now: Date.now()`).

**Known risk flagged for executor:** Task 3 Step 5 — the close gate may trip pre-existing snapshot route tests if they freeze with un-resolved blocking events seeded. The step instructs to inspect and adjust those tests (dispose-first or confirm seeded events are POSTED/none), documenting the change. This is the one place existing behavior changes.
