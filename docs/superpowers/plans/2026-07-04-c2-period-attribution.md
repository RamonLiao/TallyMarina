# C2 Period Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute every event/JE to a calendar-quarter period deterministically from its `eventTime`, and scope all period-level operations (lock, snapshot, exceptions, cockpit) to that period's own transactions so the cutoff assertion genuinely holds.

**Architecture:** A single pure `periodOf(eventTime)` in rules-engine derives `YYYY-Q{n}` in UTC. `period_id` is materialised on `events` (source of truth) and inherited by `journal_entries`; queries gain period-scoped variants. Event creation flows through an `ingestEvent` gate that computes the period, refuses (and logs) events dated into a LOCKED period, and inserts atomically. Migration backfills existing rows from `eventTime` and asserts no already-anchored period's merkle root changes.

**Tech Stack:** TypeScript, better-sqlite3 (synchronous), Fastify, vitest. Monorepo workspaces: `services/api`, `services/rules-engine`, `services/snapshot-svc`.

**Spec:** `docs/superpowers/specs/2026-07-04-c2-period-attribution-design.md`

## Global Constraints

- `period_id` MUST NOT enter the merkle leaf preimage. `encodeJeLeaf` (`services/rules-engine/src/core/leafCodec.ts:30-45`) and `JE_LEAF_CODEC_VERSION = 'JE_LEAF_BCS_V1'` (`leafCodec.ts:4`) stay untouched. (Spec §6.1 — verified: period_id is absent from preimage today.)
- Exactly ONE quarter implementation: `periodOf` in rules-engine. No second quarter algorithm anywhere (no SQL date math in migration). (Spec §3.2)
- `periodOf` computes in **UTC**. (Spec §3.2)
- `period_id` columns are added **nullable** in SQLite (cannot add NOT-NULL-with-default to a populated table); non-null is **app-enforced** via the write path. (Spec §4)
- Fail-loud: invalid/unparseable `eventTime` → `INVALID_EVENT_TIME`; backfill leaving any `period_id IS NULL` → migration abort; any already-anchored period whose re-derived root changes → migration abort (precondition P1). (Spec §6.2, §7, §8)
- All HTTP error bodies use the existing envelope `{ error: { code, message, details? } }` (`services/api/src/http/client`-consumed shape). (Spec §8)
- `eventTime` is NOT a DB column — it lives inside `events.raw_json` (serialised `NormalizedEvent`, field `eventTime: string` ISO). Extract via `JSON.parse(rawJson).eventTime` (pattern: `services/api/src/http/buildRuleInput.ts:9`). (Spec §3.1)
- Git: stage only named files (`git add <file>...`), never `git add -A`.
- Move `sui move test` is NOT required — no Move contract change (Spec §12, object model confirmed clean).

---

### Task 1: `periodOf` pure function (rules-engine)

**Files:**
- Create: `services/rules-engine/src/core/period.ts`
- Test: `services/rules-engine/src/core/period.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type PeriodId = string` (`'YYYY-Q{1..4}'`); `function periodOf(eventTime: string | Date): PeriodId`. Throws `Error` with message starting `INVALID_EVENT_TIME` on unparseable input.

- [ ] **Step 1: Write the failing test**

```typescript
// services/rules-engine/src/core/period.test.ts
import { describe, it, expect } from 'vitest';
import { periodOf } from './period';

describe('periodOf', () => {
  it('maps months to calendar quarters (UTC)', () => {
    expect(periodOf('2026-01-15T12:00:00Z')).toBe('2026-Q1');
    expect(periodOf('2026-04-01T00:00:00Z')).toBe('2026-Q2');
    expect(periodOf('2026-07-31T23:59:59Z')).toBe('2026-Q3');
    expect(periodOf('2026-12-31T00:00:00Z')).toBe('2026-Q4');
  });

  it('pins quarter boundaries at UTC midnight', () => {
    expect(periodOf('2026-03-31T23:59:59.999Z')).toBe('2026-Q1');
    expect(periodOf('2026-04-01T00:00:00.000Z')).toBe('2026-Q2');
  });

  it('uses UTC, not local time, on a boundary instant', () => {
    // 2026-04-01T00:30:00Z is still Q2 in UTC regardless of host TZ.
    expect(periodOf('2026-04-01T00:30:00Z')).toBe('2026-Q2');
    // An instant that is Mar-31 in UTC but Apr-1 in +14:00 must bin by UTC → Q1.
    expect(periodOf('2026-03-31T22:00:00Z')).toBe('2026-Q1');
  });

  it('handles year rollover', () => {
    expect(periodOf('2027-01-01T00:00:00Z')).toBe('2027-Q1');
    expect(periodOf('2025-12-31T23:59:59Z')).toBe('2025-Q4');
  });

  it('rejects unparseable eventTime with INVALID_EVENT_TIME', () => {
    expect(() => periodOf('not-a-date')).toThrow(/^INVALID_EVENT_TIME/);
    expect(() => periodOf('')).toThrow(/^INVALID_EVENT_TIME/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/rules-engine && npx vitest run src/core/period.test.ts`
Expected: FAIL — `Cannot find module './period'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// services/rules-engine/src/core/period.ts
export type PeriodId = string; // 'YYYY-Q{1..4}'

/**
 * Deterministic calendar-quarter attribution, computed in UTC.
 * UTC is the assumed cutoff timezone (spec §3.2). Single source of truth for
 * the quarter algorithm — do not re-implement quarter math anywhere else.
 */
export function periodOf(eventTime: string | Date): PeriodId {
  const d = eventTime instanceof Date ? eventTime : new Date(eventTime);
  const ms = d.getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`INVALID_EVENT_TIME: cannot parse '${String(eventTime)}'`);
  }
  const year = d.getUTCFullYear();
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1; // getUTCMonth is 0-based
  return `${year}-Q${quarter}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/rules-engine && npx vitest run src/core/period.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Export from the package entrypoint**

Add to `services/rules-engine/src/index.ts` (append near other `core` exports; match existing export style in that file):

```typescript
export { periodOf, type PeriodId } from './core/period';
```

Verify the export resolves: `cd services/rules-engine && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add services/rules-engine/src/core/period.ts services/rules-engine/src/core/period.test.ts services/rules-engine/src/index.ts
git commit -m "feat(c2): periodOf deterministic UTC calendar-quarter attribution"
```

---

### Task 2: Add `period_id` columns + indexes (schema migration)

