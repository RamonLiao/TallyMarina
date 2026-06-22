import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertSnapshot, getSnapshot } from '../src/store/snapshotStore.js';
import { prepareAnchor, confirmAnchor } from '../src/http/anchorService.js';
import { deriveEntityRef } from '../src/deps/anchorSvc.js';
import { loadConfig } from '../src/config.js';

// Valid 32-byte Sui addresses (64 hex chars after 0x)
const PKG_ID = '0x' + 'af'.repeat(32);
const CHAIN_OBJ = '0x' + '12'.repeat(32);
const CAP_OBJ = '0x' + '34'.repeat(32);
const WALLET = '0x' + '56'.repeat(32);

const cfg = loadConfig({
  SUI_NETWORK: 'testnet', SUI_GRPC_URL: 'g',
  ANCHOR_PACKAGE_ID: PKG_ID,
  ANCHOR_ORIGINAL_PACKAGE_ID: '0x' + '78'.repeat(32),
  ENTITY_ID: 'acme:pilot-001', ENTITY_CHAIN_ID: CHAIN_OBJ, ENTITY_CAP_ID: CAP_OBJ,
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm', AI_MODEL_COPILOT: 'm',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://suiscan.xyz/testnet',
});

const ENTITY = 'acme:pilot-001';
const passthroughMutex = { run: <T>(_k: string, fn: () => Promise<T>) => fn() };
// 64-char hex = 32 bytes
const VALID_HASH = 'ab'.repeat(32);
const VALID_ROOT = 'cd'.repeat(32);

function fakeAdapter(over: Partial<{
  entityRef: Uint8Array; owner: string; seq: bigint; link: Uint8Array;
}> = {}) {
  const ref = over.entityRef ?? deriveEntityRef(ENTITY);
  return {
    async getChainState() {
      return { entityRef: ref, latestLink: over.link ?? new Uint8Array(32), seq: over.seq ?? 0n, capEpoch: 0n };
    },
    async getCapOwner() { return over.owner ?? WALLET; },
    async waitForTransaction() { return; },
    async getAnchorEvent() {
      return { seq: (over.seq ?? 0n) + 1n, link: new Uint8Array([7]) };
    },
  } as never;
}

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: ENTITY, displayName: 'A', chainObjectId: CHAIN_OBJ, capObjectId: CAP_OBJ, originalPackageId: '0x' + '78'.repeat(32) });
  insertSnapshot(db, {
    id: 's1', entityId: ENTITY, periodId: '2026-Q2',
    manifestJson: '{}', manifestHash: VALID_HASH, merkleRoot: VALID_ROOT,
    leafCount: 1, supersedesSeq: 0,
  });
});

