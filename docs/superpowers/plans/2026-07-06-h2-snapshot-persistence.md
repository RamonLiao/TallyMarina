# H2 Snapshot Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the snapshot supersede chain so restatement (reopen → edit → re-freeze) produces `seq=2,supersedesSeq=1` instead of a `SNAPSHOT_CONFLICT` 409 dead-end, surface STALE_ANCHOR to the operator (soft-force), and make the P1 migration gate precise per-snapshot with an audited operator escape-hatch.

**Architecture:** Replace the per-request `new InMemorySnapshotRepo()` in the freeze route with a DB-backed `SqliteSnapshotRepo` that implements snapshot-svc's `AuditSnapshotRepo` interface — converging the two writers (repo-in-memory + `insertSnapshot`) into one. STALE_ANCHOR is a deterministic derivation (recompute current merkle root, compare to latest ANCHORED root), not a new state machine. P1 gate recomputes each anchored snapshot's period-scoped root and only aborts on a real byte mismatch; an env allow-list of snapshot ids lets an operator accept a known change, logged to a persistent `migration_override_log` table.

**Tech Stack:** TypeScript, better-sqlite3, Fastify, vitest (node env), React + Playwright (web). Monorepo npm workspaces. snapshot-svc is a storage-agnostic pure package whose `AuditSnapshotRepo` interface already encodes chain semantics.

## Global Constraints

