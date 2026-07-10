// services/api/test/monkey.h2.test.ts
// H2 MONKEY SUITE — project rule: "想辦法把程式玩壞" (Rule 9: encode WHY, not just WHAT).
// Attacks Tasks 1-8 of H2 snapshot-persistence: seq/provenance chain, restate-on-freeze,
// concurrent freeze mutex + UNIQUE, STALE_ANCHOR derivation, P1 escape-hatch, and the
// snap-{entity}-{period}-{seq} composite id (opening-equity I1 delimiter-collision lesson).
// See .superpowers/sdd/task-9-brief.md.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeEntityMutex } from '@subledger/anchor-svc';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import {
  insertSnapshot, getSnapshot, getLatestSnapshot, listSnapshotsForPeriod, setSnapshotStatus,
} from '../src/store/snapshotStore.js';
import { SqliteSnapshotRepo } from '../src/store/sqliteSnapshotRepo.js';
import { deriveAnchorStaleness } from '../src/periodLock/anchorStaleness.js';
import { runP1Gate } from '../src/store/backfillPeriod.js';
import { listMigrationOverrides } from '../src/store/migrationOverrideLog.js';
import { insertJournalRow } from './helpers/journal.js';
import { seedAnchoredSnapshot } from './helpers/p1.js';
import { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import { upsertReconDisposition } from '../src/store/reconBreakStore.js';

// ---------------------------------------------------------------------------
// Shared freeze-route helpers (mirrors freeze.restate.test.ts's pattern).
// ---------------------------------------------------------------------------
const PERIOD_ID = '2026-Q2';
const RECON_BREAKS = [
  '0xacmeTreasury|0x2::sui::SUI',
  '0xacmeTreasury|0xbeef::usdc::USDC',
  '0xacmeTreasury|0xcafe::weth::WETH',
  '0xacmeTreasury|0xdead::usdt::USDT',
];

function dismissReconBreaks(db: Db, entityId: string, periodId: string) {
  for (const key of RECON_BREAKS) {
    const [wallet, coinType] = key.split('|') as [string, string];
    upsertReconDisposition(db, {
      entityId, periodId, wallet, coinType, state: 'dismissed',
      reasonCode: 'unidentified', reasonNote: null, decidedBy: 'test', decidedAt: Date.now(),
    });
  }
}

interface Ctx { app: FastifyInstance & { _db: Db }; db: Db; entityId: string; periodId: string }

async function seedLockedPeriodWithJE(ctx: Ctx) {
  const { app, db, entityId, periodId } = ctx;
  await app.inject({ method: 'POST', url: `/entities/${entityId}/ingest`, payload: {} });
  await app.inject({ method: 'POST', url: `/entities/${entityId}/run-rules`, payload: { periodId } });
  dismissReconBreaks(db, entityId, periodId);
  const lockR = await app.inject({ method: 'POST', url: `/entities/${entityId}/period/lock`, payload: { periodId } });
  if (lockR.statusCode !== 200) throw new Error(`seedLockedPeriodWithJE: lock failed ${lockR.statusCode} ${lockR.body}`);
}

async function reopenAndEditJE(ctx: Ctx, bumpBy: bigint) {
  const { app, db, entityId, periodId } = ctx;
  const reopenR = await app.inject({
    method: 'POST', url: `/entities/${entityId}/period/reopen`,
    payload: { periodId, restatementReason: 'late-arriving info', reasonCode: 'LATE_ARRIVING_TXN' },
  });
  if (reopenR.statusCode !== 200) throw new Error(`reopenAndEditJE: reopen failed ${reopenR.statusCode} ${reopenR.body}`);

  const row = db.prepare(
    'SELECT id, je_json FROM journal_entries WHERE entity_id = ? AND period_id = ? LIMIT 1',
  ).get(entityId, periodId) as { id: string; je_json: string };
  const je = JSON.parse(row.je_json) as { lines: Array<{ side: 'DEBIT' | 'CREDIT'; amountMinor: string }> };
  const debit = je.lines.find((l) => l.side === 'DEBIT')!;
  const credit = je.lines.find((l) => l.side === 'CREDIT')!;
  debit.amountMinor = String(BigInt(debit.amountMinor) + bumpBy);
  credit.amountMinor = String(BigInt(credit.amountMinor) + bumpBy);
  db.prepare('UPDATE journal_entries SET je_json = ? WHERE id = ?').run(JSON.stringify(je), row.id);

  dismissReconBreaks(db, entityId, periodId);
  const lockR = await app.inject({ method: 'POST', url: `/entities/${entityId}/period/lock`, payload: { periodId } });
  if (lockR.statusCode !== 200) throw new Error(`reopenAndEditJE: re-lock failed ${lockR.statusCode} ${lockR.body}`);
}

// ---------------------------------------------------------------------------
// MONKEY 1: Restate bombardment
// WHY: the restate-on-freeze fix (Task 3) must hold under repeated hammering, not just
// a single reopen→re-freeze cycle. If seq assignment or supersedesSeq wiring regresses
// under repetition (e.g. an off-by-one that only shows up after v3+), a single-cycle
// test would miss it — this proves the chain stays gapless/dupe-free across 5 cycles.
// ---------------------------------------------------------------------------
describe('MONKEY 1: restate bombardment (5x reopen→edit→freeze)', () => {
  it('seq climbs 1→6 with every row supersedesSeq === seq-1, no gaps/dupes', async () => {
    const app = await buildTestApp();
    const ctx: Ctx = { app, db: app._db, entityId: TEST_ENTITY_ID, periodId: PERIOD_ID };
    await seedLockedPeriodWithJE(ctx);

    const first = await app.inject({ method: 'POST', url: `/entities/${ctx.entityId}/snapshot`, payload: { periodId: PERIOD_ID } });
    expect(first.statusCode).toBe(200);
    expect(first.json().snapshot.seq).toBe(1);

    for (let i = 0; i < 5; i++) {
      await reopenAndEditJE(ctx, 1n); // distinct bump each cycle so the root always changes → real restate, not idempotent no-op
      const r = await app.inject({ method: 'POST', url: `/entities/${ctx.entityId}/snapshot`, payload: { periodId: PERIOD_ID } });
      expect(r.statusCode).toBe(200);
      expect(r.json().snapshot.seq).toBe(i + 2);
    }

    const rows = listSnapshotsForPeriod(ctx.db, ctx.entityId, PERIOD_ID);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6]); // gapless, ascending
    for (const row of rows) {
      if (row.seq === 1) {
        expect(row.supersedesSeq).toBeNull();
      } else {
        expect(row.supersedesSeq).toBe(row.seq - 1); // chain integrity: no skipped/duplicated links
      }
    }
    // No duplicate seq values (Set collapse must not lose rows).
    expect(new Set(rows.map((r) => r.seq)).size).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// MONKEY 2: Env garbage on the P1 migration escape-hatch
// WHY: C2_MIGRATION_ACCEPT_ROOT_CHANGE is an operator-controlled allow-list of snapshot
// ids. If the parse doesn't trim/filter blanks, or if a nonexistent id is silently
// treated as "matched", the gate could either false-accept an unrelated violation or
// (worse) log a bogus override row for an id that was never actually reviewed.
// ---------------------------------------------------------------------------
describe('MONKEY 2: env garbage on P1 escape-hatch', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => { delete process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE; });

  it('nonexistent id + blanks/whitespace does not accept a real violation and writes zero override rows', () => {
    const { storedRoot } = seedAnchoredSnapshot(db, { matchesCurrentBooks: false });
    process.env.C2_MIGRATION_ACCEPT_ROOT_CHANGE = 'nonexistent, , ';
    expect(() => runP1Gate(db)).toThrow(/MIGRATION_P1_ANCHOR_ROOT_CHANGED/);
    try {
      runP1Gate(db);
    } catch (err) {
      expect((err as Error).message).toContain(storedRoot); // the real violation surfaces, not swallowed
    }
    expect(listMigrationOverrides(db)).toHaveLength(0); // blanks/nonexistent must never be logged as accepted
  });
});

// ---------------------------------------------------------------------------
// MONKEY 3: Concurrent same-period freeze — no double insert
// WHY: two near-simultaneous POST /snapshot calls (double-click, retry-on-timeout)
// must collapse to exactly one snapshot, never a crash or a duplicate seq.
// HONEST SCOPE (do not overclaim): the freeze route's critical section — the
// getLatestSnapshot read → same-root decision → insert — is fully SYNCHRONOUS
// (better-sqlite3 + a non-awaited buildSnapshot; see routes.ts:766-846, zero `await`
// inside). Under single-threaded JS that block runs to completion without yielding,
// so the two requests CANNOT interleave inside it regardless of the mutex. The first
// commits seq 1 atomically; the second reads that row and takes the idempotent
// same-root branch, returning seq 1 without a second insert. This test therefore
// proves the no-double-insert / idempotency guarantee. It does NOT exercise mutex
// serialization or the UNIQUE(entity,period,seq) backstop — no duplicate insert is
// ever attempted, and the sync block is already atomic. Those remain correctness-in-
// depth for any future `await` introduced into the critical section. We still wire the
// real mutex (not a stub) so the path matches production, but the guarantee under test
// is idempotency, not serialization.
// ---------------------------------------------------------------------------
describe('MONKEY 3: concurrent same-period freeze — no double insert', () => {
  it('two concurrent POST /snapshot for the same entity/period/root: exactly one seq, no crash, no dupe', async () => {
    const mutex = makeEntityMutex(); // real production mutex wired in (path parity), though the sync critical section is what makes this atomic
    const app = await buildTestApp(true, undefined, undefined, mutex);
    const ctx: Ctx = { app, db: app._db, entityId: TEST_ENTITY_ID, periodId: PERIOD_ID };
    await seedLockedPeriodWithJE(ctx);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/entities/${ctx.entityId}/snapshot`, payload: { periodId: PERIOD_ID } }),
      app.inject({ method: 'POST', url: `/entities/${ctx.entityId}/snapshot`, payload: { periodId: PERIOD_ID } }),
    ]);

    expect(a.statusCode).toBe(200); // no crash on either leg of the race
    expect(b.statusCode).toBe(200);
    expect(a.json().snapshot.seq).toBe(1);
    expect(b.json().snapshot.seq).toBe(1); // same root → idempotent branch, not a second seq

    const rows = listSnapshotsForPeriod(ctx.db, ctx.entityId, PERIOD_ID);
    expect(rows).toHaveLength(1); // exactly one row: first inserted, second took the idempotent same-root path
  });
});

// ---------------------------------------------------------------------------
// MONKEY 4: DB forgery
// WHY: an operator (or bug) hand-editing snapshots.merkle_root/manifest_json directly
// in the DB bypasses every application-level guard. deriveAnchorStaleness's recompute
// must still catch the tamper (proving staleness is *derived*, not trusted from the
// stored row), and SqliteSnapshotRepo.get must fail loud rather than silently returning
// a corrupted manifest.
// ---------------------------------------------------------------------------
describe('MONKEY 4: DB forgery', () => {
  const E = 'ent-forge', P = '2026-Q2';
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    insertEntity(db, { id: E, displayName: 'X', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
  });

  it('hand-edited merkle_root: deriveAnchorStaleness reports stale (recompute catches the tamper)', () => {
    const { root } = insertJournalRow(db, E, P);
    insertSnapshot(db, {
      id: `snap-${E}-${P}-1`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: 'h',
      merkleRoot: root, leafCount: 1, supersedesSeq: null, seq: 1,
      restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null,
      restatementRequestedBy: null, restatementApprovedBy: null,
    });
    setSnapshotStatus(db, `snap-${E}-${P}-1`, 'ANCHORED');
    // Sanity: before the forgery, books are genuinely non-stale.
    expect(deriveAnchorStaleness(db, E, P)!.stale).toBe(false);

    // Forgery: directly rewrite the stored root without going through insertSnapshot/freeze
    // (the brief's "and/or seq" — seq is part of the PK here, so root is the tamper vector
    // that actually exercises the recompute-vs-stored comparison in deriveAnchorStaleness).
    db.prepare('UPDATE snapshots SET merkle_root = ? WHERE id = ?').run('f'.repeat(64), `snap-${E}-${P}-1`);

    const s = deriveAnchorStaleness(db, E, P)!;
    expect(s.stale).toBe(true); // recompute (from real journal) disagrees with the forged stored root
    expect(s.anchoredRoot).toBe('f'.repeat(64));
    expect(s.currentRoot).toBe(root); // the real, recomputed root — untouched by the forgery
  });

  it('hand-corrupted manifest_json: SqliteSnapshotRepo.get throws (fail-loud, not a silent bad read)', () => {
    const repo = new SqliteSnapshotRepo(db);
    repo.freeze({
      manifest: {
        manifestVersion: 1, entityId: E, periodId: P, merkleRoot: 'aa', leafCount: 1,
        leafCodecVersion: 'JE_LEAF_BCS_V1', merkleParams: { hash: 'blake2b256', arity: 2 },
        policyVersions: ['demo-ps-1'], createdAtLogical: 1,
      } as never,
      manifestHash: 'h1',
    });
    db.prepare('UPDATE snapshots SET manifest_json = ? WHERE id = ?').run('{not-json', `snap-${E}-${P}-1`);
    expect(() => repo.get(E, P)).toThrow(); // must not return a half-parsed / undefined manifest
  });
});

// ---------------------------------------------------------------------------
// MONKEY 5: Id string craft (opening-equity I1 delimiter-collision lesson)
// WHY: snap-{entity}-{period}-{seq} is a dash-joined composite key with no escaping.
// (entityId="acme", periodId="2026-Q2-1", seq=1) and (entityId="acme-2026-Q2",
// periodId="1", seq=1) both render the IDENTICAL string "snap-acme-2026-Q2-1-1" —
// the same delimiter-collision class that bit idempotencyKey() in the opening-equity
// round (task-2-report.md). Real lookups must key off the entity_id/period_id COLUMNS,
// never re-derive from the id string, so two distinct tuples never cross-resolve.
// ---------------------------------------------------------------------------
describe('MONKEY 5: id string craft — delimiter collision on snap-{entity}-{period}-{seq}', () => {
  const E1 = 'acme', P1 = '2026-Q2-1';
  const E2 = 'acme-2026-Q2', P2 = '1';
  const collidingId = `snap-${E1}-${P1}-1`;

  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); insertEntity(db, { id: E1, displayName: 'X', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }); insertEntity(db, { id: E2, displayName: 'Y', chainObjectId: '0x4', capObjectId: '0x5', originalPackageId: '0x6' }); });

  it('sanity: the two distinct (entity,period) tuples really do render the same id string', () => {
    expect(`snap-${E2}-${P2}-1`).toBe(collidingId);
  });

  it('real row is only reachable via its OWN (entityId,periodId) — the colliding tuple resolves to nothing', () => {
    insertSnapshot(db, {
      id: collidingId, entityId: E1, periodId: P1, manifestJson: '{}', manifestHash: 'h', merkleRoot: 'rootA',
      leafCount: 1, supersedesSeq: null, seq: 1,
      restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null,
      restatementRequestedBy: null, restatementApprovedBy: null,
    });

    expect(getLatestSnapshot(db, E1, P1)!.merkleRoot).toBe('rootA');
    // The crafted tuple (E2,P2) that renders the same id string must NOT cross-resolve to E1's row.
    expect(getLatestSnapshot(db, E2, P2)).toBeNull();
    // getSnapshot by the raw id string returns E1's row content, never silently reattributed to E2.
    const byId = getSnapshot(db, collidingId)!;
    expect(byId.entityId).toBe(E1);
    expect(byId.periodId).toBe(P1);
  });

  it('a second insert attempt at the same colliding id (different entity/period) fails loud — no silent overwrite', () => {
    insertSnapshot(db, {
      id: collidingId, entityId: E1, periodId: P1, manifestJson: '{}', manifestHash: 'h', merkleRoot: 'rootA',
      leafCount: 1, supersedesSeq: null, seq: 1,
      restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null,
      restatementRequestedBy: null, restatementApprovedBy: null,
    });
    expect(() => insertSnapshot(db, {
      id: collidingId, entityId: E2, periodId: P2, manifestJson: '{}', manifestHash: 'h2', merkleRoot: 'rootB',
      leafCount: 1, supersedesSeq: null, seq: 1,
      restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null,
      restatementRequestedBy: null, restatementApprovedBy: null,
    })).toThrow(); // PK collision must throw, not silently overwrite E1's row with E2's content
    // E1's row is untouched by the rejected forgery attempt.
    expect(getSnapshot(db, collidingId)!.merkleRoot).toBe('rootA');
  });
});

// ---------------------------------------------------------------------------
// DETERMINISM INTEGRATION TEST (closes Task 4 review gap): the real freeze route's
// stored root must equal deriveAnchorStaleness's independent recompute. If buildSnapshot's
// merkle construction ever diverges from buildMerkle's (e.g. a codec/ordering change),
// this is the ONLY test that would catch it — every other staleness test hand-seeds a
// consistent root and would stay green even if the two code paths drifted apart.
// ---------------------------------------------------------------------------
describe('DETERMINISM: real freeze route root === deriveAnchorStaleness recompute', () => {
  it('freezing via the real route then anchoring reports non-stale', async () => {
    const app = await buildTestApp();
    const ctx: Ctx = { app, db: app._db, entityId: TEST_ENTITY_ID, periodId: PERIOD_ID };
    await seedLockedPeriodWithJE(ctx);

    const freezeR = await app.inject({ method: 'POST', url: `/entities/${ctx.entityId}/snapshot`, payload: { periodId: PERIOD_ID } });
    expect(freezeR.statusCode).toBe(200);
    const snapshotId = freezeR.json().snapshot.id as string;

    setSnapshotStatus(ctx.db, snapshotId, 'ANCHORED');

    const s = deriveAnchorStaleness(ctx.db, ctx.entityId, PERIOD_ID)!;
    expect(s).not.toBeNull();
    expect(s.stale).toBe(false); // buildSnapshot's stored root === buildMerkle's independent recompute
    expect(s.currentRoot).toBe(s.anchoredRoot);
  });
});