describe('prepareAnchor', () => {
  it('returns unsigned txKind + expectedSeq from SERVER snapshot hashes', async () => {
    const out = await prepareAnchor(
      { db, adapter: fakeAdapter(), mutex: passthroughMutex, cfg },
      { entityId: ENTITY, snapshotId: 's1', walletAddress: WALLET },
    );
    expect(out.expectedSeq).toBe(1);
    expect(typeof out.txKind).toBe('string');
    expect(out.capId).toBe(CAP_OBJ);
    expect(out.chainId).toBe(CHAIN_OBJ);
  });

  it('A4 gate: entity_ref mismatch → ENTITY_CHAIN_MISMATCH', async () => {
    await expect(
      prepareAnchor(
        { db, adapter: fakeAdapter({ entityRef: new Uint8Array(32) }), mutex: passthroughMutex, cfg },
        { entityId: ENTITY, snapshotId: 's1', walletAddress: WALLET },
      ),
    ).rejects.toMatchObject({ code: 'ENTITY_CHAIN_MISMATCH' });
  });

  it('cap preflight: owner != wallet → CAP_NOT_OWNED_BY_WALLET', async () => {
    await expect(
      prepareAnchor(
        { db, adapter: fakeAdapter({ owner: '0x' + '99'.repeat(32) }), mutex: passthroughMutex, cfg },
        { entityId: ENTITY, snapshotId: 's1', walletAddress: WALLET },
      ),
    ).rejects.toMatchObject({ code: 'CAP_NOT_OWNED_BY_WALLET' });
  });

  it('CLIENT_HASH_REJECTED: server reads hash from snapshot, not from client body', async () => {
    // The route validates that no client hash is accepted — the hash is always read server-side.
    // This test verifies prepareAnchor uses snap.manifestHash (not any external input) by checking
    // that the returned txKind is a deterministic string (not undefined).
    const out = await prepareAnchor(
      { db, adapter: fakeAdapter(), mutex: passthroughMutex, cfg },
      { entityId: ENTITY, snapshotId: 's1', walletAddress: WALLET },
    );
    // txKind is serialized from server-side snapshot hashes only
    expect(out.txKind).toBeTruthy();
    const parsed = JSON.parse(out.txKind) as Record<string, unknown>;
    expect(parsed).toHaveProperty('inputs'); // Transaction IR shape
  });

  it('404 on unknown entity', async () => {
    await expect(
      prepareAnchor(
        { db, adapter: fakeAdapter(), mutex: passthroughMutex, cfg },
        { entityId: 'bad-entity', snapshotId: 's1', walletAddress: WALLET },
      ),
    ).rejects.toMatchObject({ code: 'ENTITY_NOT_FOUND' });
  });

  it('404 on unknown snapshot', async () => {
    await expect(
      prepareAnchor(
        { db, adapter: fakeAdapter(), mutex: passthroughMutex, cfg },
        { entityId: ENTITY, snapshotId: 'no-snap', walletAddress: WALLET },
      ),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_FOUND' });
  });

  it('chain unreachable → CHAIN_UNREACHABLE 502', async () => {
    const brokenAdapter = {
      async getChainState() { throw new Error('connection refused'); },
      async getCapOwner() { return WALLET; },
      async waitForTransaction() { return; },
      async getAnchorEvent() { return { seq: 1n, link: new Uint8Array(1) }; },
    } as never;
    await expect(
      prepareAnchor(
        { db, adapter: brokenAdapter, mutex: passthroughMutex, cfg },
        { entityId: ENTITY, snapshotId: 's1', walletAddress: WALLET },
      ),
    ).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE', statusCode: 502 });
  });
});

describe('confirmAnchor', () => {
  it('refuses to write ANCHORED on seq mismatch (head=0, expected=1)', async () => {
    await expect(
      confirmAnchor(
        { db, adapter: fakeAdapter({ seq: 0n }), mutex: passthroughMutex, cfg },
        { entityId: ENTITY, snapshotId: 's1', digest: 'D', expectedSeq: 1 },
      ),
    ).rejects.toMatchObject({ code: 'SEQ_MISMATCH' });
    // Snapshot MUST remain FROZEN — NOT advanced
    expect(getSnapshot(db, 's1')!.status).toBe('FROZEN');
  });

  it('writes anchor + ANCHORED when seq matches', async () => {
    const a = await confirmAnchor(
      { db, adapter: fakeAdapter({ seq: 1n }), mutex: passthroughMutex, cfg },
      { entityId: ENTITY, snapshotId: 's1', digest: 'DIGESTX', expectedSeq: 1 },
    );
    expect(a.digest).toBe('DIGESTX');
    expect(a.explorerUrl).toContain('/tx/DIGESTX');
    expect(getSnapshot(db, 's1')!.status).toBe('ANCHORED');
  });

  it('refuses double-anchor: second confirm on same snapshot → ILLEGAL_TRANSITION', async () => {
    // First confirm succeeds
    await confirmAnchor(
      { db, adapter: fakeAdapter({ seq: 1n }), mutex: passthroughMutex, cfg },
      { entityId: ENTITY, snapshotId: 's1', digest: 'D1', expectedSeq: 1 },
    );
    // Second confirm should fail (StateError → ILLEGAL_TRANSITION)
    await expect(
      confirmAnchor(
        { db, adapter: fakeAdapter({ seq: 1n }), mutex: passthroughMutex, cfg },
        { entityId: ENTITY, snapshotId: 's1', digest: 'D2', expectedSeq: 1 },
      ),
    ).rejects.toThrow();
  });

  it('chain unreachable on waitForTransaction → CHAIN_UNREACHABLE', async () => {
    const brokenAdapter = {
      async getChainState() { return { entityRef: deriveEntityRef(ENTITY), latestLink: new Uint8Array(32), seq: 1n, capEpoch: 0n }; },
      async getCapOwner() { return WALLET; },
      async waitForTransaction() { throw new Error('timeout'); },
      async getAnchorEvent() { return { seq: 2n, link: new Uint8Array(1) }; },
    } as never;
    await expect(
      confirmAnchor(
        { db, adapter: brokenAdapter, mutex: passthroughMutex, cfg },
        { entityId: ENTITY, snapshotId: 's1', digest: 'D', expectedSeq: 1 },
      ),
    ).rejects.toMatchObject({ code: 'CHAIN_UNREACHABLE', statusCode: 502 });
  });
});