- **Zero Move changes** — S-F1 (on-chain `supersedes_seq` domain fix) is a pure off-chain change; `sui move test` is N/A (state it explicitly, do not silently skip). Move end treats `supersedes_seq` as inert metadata (`move/.../audit_anchor.move:705-711` red-team test proves it).
- **snapshot-svc interface is inviolate** — `AuditSnapshotRepo.freeze(input: FreezeInput, opts?: { restate?: boolean })`. Restatement provenance (an accounting-app concern) MUST NOT leak into snapshot-svc's `FreezeInput`/`AuditSnapshot`; it is persisted by the concrete `SqliteSnapshotRepo` via constructor injection.
- **seq convention** — snapshot seq starts at 1; `supersedesSeq: null` is the "no prior version" sentinel (`snapshotRepo.ts:47`). DTO renders `supersedesSeq ?? 0` (`buildSnapshot.ts:72`). Snapshot seq is per-`(entity, period)`; on-chain anchor `seq`/`link` is entity-global and monotonic (`schema.sql:38-47`, `audit_anchor.move:169`) — two distinct concepts, never conflate.
- **merkleRoot is the content invariant** — compare `merkleRoot` (not `manifestHash`, which folds in `createdAtLogical`) for idempotency and staleness (`routes.ts:801-802`).
- **Fail loud** (project Rule 12) — corrupt `manifest_json`, UNIQUE violation, unparseable state must throw, never silently return null/empty.
- **Migration additive only** — SQLite has no `ADD COLUMN IF NOT EXISTS`; new columns go in the `MIGRATIONS` array in `db.ts:18-28` (duplicate-column errors are swallowed there; anything else fails loud).
- **Color contract** (web) — `--warn` amber = attention-but-not-blocking; `--debit` red = blocking. STALE_ANCHOR is soft-force → amber, never red (Rule 7: don't run two conflicting stale indicators — replace the old one).
- **All UI copy in English.**
- **git staging**: only `git add <explicit paths>`, never `git add -A`/`.`.

---

## File Structure

**services/api (backend):**
- `src/store/schema.sql` — MODIFY: `snapshots` gains `seq` + 5 provenance cols; new `migration_override_log` table.
- `src/store/db.ts` — MODIFY: add ALTER TABLE migration lines + seq backfill.
- `src/store/snapshotStore.ts` — MODIFY: `SnapshotRow` gains `seq` + provenance; `insertSnapshot` writes them; new `getLatestSnapshot`, `getLatestSnapshotSeq`, `listSnapshotsForPeriod` helpers.
- `src/store/sqliteSnapshotRepo.ts` — CREATE: `SqliteSnapshotRepo implements AuditSnapshotRepo`.
- `src/store/migrationOverrideLog.ts` — CREATE: insert/list for the override audit table.
- `src/http/routes.ts` — MODIFY: freeze route (760-856) rewrite; anchors route (938-963) `superseded` flag.
- `src/http/anchorService.ts` — MODIFY: `prepareAnchor` gains `ANCHOR_SUPERSEDED` guard (S-F2) + chain-seq domain fix (S-F1).
- `src/periodLock/cockpit.ts` — MODIFY: replace `staleAnchor` proxy; add `anchorStaleness`.
- `src/periodLock/anchorStaleness.ts` — CREATE: `deriveAnchorStaleness` pure function.
- `src/store/backfillPeriod.ts` — MODIFY: P1 gate per-snapshot precision + escape-hatch.
- `test/*.test.ts` — CREATE: per-task test files.

**web (frontend):**
- `src/api/types.ts` — MODIFY: `CloseCockpitDTO` gains `anchorStaleness`; `AnchorDTO` gains `superseded`.
- `src/workspaces/close/CloseCockpit.tsx` + `close.css` — MODIFY: amber chip badge, CTA copy, ribbon flex-wrap.
- `src/workspaces/export/assembleExport.ts` — MODIFY: consume staleness for clear restatement disclosure (C-F3).
- `web/e2e/` — CREATE: Playwright stale-anchor spec.

**Task dependency order:** T1 → T2 → T3 (core); T4 (staleness) depends on T1; T5 (anchor guards) depends on T1; T6 (P1) depends on T1; T7 (export) depends on T4 DTO; T8 (UI) depends on T4 DTO; T9 (monkey) last.

---

## Task 1: Schema + store plumbing for seq & provenance

**Files:**
- Modify: `services/api/src/store/schema.sql:27-37` (snapshots table), append `migration_override_log`
- Modify: `services/api/src/store/db.ts:18-28` (MIGRATIONS array + backfill)
- Modify: `services/api/src/store/snapshotStore.ts:4-27` (SnapshotRow, insertSnapshot, getSnapshot) + new helpers
- Test: `services/api/test/snapshotStore.seq.test.ts`

**Interfaces:**
- Produces:
  - `SnapshotRow` extended with `seq: number`, `restatementReasonCode: string | null`, `restatementReason: string | null`, `affectedAmountEstimate: string | null`, `restatementRequestedBy: string | null`, `restatementApprovedBy: string | null`.
  - `getLatestSnapshot(db, entityId, periodId): SnapshotRow | null` — highest seq for the pair.
  - `getLatestSnapshotSeq(db, entityId, periodId): number` — 0 if none.
  - `listSnapshotsForPeriod(db, entityId, periodId): SnapshotRow[]` — ordered by seq asc.
  - `insertSnapshot(db, r)` — `r` now includes `seq` and optional provenance (default null).
  - `insertMigrationOverride` / `listMigrationOverrides` (in `migrationOverrideLog.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/snapshotStore.seq.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import {
  insertSnapshot, getSnapshot, getLatestSnapshot, getLatestSnapshotSeq, listSnapshotsForPeriod,
} from '../src/store/snapshotStore.js';

const E = 'ent-1', P = '2026-Q2';
function seed(db: Db) {
  insertEntity(db, { id: E, displayName: 'X', chainObjectId: '0x1', capObjectId: '0x2' });
}
function row(seq: number, root: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id: `snap-${E}-${P}-${seq}`, entityId: E, periodId: P,
    manifestJson: JSON.stringify({ merkleRoot: root }), manifestHash: `mh-${seq}`,
    merkleRoot: root, leafCount: 3, seq, supersedesSeq: seq === 1 ? null : seq - 1,
    ...extra,
  };
}

describe('snapshot seq + provenance store', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); seed(db); });

  it('persists seq and returns latest by seq', () => {
    insertSnapshot(db, row(1, 'aa'));
    insertSnapshot(db, row(2, 'bb'));
    expect(getLatestSnapshotSeq(db, E, P)).toBe(2);
    expect(getLatestSnapshot(db, E, P)!.merkleRoot).toBe('bb');
    expect(getSnapshot(db, `snap-${E}-${P}-1`)!.seq).toBe(1);
    expect(listSnapshotsForPeriod(db, E, P).map((r) => r.seq)).toEqual([1, 2]);
  });

  it('getLatestSnapshotSeq is 0 when none', () => {
    expect(getLatestSnapshotSeq(db, E, P)).toBe(0);
  });

  it('UNIQUE(entity,period,seq) rejects duplicate seq', () => {
    insertSnapshot(db, row(1, 'aa'));
    expect(() => insertSnapshot(db, row(1, 'cc'))).toThrow(/UNIQUE constraint failed/);
  });

  it('round-trips restatement provenance', () => {
    insertSnapshot(db, row(2, 'bb', {
      restatementReasonCode: 'error-correction', restatementReason: 'wrong price',
      affectedAmountEstimate: '1000', restatementRequestedBy: 'alice', restatementApprovedBy: 'bob',
    }));
    const got = getLatestSnapshot(db, E, P)!;
    expect(got.restatementReasonCode).toBe('error-correction');
    expect(got.restatementApprovedBy).toBe('bob');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/snapshotStore.seq.test.ts`
Expected: FAIL — `getLatestSnapshot`/`getLatestSnapshotSeq`/`listSnapshotsForPeriod` not exported; `seq` column missing.

- [ ] **Step 3: Extend schema.sql**

In `services/api/src/store/schema.sql`, replace the `snapshots` table (lines 27-37) with:

```sql
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  period_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  leaf_count INTEGER NOT NULL,
  supersedes_seq INTEGER,
  status TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1,
  restatement_reason_code TEXT,
  restatement_reason TEXT,
  affected_amount_estimate TEXT,
  restatement_requested_by TEXT,
  restatement_approved_by TEXT,
  UNIQUE (entity_id, period_id, seq)
);
```

At the end of the file, append the override audit table:

```sql
CREATE TABLE IF NOT EXISTS migration_override_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id TEXT NOT NULL,
  old_root TEXT NOT NULL,
  recomputed_root TEXT NOT NULL,
  operator TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  justification TEXT NOT NULL
);
```

- [ ] **Step 4: Add migrations for pre-existing dev DBs**

In `services/api/src/store/db.ts`, add to the `MIGRATIONS` array (after line 27):

```ts
    'ALTER TABLE snapshots ADD COLUMN seq INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE snapshots ADD COLUMN restatement_reason_code TEXT',
    'ALTER TABLE snapshots ADD COLUMN restatement_reason TEXT',
    'ALTER TABLE snapshots ADD COLUMN affected_amount_estimate TEXT',
    'ALTER TABLE snapshots ADD COLUMN restatement_requested_by TEXT',
    'ALTER TABLE snapshots ADD COLUMN restatement_approved_by TEXT',
```

Note: `UNIQUE(entity,period,seq)` and `migration_override_log` come from the `CREATE TABLE IF NOT EXISTS` in schema.sql (applied first at `db.ts:15`); a pre-existing DB without the unique index is acceptable for this demo (documented gap — a fresh DB gets it). Existing rows predate seq and default to `seq=1` via the column default, matching the "seq starts at 1" convention.

- [ ] **Step 5: Extend snapshotStore.ts**

In `services/api/src/store/snapshotStore.ts`, extend `SnapshotRow` (lines 4-7) to add the six new fields, update `insertSnapshot` (18-22) to write `seq` + provenance, update `getSnapshot` (24-27) to select them, and add the three helpers:

```ts
export interface SnapshotRow {
  id: string; entityId: string; periodId: string;
  manifestJson: string; manifestHash: string; merkleRoot: string;
  leafCount: number; supersedesSeq: number | null; status: SnapshotStatus;
  seq: number;
  restatementReasonCode: string | null; restatementReason: string | null;
  affectedAmountEstimate: string | null;
  restatementRequestedBy: string | null; restatementApprovedBy: string | null;
}

function rowFrom(r: Record<string, unknown>): SnapshotRow {
  return {
    id: r.id as string, entityId: r.entity_id as string, periodId: r.period_id as string,
    manifestJson: r.manifest_json as string, manifestHash: r.manifest_hash as string,
    merkleRoot: r.merkle_root as string, leafCount: r.leaf_count as number,
    supersedesSeq: (r.supersedes_seq as number | null) ?? null, status: r.status as SnapshotStatus,
    seq: r.seq as number,
    restatementReasonCode: (r.restatement_reason_code as string | null) ?? null,
    restatementReason: (r.restatement_reason as string | null) ?? null,
    affectedAmountEstimate: (r.affected_amount_estimate as string | null) ?? null,
    restatementRequestedBy: (r.restatement_requested_by as string | null) ?? null,
    restatementApprovedBy: (r.restatement_approved_by as string | null) ?? null,
  };
}

export function insertSnapshot(
  db: Db,
  r: Omit<SnapshotRow, 'status'> & { status?: SnapshotStatus },
): void {
  db.prepare(
    `INSERT INTO snapshots
       (id, entity_id, period_id, manifest_json, manifest_hash, merkle_root, leaf_count,
        supersedes_seq, status, seq, restatement_reason_code, restatement_reason,
        affected_amount_estimate, restatement_requested_by, restatement_approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.id, r.entityId, r.periodId, r.manifestJson, r.manifestHash, r.merkleRoot, r.leafCount,
    r.supersedesSeq, r.status ?? 'FROZEN', r.seq,
    r.restatementReasonCode ?? null, r.restatementReason ?? null, r.affectedAmountEstimate ?? null,
    r.restatementRequestedBy ?? null, r.restatementApprovedBy ?? null,
  );
}

export function getSnapshot(db: Db, id: string): SnapshotRow | null {
  const r = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? rowFrom(r) : null;
}

export function getLatestSnapshot(db: Db, entityId: string, periodId: string): SnapshotRow | null {
  const r = db.prepare(
    'SELECT * FROM snapshots WHERE entity_id = ? AND period_id = ? ORDER BY seq DESC LIMIT 1',
  ).get(entityId, periodId) as Record<string, unknown> | undefined;
  return r ? rowFrom(r) : null;
}

export function getLatestSnapshotSeq(db: Db, entityId: string, periodId: string): number {
  const r = db.prepare(
    'SELECT MAX(seq) AS m FROM snapshots WHERE entity_id = ? AND period_id = ?',
  ).get(entityId, periodId) as { m: number | null };
  return r.m ?? 0;
}

export function listSnapshotsForPeriod(db: Db, entityId: string, periodId: string): SnapshotRow[] {
  return (db.prepare(
    'SELECT * FROM snapshots WHERE entity_id = ? AND period_id = ? ORDER BY seq ASC',
  ).all(entityId, periodId) as Record<string, unknown>[]).map(rowFrom);
}
```

Keep the existing `setSnapshotStatus`, `hasAnchoredSnapshot`, `hasAnchoredSnapshotForPeriod` unchanged.

- [ ] **Step 6: Create migrationOverrideLog.ts**

```ts
// services/api/src/store/migrationOverrideLog.ts
import type { Db } from './db.js';

export interface MigrationOverrideRow {
  snapshotId: string; oldRoot: string; recomputedRoot: string;
  operator: string; acceptedAt: string; justification: string;
}

export function insertMigrationOverride(db: Db, r: MigrationOverrideRow): void {
  db.prepare(
    `INSERT INTO migration_override_log
       (snapshot_id, old_root, recomputed_root, operator, accepted_at, justification)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(r.snapshotId, r.oldRoot, r.recomputedRoot, r.operator, r.acceptedAt, r.justification);
}

export function listMigrationOverrides(db: Db): MigrationOverrideRow[] {
  return (db.prepare('SELECT * FROM migration_override_log ORDER BY seq ASC').all() as Record<string, unknown>[])
    .map((r) => ({
      snapshotId: r.snapshot_id as string, oldRoot: r.old_root as string,
      recomputedRoot: r.recomputed_root as string, operator: r.operator as string,
      acceptedAt: r.accepted_at as string, justification: r.justification as string,
    }));
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd services/api && npx vitest run test/snapshotStore.seq.test.ts`
Expected: PASS (4 tests). Then `npx vitest run` to confirm no regressions in existing snapshot tests (they don't pass `seq` yet — see note).

⚠️ Existing callers of `insertSnapshot` (freeze route, any test) now need a `seq`. The freeze route is rewritten in T3; if any OTHER test constructs a SnapshotRow, it will fail typecheck. Run `cd services/api && npx tsc --noEmit` and fix any test fixtures by adding `seq: 1` (and null provenance is defaulted). Do NOT touch the freeze route here — that's T3.

- [ ] **Step 8: Commit**

```bash
git add services/api/src/store/schema.sql services/api/src/store/db.ts services/api/src/store/snapshotStore.ts services/api/src/store/migrationOverrideLog.ts services/api/test/snapshotStore.seq.test.ts
git commit -m "feat(api): snapshots.seq + restatement provenance cols + migration_override_log; latest-seq helpers"
```

---

## Task 2: SqliteSnapshotRepo implementing AuditSnapshotRepo

**Files:**
- Create: `services/api/src/store/sqliteSnapshotRepo.ts`
- Test: `services/api/test/sqliteSnapshotRepo.test.ts`

**Interfaces:**
- Consumes: `AuditSnapshotRepo`, `FreezeInput`, `FreezeResult`, `AuditSnapshot` from `@subledger/snapshot-svc`; `SnapshotError`; store helpers from T1.
- Produces: `class SqliteSnapshotRepo implements AuditSnapshotRepo`, constructed as `new SqliteSnapshotRepo(db, provenance?)` where `provenance?: RestatementProvenance` is written only when a restate row (seq>1) is created. Exports `interface RestatementProvenance { reasonCode: string | null; reason: string | null; affectedAmountEstimate: string | null; requestedBy: string | null; approvedBy: string | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/sqliteSnapshotRepo.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { SqliteSnapshotRepo } from '../src/store/sqliteSnapshotRepo.js';
import { getSnapshot } from '../src/store/snapshotStore.js';
import { SnapshotError } from '@subledger/snapshot-svc';

const E = 'ent-1', P = '2026-Q2';
function manifest(root: string) {
  return {
    manifestVersion: 1, entityId: E, periodId: P, merkleRoot: root, leafCount: 3,
    leafCodecVersion: 'JE_LEAF_BCS_V1', merkleParams: { hash: 'blake2b256', arity: 2 },
    policyVersions: ['demo-ps-1'], createdAtLogical: 100,
  };
}
function seed(db: Db) { insertEntity(db, { id: E, displayName: 'X', chainObjectId: '0x1', capObjectId: '0x2' }); }

describe('SqliteSnapshotRepo — AuditSnapshotRepo contract', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); seed(db); });

  it('first freeze → seq=1, supersedesSeq=null, created=true', () => {
    const repo = new SqliteSnapshotRepo(db);
    const { snapshot, created } = repo.freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    expect(created).toBe(true);
    expect(snapshot.seq).toBe(1);
    expect(snapshot.supersedesSeq).toBeNull();
    expect(getSnapshot(db, `snap-${E}-${P}-1`)!.merkleRoot).toBe('aa');
  });

  it('re-freeze without restate → throws SNAPSHOT_EXISTS', () => {
    const repo = new SqliteSnapshotRepo(db);
    repo.freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    expect(() => repo.freeze({ manifest: manifest('bb') as never, manifestHash: 'h2' }))
      .toThrow(SnapshotError);
  });

  it('restate → seq=2, supersedesSeq=1', () => {
    const repo = new SqliteSnapshotRepo(db);
    repo.freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    const { snapshot } = repo.freeze({ manifest: manifest('bb') as never, manifestHash: 'h2' }, { restate: true });
    expect(snapshot.seq).toBe(2);
    expect(snapshot.supersedesSeq).toBe(1);
  });

  it('restate writes injected provenance onto the new row only', () => {
    new SqliteSnapshotRepo(db).freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    const repo = new SqliteSnapshotRepo(db, {
      reasonCode: 'error-correction', reason: 'bad price', affectedAmountEstimate: '999',
      requestedBy: 'alice', approvedBy: 'bob',
    });
    repo.freeze({ manifest: manifest('bb') as never, manifestHash: 'h2' }, { restate: true });
    expect(getSnapshot(db, `snap-${E}-${P}-1`)!.restatementReasonCode).toBeNull();
    expect(getSnapshot(db, `snap-${E}-${P}-2`)!.restatementReasonCode).toBe('error-correction');
    expect(getSnapshot(db, `snap-${E}-${P}-2`)!.restatementApprovedBy).toBe('bob');
  });

  it('get returns latest version', () => {
    const repo = new SqliteSnapshotRepo(db);
    repo.freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    repo.freeze({ manifest: manifest('bb') as never, manifestHash: 'h2' }, { restate: true });
    expect(repo.get(E, P)!.merkleRoot).toBe('bb');
    expect(repo.get(E, P)!.seq).toBe(2);
  });

  it('get on corrupt manifest_json throws (fail-loud)', () => {
    const repo = new SqliteSnapshotRepo(db);
    repo.freeze({ manifest: manifest('aa') as never, manifestHash: 'h1' });
    db.prepare('UPDATE snapshots SET manifest_json = ? WHERE id = ?').run('{not json', `snap-${E}-${P}-1`);
    expect(() => repo.get(E, P)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/sqliteSnapshotRepo.test.ts`
Expected: FAIL — module `sqliteSnapshotRepo.js` not found.

- [ ] **Step 3: Write the implementation**

```ts
// services/api/src/store/sqliteSnapshotRepo.ts
import type { Db } from './db.js';
import {
  type AuditSnapshotRepo, type FreezeInput, type FreezeResult, type AuditSnapshot,
  SnapshotError,
} from '@subledger/snapshot-svc';
import { insertSnapshot, getLatestSnapshot } from './snapshotStore.js';

export interface RestatementProvenance {
  reasonCode: string | null; reason: string | null; affectedAmountEstimate: string | null;
  requestedBy: string | null; approvedBy: string | null;
}

/**
 * DB-backed AuditSnapshotRepo. Converges the freeze writer: buildSnapshot() calls
 * freeze() which INSERTs — no second insertSnapshot in the route. Restatement
 * provenance is app-specific (not part of snapshot-svc's FreezeInput), so it is
 * injected at construction and written only onto restate rows (seq>1).
 */
export class SqliteSnapshotRepo implements AuditSnapshotRepo {
  constructor(private readonly db: Db, private readonly provenance?: RestatementProvenance) {}

  freeze(input: FreezeInput, opts?: { restate?: boolean }): FreezeResult {
    const { manifest, manifestHash } = input;
    const { entityId, periodId, merkleRoot, leafCount } = manifest;
    return this.db.transaction((): FreezeResult => {
      const prev = getLatestSnapshot(this.db, entityId, periodId);
      if (prev && !opts?.restate) {
        throw new SnapshotError('SNAPSHOT_EXISTS',
          `snapshot exists for ${entityId}/${periodId}; pass restate:true to supersede`);
      }
      const seq = prev ? prev.seq + 1 : 1;
      const supersedesSeq = prev ? prev.seq : null;
      const id = `snap-${entityId}-${periodId}-${seq}`;
      const prov = prev ? this.provenance : undefined; // provenance only on restate rows
      insertSnapshot(this.db, {
        id, entityId, periodId,
        manifestJson: JSON.stringify(manifest), manifestHash,
        merkleRoot, leafCount, supersedesSeq, seq, status: 'FROZEN',
        restatementReasonCode: prov?.reasonCode ?? null,
        restatementReason: prov?.reason ?? null,
        affectedAmountEstimate: prov?.affectedAmountEstimate ?? null,
        restatementRequestedBy: prov?.requestedBy ?? null,
        restatementApprovedBy: prov?.approvedBy ?? null,
      });
      const snapshot: AuditSnapshot = {
        entityId, periodId, seq, manifest, manifestHash, merkleRoot, leafCount, supersedesSeq,
      };
      return { snapshot, created: true };
    })();
  }

  get(entityId: string, periodId: string): AuditSnapshot | null {
    const row = getLatestSnapshot(this.db, entityId, periodId);
    if (!row) return null;
    const manifest = JSON.parse(row.manifestJson); // throws on corrupt JSON — fail-loud
    return {
      entityId: row.entityId, periodId: row.periodId, seq: row.seq, manifest,
      manifestHash: row.manifestHash, merkleRoot: row.merkleRoot, leafCount: row.leafCount,
      supersedesSeq: row.supersedesSeq,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && npx vitest run test/sqliteSnapshotRepo.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/store/sqliteSnapshotRepo.ts services/api/test/sqliteSnapshotRepo.test.ts
git commit -m "feat(api): SqliteSnapshotRepo — DB-backed AuditSnapshotRepo with restate chain + injected provenance"
```

---

## Task 3: Freeze route rewrite — kill the 409 dead-end

**Files:**
- Modify: `services/api/src/http/routes.ts:760-856` (freeze route)
- Test: `services/api/test/freeze.restate.test.ts`

**Interfaces:**
- Consumes: `SqliteSnapshotRepo`, `RestatementProvenance` (T2); `getLatestSnapshot`, `getLatestSnapshotSeq` (T1); `buildMerkle` (already imported `routes.ts:36`); `getPeriodLock` (already imported).
- Produces: freeze route returns `{ snapshot: { id, periodId, manifestHash, merkleRoot, leafCount, supersedesSeq, seq, status } }`. On a changed-books re-freeze it returns `seq=2, supersedesSeq=1` (no longer `SNAPSHOT_CONFLICT`).

- [ ] **Step 1: Write the failing regression test (the core WHY)**

```ts
// services/api/test/freeze.restate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp } from './helpers/app.js'; // EXISTING harness — exports buildTestApp + TEST_ENTITY_ID + stub clients
// seedLockedPeriodWithJE / reopenAndEditJE: add as small local helpers or inline (see Step 1a).

describe('freeze restatement (409 dead-end fix)', () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  beforeEach(async () => { ctx = await buildTestApp(); });

  it('reopen → edit → re-lock → re-freeze produces seq=2/supersedesSeq=1, NOT SNAPSHOT_CONFLICT', async () => {
    const { app, entityId, periodId } = ctx;
    await seedLockedPeriodWithJE(ctx);
    const first = await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    expect(first.statusCode).toBe(200);
    expect(first.json().snapshot.seq).toBe(1);
    expect(first.json().snapshot.supersedesSeq).toBe(0); // DTO renders null as 0

    await reopenAndEditJE(ctx); // reopen, mutate a JE amount, re-lock

    const second = await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    expect(second.statusCode).toBe(200);            // was 409 SNAPSHOT_CONFLICT before the fix
    expect(second.json().snapshot.seq).toBe(2);
    expect(second.json().snapshot.supersedesSeq).toBe(1);
  });

  it('same-books re-freeze is idempotent (no new seq)', async () => {
    const { app, entityId, periodId } = ctx;
    await seedLockedPeriodWithJE(ctx);
    const a = await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    const b = await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    expect(a.json().snapshot.seq).toBe(1);
    expect(b.json().snapshot.seq).toBe(1);          // idempotent, same row
  });

  it('restate row carries provenance snapshotted from period_lock reopen', async () => {
    const { app, entityId, periodId, db } = ctx;
    await seedLockedPeriodWithJE(ctx);
    await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    await reopenAndEditJE(ctx, { reasonCode: 'error-correction', restatementReason: 'wrong FX' });
    await app.inject({ method: 'POST', url: `/entities/${entityId}/snapshot`, payload: { periodId } });
    const { getSnapshot } = await import('../src/store/snapshotStore.js');
    expect(getSnapshot(db, `snap-${entityId}-${periodId}-2`)!.restatementReasonCode).toBe('error-correction');
  });
});
```

- [ ] **Step 1a: Reuse the existing harness; add two thin seed helpers**

`services/api/test/helpers/app.ts` ALREADY exists and exports `buildTestApp` (+ `TEST_ENTITY_ID`, `cfg`, `stubClassifyClient`, `needsReviewClient`). Read it first to learn what `buildTestApp` returns (app, db, entityId). Do NOT create a new harness. Add the two flow helpers `seedLockedPeriodWithJE(ctx)` and `reopenAndEditJE(ctx, opts?)` — either as local functions in this test file or a small `helpers/restateFlow.ts`. They must drive the REAL routes: ingest an event → run-rules to produce a JE → lock the period (for seed); and for reopen: `POST /entities/:id/period/reopen` with `{ periodId, restatementReason, reasonCode }`, then mutate one `journal_entries.je_json` (via `db.prepare(...).run(...)`) so the merkle root changes, then re-lock. Mirror the ingest/run-rules/lock call sequence used in an existing route test such as `runRulesPeriodScope.test.ts` or `recon.gate.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/freeze.restate.test.ts`
Expected: FAIL — second freeze returns 409 `SNAPSHOT_CONFLICT` (current dead-end) OR harness missing.

- [ ] **Step 3: Rewrite the freeze route**

In `services/api/src/http/routes.ts`, replace the freeze route body (the part from `const jes` at ~784 through the final `return { snapshot: {...} }` at ~855) so that:
1. Gates (PERIOD_NOT_LOCKED → EXCEPTIONS_BLOCKING → RECON_BREAKS_BLOCKING) stay exactly as-is (lines 769-783 unchanged).
2. Build the candidate root cheaply and decide restate:

```ts
      const jes: JournalEntry[] = listJournal(db, req.params.id, periodId).map((r) => JSON.parse(r.jeJson) as JournalEntry);
      const outputs = jes.map((je) => ({
        decision: 'POSTABLE' as const,
        assessment: { eventType: 'DIGITAL_ASSET_RECEIPT' as const, accountingClass: '', measurementModel: '' },
        measurements: [], lotMovements: [], journalEntries: [je], disclosureFacts: [], exceptions: [],
        explanation: { ruleIds: [], policyVersions: ['demo-ps-1', 'demo-rule-1'], priceRefs: [], fxRefs: [] },
      }));

      // Candidate root (no freeze) to decide idempotent vs restate. buildMerkle uses the
      // same JE_LEAF_BCS_V1 codec buildSnapshot folds in — merkleRoot is the content invariant.
      const { manifest: candidate } = buildMerkle(jes);
      const prev = getLatestSnapshot(db, req.params.id, periodId);
      if (prev && prev.merkleRoot === candidate.merkleRoot) {
        if (prev.status !== 'FROZEN') {
          throw new ApiError(409, 'ALREADY_ANCHORED', `snapshot ${prev.id} is ${prev.status}; the period is already anchored`);
        }
        return {
          snapshot: {
            id: prev.id, periodId, manifestHash: prev.manifestHash, merkleRoot: prev.merkleRoot,
            leafCount: prev.leafCount, supersedesSeq: prev.supersedesSeq ?? 0, seq: prev.seq, status: prev.status,
          },
        };
      }

      const restate = prev != null; // prev exists AND root differs (same-root handled above)
      // On restate, snapshot the reopen provenance onto the new version (C-F1: reopen is a
      // single-row overwrite in period_lock, so only the frozen copy answers "why v2").
      let provenance;
      if (restate) {
        const lock = getPeriodLock(db, req.params.id, periodId);
        provenance = {
          reasonCode: lock.reasonCode, reason: lock.restatementReason,
          affectedAmountEstimate: lock.affectedAmountEstimate,
          requestedBy: lock.requestedBy, approvedBy: lock.approvedBy,
        };
      }
      const repo = new SqliteSnapshotRepo(db, provenance);
      const { auditSnapshot } = buildSnapshot(
        outputs,
        { entityId: req.params.id, periodId, createdAtLogical: Date.now() },
        repo,
        restate ? { restate: true } : undefined,
      );
      return {
        snapshot: {
          id: `snap-${req.params.id}-${periodId}-${auditSnapshot.seq}`, periodId,
          manifestHash: auditSnapshot.manifestHash, merkleRoot: auditSnapshot.merkleRoot,
          leafCount: auditSnapshot.leafCount, supersedesSeq: auditSnapshot.supersedesSeq ?? 0,
          seq: auditSnapshot.seq, status: 'FROZEN',
        },
      };
```

3. Delete the old `InMemorySnapshotRepo` import usage in this route, the `resolveExisting`/PK-collision block (803-844), and the id-collision handling — they're superseded by the candidate-root compare above. Add imports: `SqliteSnapshotRepo` from `../store/sqliteSnapshotRepo.js`, `getLatestSnapshot` from `../store/snapshotStore.js` (extend existing import). Remove `InMemorySnapshotRepo` from the `../deps/snapshotSvc.js` import if no longer used elsewhere in the file (grep first).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && npx vitest run test/freeze.restate.test.ts && npx tsc --noEmit`
Expected: PASS (3 tests), tsc clean. Then `npx vitest run` — fix any pre-existing freeze test that asserted the old `SNAPSHOT_CONFLICT` id-collision behavior (that path is intentionally gone; update the assertion to the new restate semantics and note it in the commit).

- [ ] **Step 5: Commit**

```bash
# Stage routes.ts + the new test + any thin flow helper you added (e.g. helpers/restateFlow.ts). NOT helpers/app.ts (unchanged).
git add services/api/src/http/routes.ts services/api/test/freeze.restate.test.ts
git commit -m "feat(api): freeze route restates on changed books (seq+1) instead of SNAPSHOT_CONFLICT 409; provenance snapshot from reopen"
```

---

## Task 4: STALE_ANCHOR derivation + cockpit DTO

**Files:**
- Create: `services/api/src/periodLock/anchorStaleness.ts`
- Modify: `services/api/src/periodLock/cockpit.ts:14-17,83-89`
- Test: `services/api/test/anchorStaleness.test.ts`

**Interfaces:**
- Consumes: `getLatestSnapshotSeq`, `hasAnchoredSnapshotForPeriod`, `listSnapshotsForPeriod` (T1); `buildMerkle`, `listJournal`.
- Produces:
  - `deriveAnchorStaleness(db, entityId, periodId): AnchorStaleness | null` where `interface AnchorStaleness { stale: boolean; anchoredSeq: number; anchoredRoot: string; currentRoot: string | null; latestSnapshotSeq: number }`; returns `null` if the period was never anchored.
  - `CockpitView` gains `anchorStaleness: AnchorStaleness | null`; the old boolean `staleAnchor` is REPLACED — set `staleAnchor = anchorStaleness?.stale ?? false` for backward DTO compat, derived from the new function (Rule 7: one source).

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/anchorStaleness.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertSnapshot, setSnapshotStatus } from '../src/store/snapshotStore.js';
import { deriveAnchorStaleness } from '../src/periodLock/anchorStaleness.js';
import { insertJournalRow } from './helpers/journal.js'; // thin helper: insert a JE row for (entity,period)

const E = 'ent-1', P = '2026-Q2';
function seed(db: Db) { insertEntity(db, { id: E, displayName: 'X', chainObjectId: '0x1', capObjectId: '0x2' }); }
// snapRoot: compute the buildMerkle root of the current journal so tests match reality.

describe('deriveAnchorStaleness', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); seed(db); });

  it('null when never anchored', () => {
    insertSnapshot(db, { id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h', merkleRoot: 'aa', leafCount: 1, supersedesSeq: null, seq: 1, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    expect(deriveAnchorStaleness(db, E, P)).toBeNull();
  });

  it('stale=false when current root matches latest ANCHORED root', () => {
    const { root } = insertJournalRow(db, E, P); // returns the buildMerkle root of that one JE
    insertSnapshot(db, { id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h', merkleRoot: root, leafCount: 1, supersedesSeq: null, seq: 1, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    setSnapshotStatus(db, `snap-${E}-${P}-1`, 'ANCHORED');
    const s = deriveAnchorStaleness(db, E, P)!;
    expect(s.stale).toBe(false);
    expect(s.anchoredSeq).toBe(1);
    expect(s.latestSnapshotSeq).toBe(1);
  });

  it('stale=true after books change (reopen+edit, not yet re-frozen)', () => {
    const { root } = insertJournalRow(db, E, P, { amount: '100' });
    insertSnapshot(db, { id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h', merkleRoot: root, leafCount: 1, supersedesSeq: null, seq: 1, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    setSnapshotStatus(db, `snap-${E}-${P}-1`, 'ANCHORED');
    insertJournalRow(db, E, P, { amount: '250' }); // books changed → root differs
    const s = deriveAnchorStaleness(db, E, P)!;
    expect(s.stale).toBe(true);
    expect(s.latestSnapshotSeq).toBe(1); // not yet re-frozen
  });

  it('stale=true when re-frozen (seq 2 FROZEN) but not yet re-anchored; latestSnapshotSeq=2', () => {
    const { root: r1 } = insertJournalRow(db, E, P, { amount: '100' });
    insertSnapshot(db, { id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h', merkleRoot: r1, leafCount: 1, supersedesSeq: null, seq: 1, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    setSnapshotStatus(db, `snap-${E}-${P}-1`, 'ANCHORED');
    const { root: r2 } = insertJournalRow(db, E, P, { amount: '250' });
    insertSnapshot(db, { id: `snap-${E}-${P}-2`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h2', merkleRoot: r2, leafCount: 2, supersedesSeq: 1, seq: 2, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    const s = deriveAnchorStaleness(db, E, P)!;
    expect(s.stale).toBe(true);            // latest ANCHORED is still seq1's root
    expect(s.anchoredSeq).toBe(1);
    expect(s.latestSnapshotSeq).toBe(2);
  });

  it('empty journal ⇒ stale=true, does not throw EMPTY_SNAPSHOT (S-F4)', () => {
    const { root } = insertJournalRow(db, E, P);
    insertSnapshot(db, { id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h', merkleRoot: root, leafCount: 1, supersedesSeq: null, seq: 1, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    setSnapshotStatus(db, `snap-${E}-${P}-1`, 'ANCHORED');
    db.prepare('DELETE FROM journal_entries WHERE entity_id = ?').run(E);
    const s = deriveAnchorStaleness(db, E, P)!;
    expect(s.stale).toBe(true);
    expect(s.currentRoot).toBeNull();
  });
});
```

Add `services/api/test/helpers/journal.ts`: `insertJournalRow(db, entityId, periodId, opts?) → { root }` inserting a valid JE row (matching `journal_entries` schema, with `je_json`/`period_id`/`idempotency_key`) and returning `buildMerkle` of the current period journal. Keep it minimal and reuse the JE shape from an existing test fixture.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/anchorStaleness.test.ts`
Expected: FAIL — `deriveAnchorStaleness` not found.

- [ ] **Step 3: Write the derivation**

```ts
// services/api/src/periodLock/anchorStaleness.ts
import type { Db } from '../store/db.js';
import { listSnapshotsForPeriod, getLatestSnapshotSeq } from '../store/snapshotStore.js';
import { buildMerkle, type JournalEntry } from '../deps/rulesEngine.js';
import { listJournal } from '../store/journalStore.js'; // adjust to actual journal list export

export interface AnchorStaleness {
  stale: boolean; anchoredSeq: number; anchoredRoot: string;
  currentRoot: string | null; latestSnapshotSeq: number;
}

/**
 * STALE_ANCHOR: the on-chain anchor no longer matches the current books.
 * Deterministic — recompute the current period root and compare to the latest
 * ANCHORED snapshot's root. Replaces the coarse cockpit proxy (which went dark
 * after re-lock even while the anchor was still stale). Empty journal ⇒ stale
 * (root can't match; must not throw EMPTY_SNAPSHOT). Returns null if never anchored.
 */
export function deriveAnchorStaleness(db: Db, entityId: string, periodId: string): AnchorStaleness | null {
  const anchored = listSnapshotsForPeriod(db, entityId, periodId)
    .filter((s) => s.status === 'ANCHORED')
    .sort((a, b) => b.seq - a.seq)[0];
  if (!anchored) return null;

  const jes = listJournal(db, entityId, periodId).map((r) => JSON.parse(r.jeJson) as JournalEntry);
  let currentRoot: string | null;
  if (jes.length === 0) {
    currentRoot = null; // empty period: root undefined → definitely not equal
  } else {
    currentRoot = buildMerkle(jes).manifest.merkleRoot;
  }
  return {
    stale: currentRoot !== anchored.merkleRoot,
    anchoredSeq: anchored.seq,
    anchoredRoot: anchored.merkleRoot,
    currentRoot,
    latestSnapshotSeq: getLatestSnapshotSeq(db, entityId, periodId),
  };
}
```

Verify the actual import path/name for listing a period's journal (grep `listJournal` in routes.ts — it is imported there; mirror that import). Adjust `jeJson` field name to the real `JournalRow` property.

- [ ] **Step 4: Wire into cockpit.ts**

In `services/api/src/periodLock/cockpit.ts`: import `deriveAnchorStaleness` + `AnchorStaleness`; add `anchorStaleness: AnchorStaleness | null` to `CockpitView` (line 14-17); replace the `staleAnchor` derivation (line 83-86) with:

```ts
  const anchorStaleness = deriveAnchorStaleness(db, entityId, periodId);
  const staleAnchor = anchorStaleness?.stale ?? false;
```

Ensure `buildCockpit` has `db`, `entityId`, `periodId` in scope (it does — it's the signature). Include `anchorStaleness` in the returned object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/api && npx vitest run test/anchorStaleness.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests), tsc clean. Then `npx vitest run` for cockpit regressions.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/periodLock/anchorStaleness.ts services/api/src/periodLock/cockpit.ts services/api/test/anchorStaleness.test.ts services/api/test/helpers/journal.ts
git commit -m "feat(api): deterministic STALE_ANCHOR derivation (root-compare) replaces coarse cockpit proxy; anchorStaleness DTO + latestSnapshotSeq"
```

---

## Task 5: Anchor prepare guards (S-F1 + S-F2) + anchors DTO superseded

**Files:**
- Modify: `services/api/src/http/anchorService.ts:35-68` (prepareAnchor)
- Modify: `services/api/src/http/routes.ts:938-963` (anchors list DTO)
- Test: `services/api/test/anchorGuards.test.ts`

**Interfaces:**
- Consumes: `getLatestSnapshotSeq`, `listSnapshotsForPeriod` (T1); existing `listAnchors`, `getSnapshot`.
- Produces: `prepareAnchor` throws `409 ANCHOR_SUPERSEDED` for a non-latest FROZEN snapshot (S-F2); passes the prior anchor's chain seq as on-chain `supersedes_seq` (S-F1). Anchors list DTO gains `superseded: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/anchorGuards.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertSnapshot } from '../src/store/snapshotStore.js';
import { computeSupersedesChainSeq } from '../src/http/anchorService.js';

const E = 'ent-1', P = '2026-Q2';
function snap(db: Db, seq: number, status: 'FROZEN' | 'ANCHORED') {
  insertSnapshot(db, { id: `snap-${E}-${P}-${seq}`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: `h${seq}`, merkleRoot: `r${seq}`, leafCount: 1, supersedesSeq: seq === 1 ? null : seq - 1, seq, status, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
}

describe('anchor guards', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); insertEntity(db, { id: E, displayName: 'X', chainObjectId: '0x1', capObjectId: '0x2' }); });

  it('S-F1: computeSupersedesChainSeq returns prior anchor chain seq for same period, 0 if none', () => {
    // no prior anchor for this period → 0
    expect(computeSupersedesChainSeq(db, E, P)).toBe(0);
  });
});
```

Note: `prepareAnchor` itself needs chain adapter mocks; the pure S-F1 helper `computeSupersedesChainSeq` is unit-tested here. The S-F2 `ANCHOR_SUPERSEDED` 409 and the DTO `superseded` flag get an integration test in the harness (Step 4) — assert via `app.inject` that anchoring a non-latest FROZEN returns 409, and that a superseded anchor row reports `superseded:true`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/anchorGuards.test.ts`
Expected: FAIL — `computeSupersedesChainSeq` not exported.

- [ ] **Step 3: Implement the guards**

In `services/api/src/http/anchorService.ts`, add the exported helper and wire both guards into `prepareAnchor`:

```ts
import { getSnapshot, setSnapshotStatus, getLatestSnapshotSeq } from '../store/snapshotStore.js';
import { listAnchors } from '../store/anchorStore.js';

/**
 * S-F1: on-chain supersedes_seq must be a CHAIN seq (entity-global), not the
 * snapshot's per-period seq. Return the chain seq of this period's prior anchor
 * (the version being replaced on-chain), or 0 if this period was never anchored.
 */
export function computeSupersedesChainSeq(db: Db, entityId: string, periodId: string): number {
  const priorForPeriod = listAnchors(db, entityId)
    .map((a) => ({ a, snap: getSnapshot(db, a.snapshotId) }))
    .filter((x) => x.snap?.periodId === periodId)
    .sort((x, y) => y.a.seq - x.a.seq)[0];
  return priorForPeriod ? priorForPeriod.a.seq : 0;
}
```

Inside `prepareAnchor`, after the FROZEN check (line 37), add the S-F2 guard:

```ts
    if (snap.status !== 'FROZEN') throw new ApiError(409, 'ILLEGAL_TRANSITION', `snapshot ${snap.status}, expected FROZEN`);
    // S-F2: refuse to anchor a superseded FROZEN version — it would make a known-stale
    // root an on-chain fact and create a permanent STALE_ANCHOR.
    const latestSeq = getLatestSnapshotSeq(deps.db, snap.entityId, snap.periodId);
    if (snap.seq < latestSeq) {
      throw new ApiError(409, 'ANCHOR_SUPERSEDED', `snapshot seq ${snap.seq} superseded by seq ${latestSeq}; anchor the latest`);
    }
```

Replace the `supersedesSeq` arg (line 66) with the chain-seq value:

```ts
        periodId: snap.periodId, supersedesSeq: computeSupersedesChainSeq(deps.db, snap.entityId, snap.periodId),
```

- [ ] **Step 4: Add anchors DTO superseded + integration assertions**

In `routes.ts:938-963`, compute `superseded` per anchor row (its snapshot seq < latest snapshot seq for that period):

```ts
    const anchors = listAnchors(db, req.params.id).map((r) => {
      const snap = getSnapshot(db, r.snapshotId);
      const latestSeq = snap ? getLatestSnapshotSeq(db, req.params.id, snap.periodId) : 0;
      return {
        id: r.id, snapshotId: r.snapshotId, seq: r.seq, link: r.link,
        digest: r.digest, explorerUrl: r.explorerUrl, anchoredAt: r.anchoredAt,
        merkleRoot: snap?.merkleRoot ?? null, periodId: snap?.periodId ?? '',
        leafCount: snap?.leafCount ?? 0,
        superseded: snap != null && snap.seq < latestSeq,
      };
    });
```

Add `getLatestSnapshotSeq` to the routes.ts snapshotStore import. Add integration cases to `anchorGuards.test.ts` using the T3 harness: (a) anchoring a non-latest FROZEN → 409 `ANCHOR_SUPERSEDED`; (b) after a restate re-anchor, the old anchor row reports `superseded:true`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/api && npx vitest run test/anchorGuards.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/http/anchorService.ts services/api/src/http/routes.ts services/api/test/anchorGuards.test.ts
git commit -m "feat(api): anchor guards — ANCHOR_SUPERSEDED 409 (S-F2) + on-chain supersedes_seq domain fix to chain seq (S-F1); anchors DTO superseded flag"
```

---

## Task 6: P1 migration precision + env escape-hatch

**Files:**
- Modify: `services/api/src/store/backfillPeriod.ts:66-82` (P1 gate)
- Test: `services/api/test/backfillP1.test.ts`

**Interfaces:**
- Consumes: `buildMerkle` (rules-engine); `insertMigrationOverride` (T1); `listSnapshotsForPeriod` or direct SQL.
- Produces: P1 gate recomputes each ANCHORED snapshot's period-scoped root; aborts only on a real mismatch; env `C2_MIGRATION_ACCEPT_ROOT_CHANGE` (comma-separated snapshot ids) lets specific mismatches through, each written to `migration_override_log`.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/backfillP1.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { runP1Gate } from '../src/store/backfillPeriod.js'; // extract the gate as a testable export
import { listMigrationOverrides } from '../src/store/migrationOverrideLog.js';
import { seedAnchoredSnapshot } from './helpers/p1.js'; // seeds entity + JEs + an ANCHORED snapshot with a chosen root

describe('P1 gate precision + escape-hatch', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => { delete process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE; });

  it('passes when recomputed period root equals stored root (old false positive gone)', () => {
    seedAnchoredSnapshot(db, { matchesCurrentBooks: true });
    expect(() => runP1Gate(db)).not.toThrow();
  });

  it('aborts with both roots when recomputed root differs', () => {
    seedAnchoredSnapshot(db, { matchesCurrentBooks: false });
    expect(() => runP1Gate(db)).toThrow(/MIGRATION_P1_ANCHOR_ROOT_CHANGED/);
  });

  it('escape-hatch: allow-listed snapshot id passes AND writes migration_override_log', () => {
    const { snapshotId, storedRoot } = seedAnchoredSnapshot(db, { matchesCurrentBooks: false });
    process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE = snapshotId;
    expect(() => runP1Gate(db)).not.toThrow();
    const log = listMigrationOverrides(db);
    expect(log).toHaveLength(1);
    expect(log[0].snapshotId).toBe(snapshotId);
    expect(log[0].oldRoot).toBe(storedRoot);
    expect(log[0].recomputedRoot).not.toBe(storedRoot);
  });

  it('escape-hatch does not cover a different snapshot id → still aborts', () => {
    const { snapshotId } = seedAnchoredSnapshot(db, { matchesCurrentBooks: false });
    process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE = `${snapshotId}-other`;
    expect(() => runP1Gate(db)).toThrow(/MIGRATION_P1_ANCHOR_ROOT_CHANGED/);
  });
});
```

`helpers/p1.ts`: seed an entity, a set of JEs for a period, and an ANCHORED snapshot whose `merkle_root` either equals `buildMerkle(those JEs)` (`matchesCurrentBooks:true`) or a deliberately different root (`false`). Return `{ snapshotId, storedRoot }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && npx vitest run test/backfillP1.test.ts`
Expected: FAIL — `runP1Gate` not exported.

- [ ] **Step 3: Rewrite the P1 gate**

In `services/api/src/store/backfillPeriod.ts`, replace the entity-wide anchored-multi-period query (lines 66-82) with a per-snapshot recompute. Extract it as `runP1Gate(db)` called from within the transaction, so it's unit-testable:

```ts
import { buildMerkle, type JournalEntry } from '../deps/rulesEngine.js';
import { insertMigrationOverride } from './migrationOverrideLog.js';

/**
 * P1 (spec §3.3): for each ANCHORED snapshot, recompute the merkle root from the
 * backfilled period-scoped JEs and byte-compare to the stored root. Abort only on a
 * real mismatch (precise — no entity-wide false positive). An operator may accept
 * specific mismatches via C2_MIGRATION_ACCEPT_ROOT_CHANGE (comma-separated snapshot
 * ids); each acceptance is written to migration_override_log (console is not the
 * only evidence).
 */
export function runP1Gate(db: Db): void {
  const accept = new Set(
    (process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const anchored = db.prepare(
    `SELECT id, entity_id, period_id, merkle_root FROM snapshots WHERE status = 'ANCHORED'`,
  ).all() as { id: string; entity_id: string; period_id: string; merkle_root: string }[];

  const violations: string[] = [];
  for (const s of anchored) {
    const rows = db.prepare(
      `SELECT je_json FROM journal_entries WHERE entity_id = ? AND period_id = ?`,
    ).all(s.entity_id, s.period_id) as { je_json: string }[];
    if (rows.length === 0) continue; // no period JEs to recompute against — nothing to contradict
    const jes = rows.map((r) => JSON.parse(r.je_json) as JournalEntry);
    const recomputed = buildMerkle(jes).manifest.merkleRoot;
    if (recomputed === s.merkle_root) continue; // precise pass
    if (accept.has(s.id)) {
      insertMigrationOverride(db, {
        snapshotId: s.id, oldRoot: s.merkle_root, recomputedRoot: recomputed,
        operator: 'env:C2_MIGRATION_ACCEPT_ROOT_CHANGE',
        acceptedAt: new Date().toISOString(),
        justification: 'operator-accepted via env allow-list',
      });
      console.warn(`[c2-migration] P1 override: snapshot ${s.id} old=${s.merkle_root} recomputed=${recomputed} operator-accepted via env`);
      continue;
    }
    violations.push(`${s.id} (stored=${s.merkle_root} recomputed=${recomputed})`);
  }
  if (violations.length > 0) {
    throw new Error(`MIGRATION_P1_ANCHOR_ROOT_CHANGED: ${violations.join('; ')} — restatement is H2, aborting (add snapshot id to C2_MIGRATION_ACCEPT_ROOT_CHANGE to accept)`);
  }
}
```

Replace the old inline gate block with a call to `runP1Gate(db)` at the same point inside the `db.transaction` in `backfillPeriodIds`. Verify `je_json` / `period_id` are the actual `journal_entries` column names (grep the schema).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && npx vitest run test/backfillP1.test.ts && npx vitest run test/backfillPeriod*.test.ts && npx tsc --noEmit`
Expected: PASS. The existing C2 backfill test that asserted the old entity-wide abort must be updated to the precise semantics — a multi-period anchored entity whose roots still recompute-equal now PASSES (that's the point). Update and note in commit.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/store/backfillPeriod.ts services/api/test/backfillP1.test.ts services/api/test/helpers/p1.ts
git commit -m "feat(api): P1 migration gate per-snapshot root recompute (kills entity-wide false positive) + env escape-hatch with migration_override_log"
```

---

## Task 7: Export restatement disclosure (C-F3, web)

**Files:**
- Modify: `web/src/api/types.ts` (AnchorStaleness type + CloseCockpitDTO field; AnchorDTO.superseded)
- Modify: `web/src/workspaces/export/assembleExport.ts:29-45,73-132`
- Test: `web/src/workspaces/export/assembleExport.disclosure.test.ts`

**Interfaces:**
- Consumes: `anchorStaleness` from the cockpit DTO (T4), passed into `assembleExport`.
- Produces: when the period is stale, `assembleExport` returns a clear restatement disclosure outcome (`{ ok: false, kind: 'stale-restatement', anchoredSeq, latestSnapshotSeq }`) instead of an opaque L2/proof `error`.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/workspaces/export/assembleExport.disclosure.test.ts
import { describe, it, expect } from 'vitest';
import { assembleExport } from './assembleExport';

const base = {
  entityId: 'e', periodId: '2026-Q2', functionalCurrency: 'USD', scale: 2,
  generatedAt: '2026-07-06T00:00:00Z', events: [], anchors: [],
  fetchProof: async () => ({ anchors: [], inclusionProof: null }),
};

describe('assembleExport restatement disclosure (C-F3)', () => {
  it('returns stale-restatement when anchorStaleness.stale, not an opaque error', async () => {
    const out = await assembleExport({
      ...base,
      journal: [{ je: { idempotencyKey: 'k1' }, leafHash: 'x' } as never],
      anchorStaleness: { stale: true, anchoredSeq: 1, anchoredRoot: 'aa', currentRoot: 'bb', latestSnapshotSeq: 1 },
    });
    expect(out.ok).toBe(false);
    expect((out as { kind: string }).kind).toBe('stale-restatement');
    expect((out as { anchoredSeq: number }).anchoredSeq).toBe(1);
  });

  it('empty journal still short-circuits to empty regardless of staleness', async () => {
    const out = await assembleExport({ ...base, journal: [], anchorStaleness: { stale: true, anchoredSeq: 1, anchoredRoot: 'aa', currentRoot: null, latestSnapshotSeq: 1 } });
    expect((out as { kind: string }).kind).toBe('empty');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/workspaces/export/assembleExport.disclosure.test.ts`
Expected: FAIL — `anchorStaleness` param unknown / no `stale-restatement` kind.

- [ ] **Step 3: Add the type + disclosure branch**

In `web/src/api/types.ts` add:

```ts
export interface AnchorStaleness {
  stale: boolean; anchoredSeq: number; anchoredRoot: string;
  currentRoot: string | null; latestSnapshotSeq: number;
}
```

Add `anchorStaleness: AnchorStaleness | null` to the close-cockpit DTO type, and `superseded?: boolean` to `AnchorDTO`.

In `assembleExport.ts`, add `anchorStaleness?: AnchorStaleness | null` to the args type (line 29-40) and extend `ExportFailure`:

```ts
export type ExportFailure =
  | { ok: false; kind: 'imbalance'; debit: string; credit: string }
  | { ok: false; kind: 'empty' }
  | { ok: false; kind: 'stale-restatement'; anchoredSeq: number; latestSnapshotSeq: number }
  | { ok: false; kind: 'error'; message: string };
```

After the empty guard (line 44), before the try block, add:

```ts
  // C-F3: a stale anchor means the on-chain proof no longer matches the current books.
  // Surface an explicit restatement disclosure instead of failing opaquely inside the
  // L2/proof loop. Empty journal already returned above.
  if (args.anchorStaleness?.stale) {
    return {
      ok: false, kind: 'stale-restatement',
      anchoredSeq: args.anchorStaleness.anchoredSeq,
      latestSnapshotSeq: args.anchorStaleness.latestSnapshotSeq,
    };
  }
```

Destructure `anchorStaleness` from args at line 41. Then update the `ExportWorkspace.tsx` consumer to render the disclosure (a `stale-restatement` branch showing "Restatement in progress — on-chain anchor corresponds to superseded v{anchoredSeq}; re-anchor v{latestSnapshotSeq} before distributing"). Wire the cockpit's `anchorStaleness` through `useExportData`/props into the `assembleExport` call.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/workspaces/export/ && npx tsc --noEmit`
Expected: PASS. Fix any existing export test whose fixture now needs `anchorStaleness` (default `null` = no change in behavior).

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/workspaces/export/assembleExport.ts web/src/workspaces/export/ExportWorkspace.tsx web/src/workspaces/export/assembleExport.disclosure.test.ts
git commit -m "feat(web): export surfaces explicit stale-restatement disclosure instead of opaque proof error (C-F3)"
```

---

## Task 8: Minimal cockpit UI — amber chip + CTA copy + RWD

**Files:**
- Modify: `web/src/workspaces/close/CloseCockpit.tsx:36-42`
- Modify: `web/src/workspaces/close/close.css:94-108`
- Modify: `web/src/steps/AnchorStep.tsx` (Freeze CTA copy)
- Test: `web/src/workspaces/close/CloseCockpit.staleAnchor.test.tsx` + `web/e2e/stale-anchor.spec.ts`

**Interfaces:**
- Consumes: `anchorStaleness` from cockpit DTO (T4/T7 type).
- Produces: amber chip badge in the period-ribbon; Freeze CTA reads "Freeze restatement (v{latestSnapshotSeq+1})" when stale; ribbon wraps at 390px.

- [ ] **Step 1: Write the failing component test**

```tsx
// web/src/workspaces/close/CloseCockpit.staleAnchor.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CloseCockpit } from './CloseCockpit';
import { renderWithProviders } from '../../test/helpers'; // existing helper w/ Router+query

function cockpit(overrides = {}) {
  return { status: 'OPEN', lights: [], anchored: true, closeable: false, reopenCount: 1,
    restatementReason: null, reasonCode: null, staleAnchor: true,
    anchorStaleness: { stale: true, anchoredSeq: 1, anchoredRoot: 'aabbccddeeff0011', currentRoot: 'ffee', latestSnapshotSeq: 1 },
    ...overrides };
}

describe('CloseCockpit stale anchor badge', () => {
  it('renders an amber (not red) chip with anchored version', () => {
    renderWithProviders(<CloseCockpit /* inject cockpit() via mocked hook */ />);
    const badge = screen.getByText(/Books changed since anchor \(v1\)/i);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/stale-anchor/); // amber chip class, not a debit/blocking class
    expect(badge.className).not.toMatch(/debit|blocking/);
  });
});
```

Adapt injection to how `CloseCockpit` gets its data (it uses `useCloseCockpit(entityId)` — mock that hook to return `cockpit()`). Match the existing test style in `web/src/workspaces/close/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/workspaces/close/CloseCockpit.staleAnchor.test.tsx`
Expected: FAIL — copy is currently "stale anchor — re-lock & re-anchor", no version, class not a chip.

- [ ] **Step 3: Update the badge + CTA + CSS**

In `CloseCockpit.tsx:36-42`, replace the `staleAnchor` span with a chip driven by `anchorStaleness`:

```tsx
        {data.anchorStaleness?.stale && (
          <span className="stale-anchor-chip" role="alert">
            ⚠ Books changed since anchor (v{data.anchorStaleness.anchoredSeq})
          </span>
        )}
```

In `close.css`, replace `.stale-anchor-warn` (line 108) with a chip style (mirror `Badge.module.css:35-39` chip shape, amber tokens) and add `flex-wrap: wrap` to the ribbon (line 94-102):

```css
.period-ribbon { /* existing rules… */ flex-wrap: wrap; }
.stale-anchor-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px;
  font-size: var(--text-xs); font-weight: 600;
  color: var(--warn, #c28a1e);
  background: color-mix(in srgb, var(--warn, #c28a1e) 12%, transparent);
  overflow-wrap: anywhere;
}
```

In `AnchorStep.tsx`, when the period is stale, set the Freeze button label to `Freeze restatement (v{latestSnapshotSeq + 1})` (compute from the cockpit staleness passed as prop); otherwise keep "Freeze snapshot".

- [ ] **Step 4: Run component tests + typecheck**

Run: `cd web && npx vitest run src/workspaces/close/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Playwright 390px verification (RWD rule)**

Create `web/e2e/stale-anchor.spec.ts` driving: seed an anchored period, reopen + edit, load the cockpit at 390px, assert (a) the amber chip is visible and readable, (b) `page` has no horizontal overflow (`document.documentElement.scrollWidth <= clientWidth`), (c) the Freeze CTA reads "Freeze restatement (v2)". Follow the existing e2e harness/wallet-mock conventions in `web/e2e/`.

Run: `cd web && npx playwright test e2e/stale-anchor.spec.ts`
Expected: PASS (or honest-skip with reason if wallet-gated anchor state can't be reached — document like existing e2e skips).

- [ ] **Step 6: Commit**

```bash
git add web/src/workspaces/close/CloseCockpit.tsx web/src/workspaces/close/close.css web/src/steps/AnchorStep.tsx web/src/workspaces/close/CloseCockpit.staleAnchor.test.tsx web/e2e/stale-anchor.spec.ts
git commit -m "feat(web): amber stale-anchor chip + 'Freeze restatement (vN)' CTA + ribbon flex-wrap (W-F1/W-F2/W-F3/W-F4)"
```

---

## Task 9: Monkey suite + acceptance gate

**Files:**
- Create: `services/api/test/monkey.h2.test.ts`
- Test: full-suite run across workspaces

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the monkey tests**

Cover the spec §4 monkey list. Each assertion below is one `it`:

1. **Restate bombardment** — loop 5 restatements (reopen+edit+freeze), assert seq climbs 1→6 and each row's `supersedesSeq === seq-1` (chain integrity).
2. **Env garbage** — `C2_MIGRATION_ACCEPT_ROOT_CHANGE = 'nonexistent-id,  , '` (nonexistent id, blank, whitespace) → a real violation still aborts; no override rows written for blanks.
3. **Concurrent freeze race** — fire two `POST /snapshot` for the same entity "simultaneously" (Promise.all); assert exactly one seq is created per distinct root (mutex + UNIQUE hold), no crash, no duplicate seq.
4. **DB forgery** — hand-edit a `snapshots.merkle_root` and `seq` directly, then assert `deriveAnchorStaleness` reports stale (recompute catches the tamper) and `SqliteSnapshotRepo.get` on a corrupted `manifest_json` throws.
5. **Id string craft** — attempt a period id with a leading-zero-ish / delimiter-collision payload (`2026-Q2` vs `2026-Q2-1` style); assert `getLatestSnapshot`/`getSnapshot` don't cross-resolve between `snap-e-2026-Q2-1` and a crafted colliding id (the opening-equity I1 lesson).

- [ ] **Step 2: Run the monkey suite**

Run: `cd services/api && npx vitest run test/monkey.h2.test.ts`
Expected: PASS (5 tests). Fix any real defect they expose in the code, not the test.

- [ ] **Step 3: Full acceptance gate**

Run each and record the numbers (report counts, not adjectives):

```bash
cd services/api && npx vitest run          # expect: all green, record N/N
cd services/rules-engine && npx vitest run # expect: all green (unchanged)
cd web && npx vitest run                   # expect: all green, record N/N
cd <repo root> && npm run typecheck        # expect: exit 0 all workspaces
cd web && npm run build                    # expect: exit 0
```

`sui move test` is **N/A** — zero Move changes this plan (state explicitly, do not silently skip).

- [ ] **Step 4: Commit**

```bash
git add services/api/test/monkey.h2.test.ts
git commit -m "test(api): H2 monkey suite — restate bombardment, env garbage, freeze race, DB forgery, id-craft"
```

---

## Post-plan gates (from spec §4)

1. **Final whole-branch review** with the most capable model — verify the 409 dead-end is truly killed (regression test red before / green after), provenance chain integrity, no silent skips.
2. **dual-review** (dev-rules two-round): external independent (fresh-context subagent while codex quota exhausted) + project-rules round. For any Move-adjacent concern → N/A (zero .move). Integrate findings before merge.
3. **fresh-context verifier** (non-self-acceptance): read-back with line-number evidence + real test runs of all four suites.

---

## Self-Review

**1. Spec coverage:**
- §3.1 SqliteSnapshotRepo + freeze semantics → T2, T3 ✓
- §3.1 restatement provenance (C-F1/C-F4) → T1 (cols), T2 (injection), T3 (snapshot from reopen) ✓
- §3.1 anchor guards S-F1/S-F2 → T5 ✓
- §3.2 STALE_ANCHOR derivation + empty-journal (S-F4) + replaces proxy (W-F1 source) → T4 ✓
- §3.2 DTO anchorStaleness + latestSnapshotSeq (W-F2) + anchors superseded → T4, T5, T7 ✓
- §3.2 export disclosure (C-F3) → T7 ✓
- §3.2 minimal UI amber/CTA/RWD (W-F1/F3/F4/F5) → T8 ✓
- §3.2 codec drift (S-F5) → note only, not implemented (spec says "not implemented, V1 only") ✓
- §3.2 proof semantics (S-F3) → anchors DTO `superseded` signals "don't verify with current proof" (T5); export honors it (T7) ✓
- §3.3 P1 precision + escape-hatch + migration_override_log (C-F2) → T6, T1 ✓
- §4 monkey → T9 ✓

**2. Placeholder scan:** No TBD/TODO; every code step has concrete code. Harness helper names (`buildTestApp`, `insertJournalRow`, `seedAnchoredSnapshot`) are specified with their contract and a "reuse existing / create thin" instruction — acceptable as they're test scaffolding whose exact shape depends on existing fixtures the implementer must grep.

**3. Type consistency:** `AnchorStaleness` fields identical across T4 (api), T7 (web types), T8 (consumer). `RestatementProvenance` fields consistent T2↔T3. `getLatestSnapshotSeq` returns 0-if-none used consistently in T4/T5. `supersedesSeq ?? 0` DTO convention held in T3/T5.

**Known implementer flags (grep-to-confirm, not blockers):** exact `journal_entries` column names (`je_json`/`period_id`), the real `listJournal` import path + `JournalRow.jeJson` property, and whether a test app harness already exists — all called out inline in the relevant steps.
