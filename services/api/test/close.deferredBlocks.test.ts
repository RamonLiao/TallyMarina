// services/api/test/close.deferredBlocks.test.ts
//
// `deferred` means "we have not decided yet". Closing a period is an assertion that every
// material break and every blocking exception HAS been decided — the anchored snapshot is the
// artifact an auditor later relies on. Letting an undecided item through the close gate turns
// "deferred" into a silent "dismissed", except no human ever signed a reason code for it.
//
// Only `resolved` (a correcting entry exists) and `dismissed` (a human accepted it with a reason
// code) clear the gate. `open`, `deferred`, and — critically — any state this file does not know
// about must block. The predicate is an allow-list for exactly that reason: adding a fifth
// DispositionState should default to blocking close, never to permitting it.
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { applyDisposition, blocksClose } from '../src/exceptions/disposition.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { openMaterialReconBlockers } from '../src/reconciliation/collect.js';
import { applyReconDisposition } from '../src/reconciliation/disposition.js';
import { loadReconFixture } from '../src/reconciliation/fixture.js';

const EID = 'acme:pilot-001';
const PERIOD = '2026-Q2';

function seedEntity(db: Db) {
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
}

function lockPeriod(db: Db) {
  db.prepare(
    `INSERT INTO period_lock (entity_id, period_id, status, locked_at, locked_by, lights_snapshot, reopen_count)
     VALUES (?, ?, 'LOCKED', 0, 'test', '[]', 0)`,
  ).run(EID, PERIOD);
}

/** Put every fixture row into `state`. With no JEs posted, all four rows are material breaks. */
function disposeAllBreaks(db: Db, state: 'deferred' | 'resolved' | 'dismissed') {
  for (const row of loadReconFixture(EID)) {
    applyReconDisposition(db, {
      entityId: EID, periodId: PERIOD, wallet: row.wallet, coinType: row.coinType,
      to: state, reasonCode: 'error', reasonNote: null, decidedBy: 'test', now: 1,
    });
  }
}

describe('blocksClose — allow-list, not deny-list', () => {
  it('clears only on resolved and dismissed', () => {
    expect(blocksClose({ state: 'resolved' })).toBe(false);
    expect(blocksClose({ state: 'dismissed' })).toBe(false);
  });

  it('blocks on open, on deferred, and on no disposition at all', () => {
    // An undecided break is indistinguishable, for close purposes, from an untouched one.
    expect(blocksClose({ state: 'open' })).toBe(true);
    expect(blocksClose({ state: 'deferred' })).toBe(true);
    expect(blocksClose(null)).toBe(true);
  });

  it('blocks on a state it has never heard of', () => {
    // A future DispositionState, or a corrupted row, must fail closed. This is the property the
    // old `d === null || d.state === 'open'` form silently inverted.
    expect(blocksClose({ state: 'escalated' as never })).toBe(true);
    expect(blocksClose({ state: 'Deferred' as never })).toBe(true); // exact match, no case folding
  });
});

describe('recon close gate honours deferred', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); seedEntity(db); });

  it('deferred material breaks still block', () => {
    const before = openMaterialReconBlockers(db, EID, PERIOD).length;
    expect(before).toBeGreaterThan(0); // guard: the fixture really does produce material breaks

    disposeAllBreaks(db, 'deferred');
    expect(openMaterialReconBlockers(db, EID, PERIOD).length).toBe(before);
  });

  it('resolved material breaks clear the gate', () => {
    disposeAllBreaks(db, 'resolved');
    expect(openMaterialReconBlockers(db, EID, PERIOD)).toEqual([]);
  });

  it('dismissed material breaks clear the gate', () => {
    disposeAllBreaks(db, 'dismissed');
    expect(openMaterialReconBlockers(db, EID, PERIOD)).toEqual([]);
  });
});

describe('monkey: a corrupted disposition state must not open the gate', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); seedEntity(db); });

  it('a state SQLite returns that TypeScript never allowed still blocks close', () => {
    // The unit tests above cast their way past the type. This one writes the garbage where it can
    // actually come from — the DB has no CHECK constraint on `state`, so a bad migration, a manual
    // UPDATE, or a future enum value reaches blocksClose as a plain string. If the predicate were a
    // deny-list, every one of those would silently clear the close gate and get anchored on-chain.
    const row = loadReconFixture(EID)[0]!;
    db.prepare(
      `INSERT INTO recon_break_disposition (entity_id, period_id, wallet, coin_type, state, reason_code, reason_note, decided_by, decided_at)
       VALUES (?, ?, ?, ?, 'escalated', 'error', NULL, 'corrupt', 1)`,
    ).run(EID, PERIOD, row.wallet, row.coinType);

    const blockers = openMaterialReconBlockers(db, EID, PERIOD);
    expect(blockers.some((b) => b.wallet === row.wallet && b.coinType === row.coinType)).toBe(true);
  });

  it('an empty-string state blocks close', () => {
    // `Number('')===0`-class bug, disposition edition: '' is falsy and would slip through any
    // truthiness-based check.
    const row = loadReconFixture(EID)[0]!;
    db.prepare(
      `INSERT INTO recon_break_disposition (entity_id, period_id, wallet, coin_type, state, reason_code, reason_note, decided_by, decided_at)
       VALUES (?, ?, ?, ?, '', 'error', NULL, 'corrupt', 1)`,
    ).run(EID, PERIOD, row.wallet, row.coinType);

    expect(openMaterialReconBlockers(db, EID, PERIOD).some((b) => b.wallet === row.wallet)).toBe(true);
  });
});

