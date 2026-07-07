// services/api/test/anchorGuards.test.ts
// S-F1 (on-chain supersedes_seq must be a CHAIN seq, not per-period snapshot seq) +
// S-F2 (refuse to anchor a superseded FROZEN snapshot) + anchors DTO `superseded` flag.
// See .superpowers/sdd/task-5-brief.md.
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertSnapshot } from '../src/store/snapshotStore.js';
import { insertAnchor } from '../src/store/anchorStore.js';
import { computeSupersedesChainSeq, prepareAnchor } from '../src/http/anchorService.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';
import { deriveEntityRef } from '../src/deps/anchorSvc.js';
import { loadConfig } from '../src/config.js';
import type { GeminiClient } from '../src/ai/geminiClient.js';

const E = 'ent-1', P = '2026-Q2';
function snap(db: Db, seq: number, status: 'FROZEN' | 'ANCHORED') {
  insertSnapshot(db, { id: `snap-${E}-${P}-${seq}`, entityId: E, periodId: P, manifestJson: '{}', manifestHash: `h${seq}`, merkleRoot: `r${seq}`, leafCount: 1, supersedesSeq: seq === 1 ? null : seq - 1, seq, status, restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
}

describe('anchor guards', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); insertEntity(db, { id: E, displayName: 'X', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }); });

  it('S-F1: computeSupersedesChainSeq returns prior anchor chain seq for same period, 0 if none', () => {
    // no prior anchor for this period → 0
    expect(computeSupersedesChainSeq(db, E, P)).toBe(0);
  });

  it('S-F1: returns the highest CHAIN seq among same-period anchors, not the snapshot per-period seq', () => {
    snap(db, 1, 'ANCHORED');
    // chain seq (entity-global) deliberately diverges from the snapshot's per-period seq (1)
    // to prove the two domains are not conflated.
    insertAnchor(db, { id: 'anchor-1', entityId: E, snapshotId: `snap-${E}-${P}-1`, seq: 7, link: 'l', digest: 'd1', explorerUrl: 'u1', anchoredAt: 'now' });
    expect(computeSupersedesChainSeq(db, E, P)).toBe(7);
  });

  it('S-F1 cross-period filter: an anchor in a DIFFERENT period must not leak into this period\'s value', () => {
    const OTHER_P = '2026-Q1';
    insertSnapshot(db, { id: `snap-${E}-${OTHER_P}-1`, entityId: E, periodId: OTHER_P, manifestJson: '{}', manifestHash: 'ho', merkleRoot: 'ro', leafCount: 1, supersedesSeq: null, seq: 1, status: 'ANCHORED', restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    // Anchor in the OTHER period at a high chain seq — must not leak into P's computation.
    insertAnchor(db, { id: 'anchor-other', entityId: E, snapshotId: `snap-${E}-${OTHER_P}-1`, seq: 99, link: 'l', digest: 'd0', explorerUrl: 'u0', anchoredAt: 'now' });
    // P itself has never been anchored.
    expect(computeSupersedesChainSeq(db, E, P)).toBe(0);

    // Now anchor P too, at a lower chain seq than the other period's anchor — must still
    // pick up P's own anchor (5), not the other period's higher one (99).
    snap(db, 1, 'ANCHORED');
    insertAnchor(db, { id: 'anchor-p', entityId: E, snapshotId: `snap-${E}-${P}-1`, seq: 5, link: 'l', digest: 'd1', explorerUrl: 'u1', anchoredAt: 'now' });
    expect(computeSupersedesChainSeq(db, E, P)).toBe(5);
  });
});

// ---- S-F2: prepareAnchor refuses to anchor a superseded (non-latest) FROZEN snapshot ----
const PKG_ID = '0x' + 'af'.repeat(32);
const CHAIN_OBJ = '0x' + '12'.repeat(32);
const CAP_OBJ = '0x' + '34'.repeat(32);
const WALLET = '0x' + '56'.repeat(32);
const VALID_HASH = 'ab'.repeat(32);
const VALID_ROOT = 'cd'.repeat(32);
const E2 = 'acme:sf2-entity';

const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'g',
  ANCHOR_PACKAGE_ID: PKG_ID,
  ANCHOR_ORIGINAL_PACKAGE_ID: '0x' + '78'.repeat(32),
  ENTITY_ID: E2, ENTITY_CHAIN_ID: CHAIN_OBJ, ENTITY_CAP_ID: CAP_OBJ,
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm', AI_MODEL_COPILOT: 'm',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});
const passthroughMutex = { run: <T>(_k: string, fn: () => Promise<T>) => fn() };

function fakeAdapter() {
  return {
    async getChainState() { return { entityRef: deriveEntityRef(E2), latestLink: new Uint8Array(32), seq: 0n, capEpoch: 0n }; },
    async getCapOwner() { return WALLET; },
    async waitForTransaction() { return; },
    async getAnchorEvent() { return { seq: 1n, link: new Uint8Array([7]) }; },
  } as never;
}