**Files:**
- Modify: `services/api/src/store/schema.sql` (events 8-16, journal_entries 17-24; add columns to the CREATE TABLE for fresh DBs)
- Modify: `services/api/src/store/db.ts:17-30` (MIGRATIONS array — for existing DBs)
- Test: `services/api/src/store/migration.period.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `events`, `journal_entries`, `exception_disposition`, `exception_disposition_log` each have a nullable `period_id TEXT` column; indexes `idx_events_entity_period`, `idx_je_entity_period`, `idx_expdisp_entity_period`.

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/src/store/migration.period.test.ts
import { describe, it, expect } from 'vitest';
import { openDb } from './db';

describe('period_id schema migration', () => {
  it('adds period_id to events and journal_entries on a fresh DB', () => {
    const db = openDb(':memory:');
    const eventCols = db.prepare(`PRAGMA table_info(events)`).all() as { name: string }[];
    const jeCols = db.prepare(`PRAGMA table_info(journal_entries)`).all() as { name: string }[];
    expect(eventCols.map((c) => c.name)).toContain('period_id');
    expect(jeCols.map((c) => c.name)).toContain('period_id');
  });

  it('adds period_id to exception_disposition tables', () => {
    const db = openDb(':memory:');
    const cols = db.prepare(`PRAGMA table_info(exception_disposition)`).all() as { name: string }[];
    const logCols = db.prepare(`PRAGMA table_info(exception_disposition_log)`).all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('period_id');
    expect(logCols.map((c) => c.name)).toContain('period_id');
  });

  it('creates the entity+period indexes', () => {
    const db = openDb(':memory:');
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as { name: string }[];
    const names = idx.map((i) => i.name);
    expect(names).toContain('idx_events_entity_period');
    expect(names).toContain('idx_je_entity_period');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/store/migration.period.test.ts`
Expected: FAIL — `period_id` not in column list.

- [ ] **Step 3: Add columns to CREATE TABLE (fresh DBs) in schema.sql**

In `services/api/src/store/schema.sql`, add `period_id TEXT` to the `events` and `journal_entries` CREATE TABLE bodies, and to `exception_disposition` / `exception_disposition_log`. Example for events (keep existing columns; add the line before the closing paren):

```sql
CREATE TABLE IF NOT EXISTS events (
  -- ... existing columns unchanged ...
  period_id TEXT
);
```

Append the indexes at the end of schema.sql:

```sql
CREATE INDEX IF NOT EXISTS idx_events_entity_period ON events (entity_id, period_id);
CREATE INDEX IF NOT EXISTS idx_je_entity_period ON journal_entries (entity_id, period_id);
CREATE INDEX IF NOT EXISTS idx_expdisp_entity_period ON exception_disposition (entity_id, period_id);
```

- [ ] **Step 4: Add ALTER migrations (existing DBs) to db.ts**

Append to the `MIGRATIONS` array in `services/api/src/store/db.ts:17-30` (the loop already swallows `duplicate column` errors, so these are idempotent):

```typescript
  'ALTER TABLE events ADD COLUMN period_id TEXT',
  'ALTER TABLE journal_entries ADD COLUMN period_id TEXT',
  'ALTER TABLE exception_disposition ADD COLUMN period_id TEXT',
  'ALTER TABLE exception_disposition_log ADD COLUMN period_id TEXT',
```

The `CREATE INDEX IF NOT EXISTS` statements from schema.sql run via `db.exec(SCHEMA)` on every open, so they apply to existing DBs too.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/api && npx vitest run src/store/migration.period.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/api/src/store/schema.sql services/api/src/store/db.ts services/api/src/store/migration.period.test.ts
git commit -m "feat(c2): add nullable period_id columns + entity-period indexes"
```

---

### Task 3: Backfill existing rows + verification + P1 anchor precondition + audit record

**Files:**
- Create: `services/api/src/store/backfillPeriod.ts`
- Modify: `services/api/src/store/db.ts` (call `backfillPeriodIds(db)` inside `openDb` after migrations)
- Test: `services/api/src/store/backfillPeriod.test.ts`

**Interfaces:**
- Consumes: `periodOf` (Task 1).
- Produces: `function backfillPeriodIds(db: Db): { events: number; journalEntries: number }` — idempotent; only touches rows where `period_id IS NULL`; throws `Error('INVALID_EVENT_TIME: ...')` if any event's `raw_json` lacks a parseable `eventTime`, throws `Error('MIGRATION_PERIOD_NULL_RESIDUAL')` if any `events.period_id` remains null after backfill, throws `Error('MIGRATION_P1_ANCHOR_ROOT_CHANGED: ...')` if precondition P1 fails. Emits one `console.info` audit line.

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/src/store/backfillPeriod.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { backfillPeriodIds } from './backfillPeriod';

function legacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY, entity_id TEXT, raw_json TEXT, status TEXT, period_id TEXT);
    CREATE TABLE journal_entries (id TEXT PRIMARY KEY, entity_id TEXT, event_id TEXT, je_json TEXT, idempotency_key TEXT, leaf_hash TEXT, period_id TEXT);
    CREATE TABLE snapshots (id TEXT, entity_id TEXT, period_id TEXT, merkle_root TEXT, status TEXT);
  `);
  db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES (?, ?, ?, 'INGESTED')`)
    .run('e1', 'acme', JSON.stringify({ eventTime: '2026-02-10T00:00:00Z' }));
  db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES (?, ?, ?, 'INGESTED')`)
    .run('e2', 'acme', JSON.stringify({ eventTime: '2026-05-10T00:00:00Z' }));
  db.prepare(`INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash) VALUES ('j1','acme','e1','{}','k1','h1')`).run();
  return db;
}