describe('freeze gate honours deferred', () => {
  let db: Db; let app: FastifyInstance;
  beforeEach(async () => {
    db = openDb(':memory:'); seedEntity(db); lockPeriod(db);
    app = Fastify();
    registerRoutes(app, { db, cfg: { reconLiveWallet: '0xreal', explorerBase: 'https://x' } as never, classifyClient: {} as never, copilotClient: {} as never, anchorAdapter: null as never, mutex: { run: (_k: string, fn: () => Promise<never>) => fn() }, memory: new OffMemory() });
    await app.ready();
  });

  it('POST /snapshot still 409s when every material break is merely deferred', async () => {
    disposeAllBreaks(db, 'deferred');
    const res = await app.inject({ method: 'POST', url: `/entities/${EID}/snapshot`, payload: { periodId: PERIOD } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('RECON_BREAKS_BLOCKING');
  });

  it('close-readiness counts deferred breaks as blocking', async () => {
    disposeAllBreaks(db, 'deferred');
    const res = await app.inject({ method: 'GET', url: `/entities/${EID}/close-readiness` });
    expect(res.json().recon.blocking).toBeGreaterThan(0);
    expect(res.json().closeable).toBe(false);
  });

  // The exception half of the same endpoint. It was missed on the first pass precisely because no
  // test covered it: /close-readiness reported closeable while POST /snapshot 409'd. A readiness
  // probe that disagrees with the gate it probes is worse than having no probe.
  it('close-readiness counts a deferred blocking exception as blocking', async () => {
    disposeAllBreaks(db, 'resolved'); // clear the recon half so only the exception can block
    insertEvent(db, { id: 'ev-deferred', entityId: EID, rawJson: JSON.stringify({ kind: 'x', eventTime: '2026-05-01T00:00:00Z' }) });
    setAiSuggestion(db, 'ev-deferred', {
      aiEventType: 'X', aiPurpose: 'p', aiCounterparty: null,
      aiConfidence: 0.4, aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW',
    }); // → a CLASSIFY_REVIEW exception, which is in BLOCKING_CATEGORIES

    const open = await app.inject({ method: 'GET', url: `/entities/${EID}/close-readiness` });
    expect(open.json().exceptions.blocking).toBe(1); // guard: the exception really is blocking

    applyDisposition(db, {
      entityId: EID, category: 'CLASSIFY_REVIEW', eventId: 'ev-deferred', to: 'deferred',
      reasonCode: 'PENDING_DOC', decidedBy: 'test', now: 1,
    });

    const res = await app.inject({ method: 'GET', url: `/entities/${EID}/close-readiness` });
    expect(res.json().exceptions.blocking).toBe(1);
    expect(res.json().closeable).toBe(false);
  });

  it('close-readiness reports closeable once the blocking exception is genuinely resolved', async () => {
    // The other side of the guard: blocksClose must not over-block, or the gate is unpassable.
    disposeAllBreaks(db, 'resolved');
    insertEvent(db, { id: 'ev-resolved', entityId: EID, rawJson: JSON.stringify({ kind: 'x', eventTime: '2026-05-01T00:00:00Z' }) });
    setAiSuggestion(db, 'ev-resolved', {
      aiEventType: 'X', aiPurpose: 'p', aiCounterparty: null,
      aiConfidence: 0.4, aiReasoning: 'r', nextStatus: 'NEEDS_REVIEW',
    });
    applyDisposition(db, {
      entityId: EID, category: 'CLASSIFY_REVIEW', eventId: 'ev-resolved', to: 'resolved',
      reasonCode: 'PENDING_DOC', decidedBy: 'test', now: 1,
    });

    const res = await app.inject({ method: 'GET', url: `/entities/${EID}/close-readiness` });
    expect(res.json().exceptions.blocking).toBe(0);
    expect(res.json().closeable).toBe(true);
  });
});