describe('S-F2: prepareAnchor rejects a superseded FROZEN snapshot', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    insertEntity(db, { id: E2, displayName: 'X', chainObjectId: CHAIN_OBJ, capObjectId: CAP_OBJ, originalPackageId: '0x' + '78'.repeat(32) });
    insertSnapshot(db, { id: 'snap-1', entityId: E2, periodId: P, manifestJson: '{}', manifestHash: VALID_HASH, merkleRoot: VALID_ROOT, leafCount: 1, supersedesSeq: null, seq: 1, status: 'FROZEN', restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    insertSnapshot(db, { id: 'snap-2', entityId: E2, periodId: P, manifestJson: '{}', manifestHash: VALID_HASH, merkleRoot: VALID_ROOT, leafCount: 1, supersedesSeq: 1, seq: 2, status: 'FROZEN', restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
  });

  it('throws 409 ANCHOR_SUPERSEDED when the target snapshot seq < latest snapshot seq for the period', async () => {
    await expect(
      prepareAnchor({ db, adapter: fakeAdapter(), mutex: passthroughMutex, cfg }, { entityId: E2, snapshotId: 'snap-1', walletAddress: WALLET }),
    ).rejects.toMatchObject({ code: 'ANCHOR_SUPERSEDED', statusCode: 409 });
  });

  it('boundary: allows anchoring the LATEST FROZEN snapshot (seq === latest)', async () => {
    const out = await prepareAnchor({ db, adapter: fakeAdapter(), mutex: passthroughMutex, cfg }, { entityId: E2, snapshotId: 'snap-2', walletAddress: WALLET });
    expect(typeof out.txKind).toBe('string');
  });
});

// ---- anchors list DTO: superseded flag ----
describe('GET /entities/:id/anchors — superseded flag', () => {
  let db: Db;
  let app: FastifyInstance;
  const E3 = 'acme:dto-entity';

  beforeEach(async () => {
    db = openDb(':memory:');
    insertEntity(db, { id: E3, displayName: 'X', chainObjectId: CHAIN_OBJ, capObjectId: CAP_OBJ, originalPackageId: '0x' + '78'.repeat(32) });
    // seq 1: anchored, then superseded by a re-freeze (seq 2, FROZEN, not yet anchored).
    insertSnapshot(db, { id: `snap-${E3}-1`, entityId: E3, periodId: P, manifestJson: '{}', manifestHash: VALID_HASH, merkleRoot: VALID_ROOT, leafCount: 1, supersedesSeq: null, seq: 1, status: 'ANCHORED', restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });
    insertAnchor(db, { id: 'anchor-1', entityId: E3, snapshotId: `snap-${E3}-1`, seq: 1, link: 'l1', digest: 'd1', explorerUrl: 'u1', anchoredAt: 'now' });
    insertSnapshot(db, { id: `snap-${E3}-2`, entityId: E3, periodId: P, manifestJson: '{}', manifestHash: VALID_HASH, merkleRoot: VALID_ROOT, leafCount: 1, supersedesSeq: 1, seq: 2, status: 'FROZEN', restatementReasonCode: null, restatementReason: null, affectedAmountEstimate: null, restatementRequestedBy: null, restatementApprovedBy: null });

    app = Fastify();
    registerRoutes(app, {
      db, cfg: loadConfig({
        SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'g', ANCHOR_PACKAGE_ID: PKG_ID,
        ANCHOR_ORIGINAL_PACKAGE_ID: '0x' + '78'.repeat(32), ENTITY_ID: E3,
        ENTITY_CHAIN_ID: CHAIN_OBJ, ENTITY_CAP_ID: CAP_OBJ,
        GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm', AI_MODEL_COPILOT: 'm',
        AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
        EXPLORER_BASE: 'https://suiscan.xyz/testnet',
      }),
      classifyClient: {} as GeminiClient, copilotClient: {} as GeminiClient,
      anchorAdapter: null as never,
      mutex: passthroughMutex,
      memory: new OffMemory(),
    });
    await app.ready();
  });

  it('marks an anchor row superseded:true when a later snapshot version exists for its period', async () => {
    const r = await app.inject({ method: 'GET', url: `/entities/${E3}/anchors` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { anchors: Array<{ id: string; superseded: boolean }> };
    const row = body.anchors.find((a) => a.id === 'anchor-1')!;
    expect(row.superseded).toBe(true);
  });

  it('the latest anchor reports superseded:false', async () => {
    // Re-anchor at seq 2 (the current latest snapshot version).
    insertAnchor(db, { id: 'anchor-2', entityId: E3, snapshotId: `snap-${E3}-2`, seq: 2, link: 'l2', digest: 'd2', explorerUrl: 'u2', anchoredAt: 'now' });
    const r = await app.inject({ method: 'GET', url: `/entities/${E3}/anchors` });
    const body = r.json() as { anchors: Array<{ id: string; superseded: boolean }> };
    const latest = body.anchors.find((a) => a.id === 'anchor-2')!;
    expect(latest.superseded).toBe(false);
    const old = body.anchors.find((a) => a.id === 'anchor-1')!;
    expect(old.superseded).toBe(true);
  });
});