describe('backfillPeriodIds', () => {
  it('sets period_id from eventTime on events and inherits to JEs', () => {
    const db = legacyDb();
    backfillPeriodIds(db as any);
    const e1 = db.prepare(`SELECT period_id FROM events WHERE id='e1'`).get() as { period_id: string };
    const e2 = db.prepare(`SELECT period_id FROM events WHERE id='e2'`).get() as { period_id: string };
    const j1 = db.prepare(`SELECT period_id FROM journal_entries WHERE id='j1'`).get() as { period_id: string };
    expect(e1.period_id).toBe('2026-Q1');
    expect(e2.period_id).toBe('2026-Q2');
    expect(j1.period_id).toBe('2026-Q1'); // inherited from source event e1
  });

  it('is idempotent — only fills nulls', () => {
    const db = legacyDb();
    backfillPeriodIds(db as any);
    const again = backfillPeriodIds(db as any);
    expect(again.events).toBe(0);
  });

  it('aborts fail-loud when an event has unparseable eventTime', () => {
    const db = legacyDb();
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('bad','acme','{"eventTime":"garbage"}','INGESTED')`).run();
    expect(() => backfillPeriodIds(db as any)).toThrow(/INVALID_EVENT_TIME/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/store/backfillPeriod.test.ts`
Expected: FAIL — `Cannot find module './backfillPeriod'`.

- [ ] **Step 3: Write the implementation**

```typescript
// services/api/src/store/backfillPeriod.ts
import type { Database as Db } from 'better-sqlite3';
import { periodOf } from '@subledger/rules-engine';

/**
 * One-time, idempotent backfill of period_id from each event's raw_json.eventTime.
 * Runs the SAME periodOf as the write path — no second quarter algorithm (spec §3.2).
 * Fail-loud on unparseable time, residual nulls, or P1 anchor-root change (spec §6.2, §7).
 */
export function backfillPeriodIds(db: Db): { events: number; journalEntries: number } {
  const nullEvents = db
    .prepare(`SELECT id, raw_json FROM events WHERE period_id IS NULL`)
    .all() as { id: string; raw_json: string }[];

  const setEvent = db.prepare(`UPDATE events SET period_id = ? WHERE id = ?`);
  let events = 0;
  for (const row of nullEvents) {
    let eventTime: string;
    try {
      eventTime = (JSON.parse(row.raw_json) as { eventTime: string }).eventTime;
    } catch {
      throw new Error(`INVALID_EVENT_TIME: event ${row.id} has unparseable raw_json`);
    }
    const pid = periodOf(eventTime); // throws INVALID_EVENT_TIME on bad time
    setEvent.run(pid, row.id);
    events++;
  }

  // JEs inherit from their source event.
  const je = db
    .prepare(
      `UPDATE journal_entries
         SET period_id = (SELECT e.period_id FROM events e WHERE e.id = journal_entries.event_id)
       WHERE period_id IS NULL`,
    )
    .run();

  // Verification gate: zero residual nulls on events.
  const residual = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE period_id IS NULL`).get() as { n: number };
  if (residual.n > 0) {
    throw new Error(`MIGRATION_PERIOD_NULL_RESIDUAL: ${residual.n} events still null`);
  }

  // Precondition P1 (spec §6.2): no already-anchored entity may span >1 period,
  // else re-slicing would change an already-committed on-chain root.
  const anchoredMultiPeriod = db
    .prepare(
      `SELECT s.entity_id, COUNT(DISTINCT e.period_id) AS periods
         FROM snapshots s
         JOIN events e ON e.entity_id = s.entity_id
        WHERE s.status = 'ANCHORED'
        GROUP BY s.entity_id
       HAVING periods > 1`,
    )
    .all() as { entity_id: string; periods: number }[];
  if (anchoredMultiPeriod.length > 0) {
    throw new Error(
      `MIGRATION_P1_ANCHOR_ROOT_CHANGED: anchored entities span multiple periods: ${anchoredMultiPeriod
        .map((r) => r.entity_id)
        .join(',')} — restatement is H2, aborting`,
    );
  }

  // Audit record (spec §7 step 8).
  console.info(
    `[c2-migration] backfilled period_id: events=${events} journalEntries=${je.changes} ` +
      `codec=JE_LEAF_BCS_V1 no-anchored-root-change=verified`,
  );
  return { events, journalEntries: je.changes as number };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run src/store/backfillPeriod.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into openDb**

In `services/api/src/store/db.ts`, after the MIGRATIONS loop and before `return db`, add:

```typescript
import { backfillPeriodIds } from './backfillPeriod';
// ... inside openDb, after the MIGRATIONS for-loop:
backfillPeriodIds(db);
```

Verify types: `cd services/api && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/store/backfillPeriod.ts services/api/src/store/backfillPeriod.test.ts services/api/src/store/db.ts
git commit -m "feat(c2): backfill period_id from eventTime with fail-loud + P1 anchor gate"
```

---

### Task 4: `insertEvent` computes & stores period_id; EventRow exposes it

**Files:**
- Modify: `services/api/src/store/eventStore.ts` (EventRow 4-10, insertEvent 26-29, listEvents 36)
- Test: `services/api/src/store/eventStore.period.test.ts`

**Interfaces:**
- Consumes: `periodOf` (Task 1).
- Produces: `EventRow` gains `periodId: string | null`; `insertEvent(db, e)` computes `period_id = periodOf(JSON.parse(e.rawJson).eventTime)` and stores it, throwing `INVALID_EVENT_TIME` on bad time; a new `deriveEventPeriod(rawJson: string): string` helper is exported for reuse by the ingest gate (Task 5).

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/src/store/eventStore.period.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { insertEvent, listEvents, deriveEventPeriod } from './eventStore';

function freshEventsDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, entity_id TEXT, raw_json TEXT,
    ai_event_type TEXT, ai_purpose TEXT, ai_counterparty TEXT, ai_confidence REAL,
    ai_reasoning TEXT, final_event_type TEXT, final_purpose TEXT, status TEXT, period_id TEXT)`);
  return db;
}

describe('insertEvent period attribution', () => {
  it('stores period_id derived from raw_json.eventTime', () => {
    const db = freshEventsDb();
    insertEvent(db as any, { id: 'e1', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }) });
    const rows = listEvents(db as any, 'acme');
    expect(rows[0].periodId).toBe('2026-Q2');
  });

  it('throws INVALID_EVENT_TIME on unparseable time', () => {
    const db = freshEventsDb();
    expect(() =>
      insertEvent(db as any, { id: 'bad', entityId: 'acme', rawJson: JSON.stringify({ eventTime: 'nope' }) }),
    ).toThrow(/INVALID_EVENT_TIME/);
  });

  it('deriveEventPeriod extracts period from rawJson', () => {
    expect(deriveEventPeriod(JSON.stringify({ eventTime: '2026-08-01T00:00:00Z' }))).toBe('2026-Q3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/store/eventStore.period.test.ts`
Expected: FAIL — `deriveEventPeriod` is not exported / `periodId` undefined.

- [ ] **Step 3: Implement**

In `services/api/src/store/eventStore.ts`:

Add import at top:
```typescript
import { periodOf } from '@subledger/rules-engine';
```

Add `periodId` to `EventRow` (after `status`):
```typescript
  status: EventStatus;
  periodId: string | null;
```

Add the helper (near top of file, after imports):
```typescript
export function deriveEventPeriod(rawJson: string): string {
  let eventTime: string;
  try {
    eventTime = (JSON.parse(rawJson) as { eventTime: string }).eventTime;
  } catch {
    throw new Error('INVALID_EVENT_TIME: raw_json is not valid JSON');
  }
  return periodOf(eventTime); // throws INVALID_EVENT_TIME on bad time
}
```

Change `insertEvent` (26-29) to compute and store period_id:
```typescript
export function insertEvent(db: Db, e: { id: string; entityId: string; rawJson: string }): void {
  const periodId = deriveEventPeriod(e.rawJson);
  db.prepare(
    `INSERT INTO events (id, entity_id, raw_json, status, period_id) VALUES (?, ?, ?, ?, ?)`,
  ).run(e.id, e.entityId, e.rawJson, 'INGESTED', periodId);
}
```

Ensure `listEvents` maps the new column. If it uses `SELECT *` with a row mapper, add `periodId: row.period_id` to the mapper; if it returns raw rows, ensure the DTO includes `period_id`→`periodId`. (Match the existing mapping style in eventStore.ts.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run src/store/eventStore.period.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify existing event tests still pass**

Run: `cd services/api && npx vitest run src/store/`
Expected: PASS (no regressions in eventStore/seed tests).

- [ ] **Step 6: Commit**

```bash
git add services/api/src/store/eventStore.ts services/api/src/store/eventStore.period.test.ts
git commit -m "feat(c2): insertEvent stores period_id; EventRow.periodId; deriveEventPeriod helper"
```

---

### Task 5: Ingest gate — `ingestEvent` + rejected-events log + create-event HTTP route

**Files:**
- Modify: `services/api/src/store/schema.sql` (new `rejected_event_log` table)
- Modify: `services/api/src/store/db.ts` (no ALTER needed — new table via schema.sql `CREATE TABLE IF NOT EXISTS`)
- Create: `services/api/src/store/rejectedEventLog.ts`
- Create: `services/api/src/http/ingestEvent.ts`
- Modify: `services/api/src/http/routes.ts` (register `POST /entities/:id/events`)
- Test: `services/api/src/http/ingestEvent.test.ts`

**Interfaces:**
- Consumes: `deriveEventPeriod`, `insertEvent` (Task 4); `getPeriodLock` (`services/api/src/periodLock/store.ts:27`).
- Produces: `function ingestEvent(db, entityId, rawJson): { eventId, periodId }` — atomic (better-sqlite3 `db.transaction`); throws `PeriodLockedError { periodId, eventTime }` if the target period is LOCKED, after appending a `rejected_event_log` row; `appendRejectedEvent(db, row)`; route `POST /entities/:id/events` → 201 `{ eventId, periodId }` on success, 409 `{ error: { code:'PERIOD_LOCKED_FOR_DATE', message, details:{ periodId, eventTime } } }` on locked, 400 `INVALID_EVENT_TIME` on bad time.

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/src/http/ingestEvent.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { ingestEvent, PeriodLockedError } from './ingestEvent';
import { lockPeriod } from '../periodLock/store';

function db() {
  const d = new Database(':memory:');
  d.exec(readFileSync(new URL('../store/schema.sql', import.meta.url), 'utf8'));
  return d;
}

describe('ingestEvent gate', () => {
  it('inserts an event into an OPEN period', () => {
    const d = db();
    const r = ingestEvent(d as any, 'acme', JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }));
    expect(r.periodId).toBe('2026-Q2');
    const row = d.prepare(`SELECT period_id FROM events WHERE id=?`).get(r.eventId) as { period_id: string };
    expect(row.period_id).toBe('2026-Q2');
  });

  it('rejects + logs an event dated into a LOCKED period, without inserting', () => {
    const d = db();
    lockPeriod(d as any, 'acme', '2026-Q1', /* lockedBy */ 'tester');
    let err: any;
    try {
      ingestEvent(d as any, 'acme', JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }));
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PeriodLockedError);
    expect(err.periodId).toBe('2026-Q1');
    const inserted = d.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number };
    expect(inserted.n).toBe(0); // not inserted
    const logged = d.prepare(`SELECT period_id, event_time FROM rejected_event_log`).get() as { period_id: string; event_time: string };
    expect(logged.period_id).toBe('2026-Q1'); // logged, not silently dropped
    expect(logged.event_time).toBe('2026-02-01T00:00:00Z');
  });
});
```

> **Confirm at implementation time:** the exact `lockPeriod` signature (`services/api/src/periodLock/store.ts:38-58`). If it takes an options object rather than positional `lockedBy`, adapt the test call. The behaviour asserted (locked→reject+log) is what matters.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/http/ingestEvent.test.ts`
Expected: FAIL — `Cannot find module './ingestEvent'`.

- [ ] **Step 3: Add the rejected_event_log table to schema.sql**

```sql
CREATE TABLE IF NOT EXISTS rejected_event_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  event_time TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  rejected_at TEXT NOT NULL
);
```

- [ ] **Step 4: Implement rejectedEventLog.ts**

```typescript
// services/api/src/store/rejectedEventLog.ts
import type { Database as Db } from 'better-sqlite3';

export function appendRejectedEvent(
  db: Db,
  row: { entityId: string; periodId: string; eventTime: string; rawJson: string; reason: string },
): void {
  db.prepare(
    `INSERT INTO rejected_event_log (entity_id, period_id, event_time, raw_json, reason, rejected_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.entityId, row.periodId, row.eventTime, row.rawJson, row.reason, new Date().toISOString());
}
```

- [ ] **Step 5: Implement ingestEvent.ts (atomic gate)**

```typescript
// services/api/src/http/ingestEvent.ts
import type { Database as Db } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { deriveEventPeriod, insertEvent } from '../store/eventStore';
import { appendRejectedEvent } from '../store/rejectedEventLog';
import { getPeriodLock } from '../periodLock/store';

export class PeriodLockedError extends Error {
  constructor(public periodId: string, public eventTime: string) {
    super(`PERIOD_LOCKED_FOR_DATE: ${periodId}`);
    this.name = 'PeriodLockedError';
  }
}

/** Atomic ingest gate: derive period, refuse+log if LOCKED, else insert (spec §5.2). */
export function ingestEvent(db: Db, entityId: string, rawJson: string): { eventId: string; periodId: string } {
  const periodId = deriveEventPeriod(rawJson); // throws INVALID_EVENT_TIME
  const eventTime = (JSON.parse(rawJson) as { eventTime: string }).eventTime;
  const eventId = `evt-${randomUUID()}`;

  const tx = db.transaction(() => {
    if (getPeriodLock(db, entityId, periodId).status === 'LOCKED') {
      appendRejectedEvent(db, { entityId, periodId, eventTime, rawJson, reason: 'PERIOD_LOCKED_FOR_DATE' });
      throw new PeriodLockedError(periodId, eventTime);
    }
    insertEvent(db, { id: eventId, entityId, rawJson });
  });
  tx();
  return { eventId, periodId };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/api && npx vitest run src/http/ingestEvent.test.ts`
Expected: PASS (2 tests).

> Note: better-sqlite3 rolls back the transaction when the callback throws, so the `appendRejectedEvent` write is also rolled back — the log row would vanish. To keep the audit row, append **outside** the transaction: run the lock check first, and if LOCKED, append + throw before opening `tx`. Restructure Step 5 so the lock check and rejected-log append happen before `db.transaction`, and only the insert is inside the transaction. Re-run the test to confirm the `rejected_event_log` row persists.

- [ ] **Step 7: Register the HTTP route in routes.ts**

Add near the other event routes:

```typescript
import { ingestEvent, PeriodLockedError } from './ingestEvent';

app.post<{ Params: { id: string }; Body: { event: unknown } }>(
  '/entities/:id/events',
  async (req, reply) => {
    try {
      const rawJson = JSON.stringify(req.body.event);
      const { eventId, periodId } = ingestEvent(db, req.params.id, rawJson);
      return reply.code(201).send({ eventId, periodId });
    } catch (e) {
      if (e instanceof PeriodLockedError) {
        return reply.code(409).send({
          error: { code: 'PERIOD_LOCKED_FOR_DATE', message: e.message, details: { periodId: e.periodId, eventTime: e.eventTime } },
        });
      }
      if (e instanceof Error && e.message.startsWith('INVALID_EVENT_TIME')) {
        return reply.code(400).send({ error: { code: 'INVALID_EVENT_TIME', message: e.message } });
      }
      throw e;
    }
  },
);
```

- [ ] **Step 8: Verify + commit**

Run: `cd services/api && npx vitest run src/http/ingestEvent.test.ts && npx tsc --noEmit`
Expected: PASS + exit 0.

```bash
git add services/api/src/store/schema.sql services/api/src/store/rejectedEventLog.ts services/api/src/http/ingestEvent.ts services/api/src/http/ingestEvent.test.ts services/api/src/http/routes.ts
git commit -m "feat(c2): ingest gate rejects+logs mis-period into locked periods (409)"
```

---

### Task 6: JE inherits period_id (run-rules path)

**Files:**
- Modify: `services/api/src/store/journalStore.ts` (JournalRow 4-6, insertJournalEntry 8-17)
- Modify: `services/api/src/http/routes.ts:361-371` (pass `periodId: ev.periodId`)
- Test: `services/api/src/store/journalStore.period.test.ts`

**Interfaces:**
- Consumes: `EventRow.periodId` (Task 4), schema column (Task 2).
- Produces: `JournalRow` gains `periodId: string | null`; `insertJournalEntry` stores it.

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/src/store/journalStore.period.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { insertJournalEntry, listJournal } from './journalStore';

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE journal_entries (id TEXT PRIMARY KEY, entity_id TEXT, event_id TEXT,
    je_json TEXT, idempotency_key TEXT, leaf_hash TEXT, period_id TEXT)`);
  return d;
}

describe('JE period inheritance', () => {
  it('stores period_id passed from the source event', () => {
    const d = db();
    insertJournalEntry(d as any, {
      id: 'je1', entityId: 'acme', eventId: 'e1', jeJson: '{}',
      idempotencyKey: 'k1', leafHash: 'h1', periodId: '2026-Q2',
    });
    const rows = listJournal(d as any, 'acme');
    expect(rows[0].periodId).toBe('2026-Q2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/store/journalStore.period.test.ts`
Expected: FAIL — `periodId` not accepted / not stored.

- [ ] **Step 3: Implement**

In `services/api/src/store/journalStore.ts`, add `periodId: string | null` to `JournalRow`, and update `insertJournalEntry` INSERT to include `period_id`:

```typescript
export interface JournalRow {
  id: string; entityId: string; eventId: string; jeJson: string;
  idempotencyKey: string; leafHash: string; periodId: string | null;
}

export function insertJournalEntry(db: Db, r: JournalRow): 'inserted' | 'skipped' {
  const info = db.prepare(
    `INSERT OR IGNORE INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.id, r.entityId, r.eventId, r.jeJson, r.idempotencyKey, r.leafHash, r.periodId);
  return info.changes > 0 ? 'inserted' : 'skipped';
}
```

Ensure `listJournal` maps `period_id`→`periodId` (match existing mapper style).

- [ ] **Step 4: Wire run-rules to pass the source event's period**

In `services/api/src/http/routes.ts:361-371`, add `periodId: ev.periodId` to the `insertJournalEntry` call:

```typescript
  const res = insertJournalEntry(db, {
    id: `je-${ev.id}-${je.idempotencyKey}`,
    entityId: req.params.id,
    eventId: ev.id,
    jeJson: JSON.stringify(je),
    idempotencyKey: je.idempotencyKey,
    leafHash: leafHash(je),
    periodId: ev.periodId, // inherit from source event (spec §5.2.4)
  });
```

- [ ] **Step 5: Verify + commit**

Run: `cd services/api && npx vitest run src/store/journalStore.period.test.ts && npx tsc --noEmit`
Expected: PASS + exit 0.

```bash
git add services/api/src/store/journalStore.ts services/api/src/store/journalStore.period.test.ts services/api/src/http/routes.ts
git commit -m "feat(c2): journal entries inherit period_id from source event"
```

---

### Task 7: Period-scoped queries (the slicing)

**Files:**
- Modify: `services/api/src/store/eventStore.ts` (add `listEventsByPeriod`)
- Modify: `services/api/src/store/journalStore.ts` (`listJournal` gains optional `periodId`)
- Modify: `services/api/src/exceptions/collect.ts` (`collectExceptions` takes `periodId`, uses `listEventsByPeriod`)
- Test: `services/api/src/exceptions/collect.period.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 6.
- Produces: `listEventsByPeriod(db, entityId, periodId): EventRow[]`; `listJournal(db, entityId, periodId?)` (when `periodId` given, filters); `collectExceptions(db, entityId, periodId, ...)` scans only that period.

- [ ] **Step 1: Write the failing test (core intent — must fail under old all-history behavior)**

```typescript
// services/api/src/exceptions/collect.period.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { insertEvent, listEventsByPeriod } from '../store/eventStore';

function db() {
  const d = new Database(':memory:');
  d.exec(readFileSync(new URL('../store/schema.sql', import.meta.url), 'utf8'));
  return d;
}

describe('period-scoped event query', () => {
  it('listEventsByPeriod returns ONLY the requested period (not all history)', () => {
    const d = db();
    insertEvent(d as any, { id: 'q1a', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }) });
    insertEvent(d as any, { id: 'q2a', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }) });
    const q1 = listEventsByPeriod(d as any, 'acme', '2026-Q1');
    expect(q1.map((e) => e.id)).toEqual(['q1a']); // fails if it returned all history
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/exceptions/collect.period.test.ts`
Expected: FAIL — `listEventsByPeriod` not exported.

- [ ] **Step 3: Implement listEventsByPeriod**

In `services/api/src/store/eventStore.ts` (mirror `listEvents` at :36):

```typescript
export function listEventsByPeriod(db: Db, entityId: string, periodId: string): EventRow[] {
  const rows = db
    .prepare(`SELECT * FROM events WHERE entity_id = ? AND period_id = ? ORDER BY id`)
    .all(entityId, periodId) as any[];
  return rows.map(/* same row→EventRow mapper listEvents uses, incl. periodId: row.period_id */);
}
```

- [ ] **Step 4: Add optional periodId to listJournal**

In `services/api/src/store/journalStore.ts:19-25`:

```typescript
export function listJournal(db: Db, entityId: string, periodId?: string): JournalRow[] {
  const sql = periodId
    ? `SELECT * FROM journal_entries WHERE entity_id = ? AND period_id = ? ORDER BY idempotency_key`
    : `SELECT * FROM journal_entries WHERE entity_id = ? ORDER BY idempotency_key`;
  const rows = (periodId ? db.prepare(sql).all(entityId, periodId) : db.prepare(sql).all(entityId)) as any[];
  return rows.map(/* existing row→JournalRow mapper, incl. periodId: row.period_id */);
}
```

- [ ] **Step 5: Scope collectExceptions**

In `services/api/src/exceptions/collect.ts`, change `collectExceptions` to accept `periodId` and call `listEventsByPeriod(db, entityId, periodId)` instead of `listEvents(db, entityId)`. Keep all other logic. Update its callers (found in routes.ts — the cockpit/collect paths) to pass the period; those callers are converted in Task 9.

> **Confirm at implementation time:** `collectExceptions`'s exact current signature and the `listEvents` call site inside it (`services/api/src/exceptions/collect.ts:34,42`).

- [ ] **Step 6: Verify + commit**

Run: `cd services/api && npx vitest run src/exceptions/collect.period.test.ts && npx tsc --noEmit`
Expected: PASS + exit 0. (tsc will flag callers of `collectExceptions`/`listJournal` needing a periodId — those are fixed in Tasks 8–9; if tsc fails only on those call sites, proceed and fix in the dependent tasks, or stub the call sites minimally here.)

```bash
git add services/api/src/store/eventStore.ts services/api/src/store/journalStore.ts services/api/src/exceptions/collect.ts services/api/src/exceptions/collect.period.test.ts
git commit -m "feat(c2): period-scoped listEventsByPeriod/listJournal/collectExceptions"
```

---

### Task 8: Snapshot uses per-period JE set

**Files:**
- Modify: `services/api/src/http/routes.ts:648` (pass periodId to `listJournal`)
- Test: `services/api/src/http/snapshot.period.test.ts`

**Interfaces:**
- Consumes: `listJournal(db, entityId, periodId)` (Task 7).
- Produces: the snapshot build at routes.ts:648 selects only the target period's JEs.

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/src/http/snapshot.period.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { insertJournalEntry, listJournal } from '../store/journalStore';

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE journal_entries (id TEXT PRIMARY KEY, entity_id TEXT, event_id TEXT,
    je_json TEXT, idempotency_key TEXT, leaf_hash TEXT, period_id TEXT)`);
  return d;
}

describe('snapshot JE set is period-scoped', () => {
  it('counts only the target period JEs', () => {
    const d = db();
    insertJournalEntry(d as any, { id: 'j1', entityId: 'acme', eventId: 'e1', jeJson: '{}', idempotencyKey: 'k1', leafHash: 'h1', periodId: '2026-Q1' });
    insertJournalEntry(d as any, { id: 'j2', entityId: 'acme', eventId: 'e2', jeJson: '{}', idempotencyKey: 'k2', leafHash: 'h2', periodId: '2026-Q2' });
    expect(listJournal(d as any, 'acme', '2026-Q1').length).toBe(1);
    expect(listJournal(d as any, 'acme', '2026-Q2').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails / passes**

Run: `cd services/api && npx vitest run src/http/snapshot.period.test.ts`
Expected: PASS at the store level (Task 7 already added the filter) — this test guards the contract. If it passes immediately, that is acceptable; proceed to wire the route.

- [ ] **Step 3: Wire the route**

At `services/api/src/http/routes.ts:648`, change:
```typescript
const jes: JournalEntry[] = listJournal(db, req.params.id).map(...)
```
to pass the resolved period for the snapshot being built:
```typescript
const jes: JournalEntry[] = listJournal(db, req.params.id, periodId).map(...)
```
where `periodId` is the period the snapshot/lock flow is operating on (the same value the enclosing route resolves — from `req.body.periodId`, converted in Task 9).

- [ ] **Step 4: Verify + commit**

Run: `cd services/api && npx vitest run src/http/snapshot.period.test.ts && npx tsc --noEmit`
Expected: PASS + exit 0.

```bash
git add services/api/src/http/routes.ts services/api/src/http/snapshot.period.test.ts
git commit -m "feat(c2): snapshot selects only the target period's journal entries"
```

---

### Task 9: Route layer — required periodId params, derive on /decide, drop DEFAULT_PERIOD

**Files:**
- Modify: `services/api/src/http/routes.ts` (DEFAULT_PERIOD 74; /reviews/:eventId/decide 320-339; /run-rules 342; /period/lock 416; /cockpit; collectExceptions callers)
- Test: `services/api/src/http/routes.period.test.ts`

**Interfaces:**
- Consumes: `EventRow.periodId` (Task 4), `collectExceptions(periodId)` (Task 7).
- Produces: `GET /cockpit` and `POST /period/lock` require `periodId` (400 `PERIOD_ID_REQUIRED` otherwise); `POST /reviews/:eventId/decide` derives period from the target event's `periodId`; `DEFAULT_PERIOD` removed.

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/src/http/routes.period.test.ts
// Use the app factory (registerRoutes + app.inject) as other route tests do.
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './testApp'; // confirm the existing test-app helper name/path

describe('route periodId contract', () => {
  it('GET cockpit without periodId → 400 PERIOD_ID_REQUIRED', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/entities/acme/cockpit' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PERIOD_ID_REQUIRED');
  });

  it('POST period/lock without periodId → 400 PERIOD_ID_REQUIRED', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/entities/acme/period/lock', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PERIOD_ID_REQUIRED');
  });
});
```

> **Confirm at implementation time:** the existing test-app / `app.inject` harness name and path (the e2e Layer-2 harness `registerRoutes(app, deps)` exists per prior specs). Match whatever the current route tests import.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/http/routes.period.test.ts`
Expected: FAIL — cockpit currently defaults to DEFAULT_PERIOD (200, not 400).

- [ ] **Step 3: Implement**

In `services/api/src/http/routes.ts`:
- Delete `const DEFAULT_PERIOD = '2026-Q2'` (line 74) and every reference.
- `GET /cockpit`: read `const periodId = (req.query as { periodId?: string }).periodId; if (!periodId) return reply.code(400).send({ error: { code: 'PERIOD_ID_REQUIRED', message: 'periodId query param is required' } });` Use `periodId` for the cockpit's `getPeriodLock` and `collectExceptions(db, entityId, periodId, ...)`.
- `POST /period/lock` (416): `const periodId = (req.body as { periodId?: string }).periodId; if (!periodId) return reply.code(400).send({ error: { code: 'PERIOD_ID_REQUIRED', message: 'periodId is required' } });` (remove the `?? DEFAULT_PERIOD`).
- `POST /reviews/:eventId/decide` (320-339): after loading `ev`, use `ev.periodId` (throw/skip if null) instead of `DEFAULT_PERIOD` for the `getPeriodLock` check.
- `POST /run-rules` (342): resolve `periodId` from `req.body.periodId` if present, else derive per-event from `ev.periodId` when building JEs (Task 6 already passes `ev.periodId`); the `buildRuleInput` `periodId`/`periodOpen` should use the event's own period.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && npx vitest run src/http/routes.period.test.ts`
Expected: PASS.

- [ ] **Step 5: Full api suite (catch DEFAULT_PERIOD removal fallout)**

Run: `cd services/api && npx vitest run && npx tsc --noEmit`
Expected: PASS + exit 0. Fix any test that assumed the implicit `2026-Q2` default by passing an explicit `periodId`.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/http/routes.ts services/api/src/http/routes.period.test.ts
git commit -m "feat(c2): require explicit periodId on cockpit/lock, derive on decide, drop DEFAULT_PERIOD"
```

---

### Task 10: `GET /entities/:id/periods` endpoint (frontend blocker)

**Files:**
- Create: `services/api/src/store/periodQuery.ts`
- Modify: `services/api/src/http/routes.ts` (register route)
- Test: `services/api/src/store/periodQuery.test.ts`

**Interfaces:**
- Consumes: `getPeriodLock` (`periodLock/store.ts:27`).
- Produces: `listPeriods(db, entityId): { periodId: string; lockStatus: 'OPEN'|'LOCKED' }[]` (ascending); route `GET /entities/:id/periods` returns that array.

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/src/store/periodQuery.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { insertEvent } from './eventStore';
import { lockPeriod } from '../periodLock/store';
import { listPeriods } from './periodQuery';

function db() {
  const d = new Database(':memory:');
  d.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return d;
}

describe('listPeriods', () => {
  it('returns distinct periods ascending with lock status', () => {
    const d = db();
    insertEvent(d as any, { id: 'a', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }) });
    insertEvent(d as any, { id: 'b', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }) });
    lockPeriod(d as any, 'acme', '2026-Q1', 'tester');
    const out = listPeriods(d as any, 'acme');
    expect(out).toEqual([
      { periodId: '2026-Q1', lockStatus: 'LOCKED' },
      { periodId: '2026-Q2', lockStatus: 'OPEN' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run src/store/periodQuery.test.ts`
Expected: FAIL — `Cannot find module './periodQuery'`.

- [ ] **Step 3: Implement**

```typescript
// services/api/src/store/periodQuery.ts
import type { Database as Db } from 'better-sqlite3';
import { getPeriodLock } from '../periodLock/store';

export function listPeriods(db: Db, entityId: string): { periodId: string; lockStatus: 'OPEN' | 'LOCKED' }[] {
  const rows = db
    .prepare(`SELECT DISTINCT period_id AS periodId FROM events WHERE entity_id = ? ORDER BY period_id ASC`)
    .all(entityId) as { periodId: string }[];
  return rows.map((r) => ({
    periodId: r.periodId,
    lockStatus: getPeriodLock(db, entityId, r.periodId).status === 'LOCKED' ? 'LOCKED' : 'OPEN',
  }));
}
```

- [ ] **Step 4: Register the route**

```typescript
import { listPeriods } from '../store/periodQuery';

app.get<{ Params: { id: string } }>('/entities/:id/periods', async (req) => {
  return listPeriods(db, req.params.id);
});
```

- [ ] **Step 5: Verify + commit**

Run: `cd services/api && npx vitest run src/store/periodQuery.test.ts && npx tsc --noEmit`
Expected: PASS + exit 0.

```bash
git add services/api/src/store/periodQuery.ts services/api/src/store/periodQuery.test.ts services/api/src/http/routes.ts
git commit -m "feat(c2): GET /entities/:id/periods with lock status (frontend contract)"
```

---

### Task 11: Triage sweep over all OPEN periods

**Files:**
- Modify: `services/api/src/http/routes.ts` (POST /run + scheduler start; whatever pins DEFAULT_PERIOD in the triage path)
- Test: `services/api/src/http/triageSweep.period.test.ts`

**Interfaces:**
- Consumes: `listPeriods` (Task 10).
- Produces: the triage run/scheduler iterates each OPEN period from `listPeriods`; off-chain only (no anchor).

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/src/http/triageSweep.period.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { insertEvent } from '../store/eventStore';
import { listPeriods } from '../store/periodQuery';

function db() {
  const d = new Database(':memory:');
  d.exec(readFileSync(new URL('../store/schema.sql', import.meta.url), 'utf8'));
  return d;
}

describe('triage sweep period set', () => {
  it('sweep targets every OPEN period returned by listPeriods', () => {
    const d = db();
    insertEvent(d as any, { id: 'a', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }) });
    insertEvent(d as any, { id: 'b', entityId: 'acme', rawJson: JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }) });
    const open = listPeriods(d as any, 'acme').filter((p) => p.lockStatus === 'OPEN').map((p) => p.periodId);
    expect(open).toEqual(['2026-Q1', '2026-Q2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails/passes**

Run: `cd services/api && npx vitest run src/http/triageSweep.period.test.ts`
Expected: PASS at query level (guards the sweep set). Then wire the sweep loop.

- [ ] **Step 3: Implement the sweep**

In the triage `POST /run` handler and `startTriageScheduler`, replace the pinned `DEFAULT_PERIOD` with a loop over `listPeriods(db, entityId).filter(p => p.lockStatus === 'OPEN')`, calling the existing `runTriageOnce`/collect logic per period. Keep it **off-chain** — no `prepareAnchor`/anchor calls in this path (spec §6.5).

> **Confirm at implementation time:** the exact triage run entrypoint (`runTriageOnce`) signature and how `startTriageScheduler` currently pins the period (`routes.ts:71` scheduler start), from the round-1/round-2 triage work.

- [ ] **Step 4: Verify + commit**

Run: `cd services/api && npx vitest run && npx tsc --noEmit`
Expected: PASS + exit 0.

```bash
git add services/api/src/http/routes.ts services/api/src/http/triageSweep.period.test.ts
git commit -m "feat(c2): triage run + scheduler sweep all OPEN periods (off-chain)"
```

---

### Task 12: Cross-quarter demo seed

**Files:**
- Modify: `services/api/src/store/seed.ts` (or the demo fixture it reads)
- Test: `services/api/src/store/seed.period.test.ts`

**Interfaces:**
- Consumes: `insertEvent` (Task 4), `lockPeriod`/`getPeriodLock`, `ingestEvent` (Task 5).
- Produces: seeded events spanning Q1 and Q2 so the demo can run "lock Q1 → ingest Q1 event → 409; ingest Q2 event → 201".

- [ ] **Step 1: Write the failing test**

```typescript
// services/api/src/store/seed.period.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { listPeriods } from './periodQuery';
import { ingestEvent, PeriodLockedError } from '../http/ingestEvent';
import { lockPeriod } from '../periodLock/store';
// import { seedDemo } from './seed'; // confirm the seed entrypoint used by tests

describe('cross-quarter demo', () => {
  it('supports the lock-Q1-then-reject-Q1 demo script', () => {
    const d = new Database(':memory:');
    d.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    // seed at least one Q1 and one Q2 event for 'acme' (via seedDemo or direct ingestEvent)
    ingestEvent(d as any, 'acme', JSON.stringify({ eventTime: '2026-02-01T00:00:00Z' }));
    ingestEvent(d as any, 'acme', JSON.stringify({ eventTime: '2026-05-01T00:00:00Z' }));
    const periods = listPeriods(d as any, 'acme').map((p) => p.periodId);
    expect(periods).toContain('2026-Q1');
    expect(periods).toContain('2026-Q2');

    lockPeriod(d as any, 'acme', '2026-Q1', 'tester');
    expect(() => ingestEvent(d as any, 'acme', JSON.stringify({ eventTime: '2026-03-15T00:00:00Z' }))).toThrow(PeriodLockedError);
    expect(ingestEvent(d as any, 'acme', JSON.stringify({ eventTime: '2026-06-15T00:00:00Z' })).periodId).toBe('2026-Q2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails/passes**

Run: `cd services/api && npx vitest run src/store/seed.period.test.ts`
Expected: PASS (this validates the demo script end-to-end via ingestEvent). If the demo needs the fixture itself to span quarters, update the fixture in Step 3.

- [ ] **Step 3: Add cross-quarter events to the demo fixture**

In `services/api/src/store/seed.ts` (or its fixture JSON), ensure the seeded demo events include at least one with an `eventTime` in Q1 (e.g. `2026-02-…`) and one in Q2 (e.g. `2026-05-…`), so a running demo server shows two periods. Seed via the existing `seed()` path (which calls `insertEvent`, now period-aware). Seeding runs **before** any anchoring, satisfying precondition P1 (spec §6.2).

- [ ] **Step 4: Verify + commit**

Run: `cd services/api && npx vitest run src/store/seed.period.test.ts && npx tsc --noEmit`
Expected: PASS + exit 0.

```bash
git add services/api/src/store/seed.ts services/api/src/store/seed.period.test.ts
git commit -m "feat(c2): cross-quarter demo seed enabling the cutoff-reject demo script"
```

---

### Task 13: Monkey tests (mandated by .claude/rules/test.md)

**Files:**
- Create: `services/api/src/store/period.monkey.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the monkey tests**

```typescript
// services/api/src/store/period.monkey.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { periodOf } from '@subledger/rules-engine';
import { ingestEvent, PeriodLockedError } from '../http/ingestEvent';
import { lockPeriod } from '../periodLock/store';

function db() {
  const d = new Database(':memory:');
  d.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return d;
}

describe('period attribution — monkey', () => {
  it('boundary instants never mis-bin (±1ms around quarter edge)', () => {
    expect(periodOf('2026-03-31T23:59:59.999Z')).toBe('2026-Q1');
    expect(periodOf('2026-04-01T00:00:00.000Z')).toBe('2026-Q2');
  });

  it('leap day and year-end bin correctly', () => {
    expect(periodOf('2028-02-29T12:00:00Z')).toBe('2028-Q1');
    expect(periodOf('2026-12-31T23:59:59Z')).toBe('2026-Q4');
  });

  it('garbage / empty / far-future eventTime → INVALID_EVENT_TIME, never null bin', () => {
    for (const bad of ['', 'garbage', 'NaN', '2026-13-40T99:99Z']) {
      expect(() => periodOf(bad)).toThrow(/INVALID_EVENT_TIME/);
    }
    expect(periodOf('9999-01-01T00:00:00Z')).toBe('9999-Q1'); // far future is valid, must bin not throw
  });

  it('no event slips into a locked period (attempt many)', () => {
    const d = db();
    lockPeriod(d as any, 'acme', '2026-Q1', 'tester');
    let rejected = 0;
    for (let i = 0; i < 50; i++) {
      try {
        ingestEvent(d as any, 'acme', JSON.stringify({ eventTime: `2026-0${(i % 3) + 1}-15T00:00:00Z` }));
      } catch (e) {
        if (e instanceof PeriodLockedError) rejected++;
      }
    }
    const inQ1 = d.prepare(`SELECT COUNT(*) AS n FROM events WHERE period_id='2026-Q1'`).get() as { n: number };
    expect(inQ1.n).toBe(0); // Q1 is locked: nothing ever landed there
    expect(rejected).toBeGreaterThan(0);
  });

  it('many distinct periods (40 quarters) enumerate without error', () => {
    const d = db();
    for (let y = 2016; y < 2026; y++) {
      for (const m of ['02', '05', '08', '11']) {
        ingestEvent(d as any, 'acme', JSON.stringify({ eventTime: `${y}-${m}-01T00:00:00Z` }));
      }
    }
    const n = d.prepare(`SELECT COUNT(DISTINCT period_id) AS n FROM events WHERE entity_id='acme'`).get() as { n: number };
    expect(n).toBe(40);
  });
});
```

- [ ] **Step 2: Run the monkey tests**

Run: `cd services/api && npx vitest run src/store/period.monkey.test.ts`
Expected: PASS (5 tests). Fix any real defect surfaced (do not weaken assertions).

- [ ] **Step 3: Full suite sanity across workspaces**

Run: `cd services/api && npx vitest run && npx tsc --noEmit` then `cd services/rules-engine && npx vitest run`
Expected: all PASS + tsc exit 0. Report exact counts (e.g. "api NNN/NNN, rules-engine NN/NN").

- [ ] **Step 4: Commit**

```bash
git add services/api/src/store/period.monkey.test.ts
git commit -m "test(c2): monkey — boundary/leap/garbage/locked-slip/40-quarters"
```

---

## Self-Review

**Spec coverage:**
- §3.1/§3.2 attribution + UTC + INVALID_EVENT_TIME → Task 1.
- §4 schema columns + app-enforced null + indexes → Task 2.
- §5.1 derived periods → Tasks 10, 11 (DISTINCT period_id).
- §5.2 ingest gate + atomic + reject-log (not silent drop) → Task 5.
- §5.2.4 JE inherits period → Task 6.
- §5.3 period-scoped queries → Task 7 (events, JE, exceptions), Task 8 (snapshot).
- §5.4 route params + drop DEFAULT_PERIOD + derive on decide → Task 9; triage sweep → Task 11.
- §5.5 GET /periods → Task 10.
- §6.1 period_id excluded from leaf preimage → Global Constraints (verified, no code touches leafCodec).
- §6.2 P1 precondition + §7 backfill + audit record → Task 3.
- §6.5 off-chain sweep → Task 11.
- §7 migration order → Tasks 2 (columns) → 3 (backfill).
- §8 error envelopes → Tasks 5, 9.
- §9 demo direction (frontend) → out of scope (backend plan); demo seed → Task 12.
- §9 monkey coverage → Task 13.

**Gaps intentionally deferred (spec §2/§11):** opening-balance roll-forward, cross-period rev-rec, non-UTC fiscal config, `periods` registry, H2 supersedesSeq/restatement, frontend UI implementation, SoD on lock (owned by cockpit spec §9).

**Placeholder scan:** the four "Confirm at implementation time" notes (Task 5 lockPeriod signature, Task 7 collectExceptions signature, Task 9 test-app harness name, Task 11 triage entrypoint) are the spec §10 code facts flagged for explore verification — each names the exact file:line to check; they are not vague placeholders. `listEvents`/`listJournal` row-mapper reuse is noted as "match existing mapper style" because the exact mapper body must mirror current code verbatim.

**Type consistency:** `periodOf`/`PeriodId` (Task 1) consumed identically everywhere; `EventRow.periodId` (Task 4) → `ingestEvent`/`listEventsByPeriod` (Tasks 5,7) → `insertJournalEntry({periodId})` (Task 6) → `listJournal(…, periodId)` (Tasks 7,8); `PeriodLockedError{periodId,eventTime}` (Task 5) consumed in Task 12/13; `listPeriods → {periodId, lockStatus}` (Task 10) consumed in Task 11. Consistent.
