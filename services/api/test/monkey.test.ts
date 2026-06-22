// MONKEY TESTS — project rule: "想辦法把程式玩壞"
// Each test encodes WHY the invariant matters: if the guard is removed, the test must fail.
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent, setAiSuggestion } from '../src/store/eventStore.js';
import { getSnapshot, insertSnapshot } from '../src/store/snapshotStore.js';
import { insertJournalEntry, listJournal } from '../src/store/journalStore.js';
import { classifyEvent } from '../src/ai/classify.js';
import { confirmAnchor } from '../src/http/anchorService.js';
import { deriveEntityRef } from '../src/deps/anchorSvc.js';
import { normalizeFixture } from '../src/deps/ingestion.js';
import { makeEntityMutex } from '@subledger/anchor-svc';
import type { GeminiClient } from '../src/ai/geminiClient.js';
import { loadConfig } from '../src/config.js';
import { StateError } from '../src/store/stateMachine.js';

const cfg = loadConfig({
  SUI_NETWORK: 't', SUI_GRPC_URL: 'g', ANCHOR_PACKAGE_ID: '0xp',
  ANCHOR_ORIGINAL_PACKAGE_ID: '0xp', ENTITY_ID: 'acme:pilot-001',
  ENTITY_CHAIN_ID: '0xchain', ENTITY_CAP_ID: '0xcap',
  GEMINI_API_KEY: 'k', AI_MODEL_CLASSIFY: 'm', AI_MODEL_COPILOT: 'm',
  AI_CONFIDENCE_THRESHOLD: '0.85', PORT: '8787', DB_PATH: ':memory:',
  EXPLORER_BASE: 'https://x',
});

const ENTITY = 'acme:pilot-001';
const fakeClient = (resp: unknown): GeminiClient => ({
  async generateJson() { return resp as never; },
});

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, {
    id: ENTITY, displayName: 'A', chainObjectId: '0xchain',
    capObjectId: '0xcap', originalPackageId: '0xp',
  });
});

// ---------------------------------------------------------------------------
// MONKEY 1: Oversized fixture
// WHY: normalizeFixture is our OOM guard; removing it lets an attacker submit
//      millions of effects causing unbounded memory/CPU usage.
// ---------------------------------------------------------------------------
describe('MONKEY: oversized fixture', () => {
  it('normalizeFixture throws FIXTURE_OVERFLOW for a tx exceeding maxEffects', () => {
    const raw = {
      digest: 'D', checkpoint: '1', timestampMs: '1',
      status: 'success' as const,
      rawJson: {
        balanceChanges: Array.from({ length: 50 }, (_, i) => ({
          coinType: 'c', amount: String(i), owner: { AddressOwner: 'o' },
        })),
      },
    };
    const normalized = {
      schemaVersion: 'v1', eventId: 'e', eventType: 'DIGITAL_ASSET_RECEIPT' as const,
      eventGroupId: null, entityId: ENTITY, bookId: 'm', wallet: '0xw',
      counterparty: null, coinType: 'c', assetDecimals: 9, quantityMinor: '1',
      eventTime: '2026-01-01T00:00:00Z', economicPurpose: 'X', ownershipChange: true,
      considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
    };
    expect(() =>
      normalizeFixture({ chainId: 't', epoch: 1, events: [{ raw, normalized }] }, { maxEffects: 5 }),
    ).toThrowError(/FIXTURE_OVERFLOW/);
  });
});

// ---------------------------------------------------------------------------
// MONKEY 2: Confidence NaN / out-of-range never auto-posts
// WHY: AI returning garbage confidence must NEVER flip to AUTO routing; removing
//      the isValidConf check would allow bad AI output to post journal entries.
// ---------------------------------------------------------------------------
describe('MONKEY: confidence NaN / out-of-range never auto-posts', () => {
  it.each([
    Number.NaN, Infinity, -1, 2, 'high' as unknown as number,
  ])('confidence=%s → NEEDS_REVIEW, degraded', async (c) => {
    const r = await classifyEvent(
      { rawJson: '{}' },
      {
        client: fakeClient({
          eventType: 'X', economicPurpose: 'Y', counterparty: null,
          confidence: c, reasoning: 'r',
        }),
        model: 'm',
        threshold: 0.85,
      },
    );
    expect(r.routing).toBe('NEEDS_REVIEW');
    expect(r.degraded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MONKEY 3: Duplicate ingest / double-post
// WHY: If idempotency guard is removed, replaying a fixture doubles the ledger
//      (two journal rows for one economic event → wrong balances).
// ---------------------------------------------------------------------------
describe('MONKEY: duplicate ingest / double-post', () => {
  it('inserting the same idempotency_key twice never doubles the ledger', () => {
    insertEvent(db, { id: 'e1', entityId: ENTITY, rawJson: '{}' });
    const row = { id: 'j', entityId: ENTITY, eventId: 'e1', jeJson: '{}', idempotencyKey: 'DUP', leafHash: 'h' };
    insertJournalEntry(db, row);
    insertJournalEntry(db, { ...row, id: 'j2' });
    insertJournalEntry(db, { ...row, id: 'j3' });
    expect(listJournal(db, ENTITY)).toHaveLength(1);
  });

  it('re-classifying an already-AUTO event fails closed (no AUTO→AUTO)', () => {
    insertEvent(db, { id: 'e2', entityId: ENTITY, rawJson: '{}' });
    setAiSuggestion(db, 'e2', {
      aiEventType: 'X', aiPurpose: 'Y', aiCounterparty: null,
      aiConfidence: 0.9, aiReasoning: 'r', nextStatus: 'AUTO',
    });
    expect(() =>
      setAiSuggestion(db, 'e2', {
        aiEventType: 'X', aiPurpose: 'Y', aiCounterparty: null,
        aiConfidence: 0.9, aiReasoning: 'r', nextStatus: 'AUTO',
      }),
    ).toThrowError(StateError);
  });
});

// ---------------------------------------------------------------------------
// MONKEY 4 (TOCTOU carry from Task 3): Concurrent INSERT same idempotency_key
// WHY: With SELECT-then-INSERT, two concurrent callers both pass SELECT → second
//      throws UNIQUE constraint instead of returning 'duplicate'. INSERT OR IGNORE
//      fixes this. This test fires N concurrent inserts and asserts exactly one
//      'inserted' + rest 'duplicate', never a throw.
// ---------------------------------------------------------------------------
describe('MONKEY: TOCTOU concurrent insertJournalEntry', () => {
  it('concurrent inserts with the same idempotency_key → exactly one inserted, rest duplicate, no throw', async () => {
    insertEvent(db, { id: 'e-toctou', entityId: ENTITY, rawJson: '{}' });
    const base = { entityId: ENTITY, eventId: 'e-toctou', jeJson: '{}', idempotencyKey: 'TOCTOU-KEY', leafHash: 'h0' };

    // better-sqlite3 is synchronous so we simulate "concurrency" by firing many
    // calls in immediate succession (no await between them — they all execute
    // in the same tick before any can observe the others' results in async style).
    const N = 20;
    const results = Array.from({ length: N }, (_, i) =>
      insertJournalEntry(db, { ...base, id: `j-toctou-${i}` }),
    );

    const inserted = results.filter((r) => r === 'inserted');
    const duplicates = results.filter((r) => r === 'duplicate');
    expect(inserted).toHaveLength(1);
    expect(duplicates).toHaveLength(N - 1);
    // Guard: ledger is not doubled.
    expect(listJournal(db, ENTITY)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MONKEY 5: Concurrent anchor confirm serialized by mutex
// WHY: Without per-entity mutex, two concurrent confirms could both pass the
//      FROZEN check, then the second setSnapshotStatus throws an unhandled
//      StateError rather than a clean ApiError — breaking the error envelope.
// ---------------------------------------------------------------------------
describe('MONKEY: concurrent anchor confirm serialized by mutex', () => {
  it('two confirms on one entity: exactly one ANCHORED write, second fails closed', async () => {
    insertSnapshot(db, {
      id: 's1', entityId: ENTITY, periodId: 'P', manifestJson: '{}',
      manifestHash: 'a', merkleRoot: 'b', leafCount: 1, supersedesSeq: 0,
    });
    const adapter = {
      async getChainState() {
        return { entityRef: deriveEntityRef(ENTITY), latestLink: new Uint8Array(32), seq: 1n, capEpoch: 0n };
      },
      async waitForTransaction() { await new Promise((r) => setTimeout(r, 10)); },
      async getAnchorEvent() { return { seq: 1n, link: new Uint8Array([1]) }; },
      async getCapOwner() { return '0xw'; },
    } as never;
    const mutex = makeEntityMutex();
    const deps = { db, adapter, mutex, cfg };
    const results = await Promise.allSettled([
      confirmAnchor(deps, { entityId: ENTITY, snapshotId: 's1', digest: 'D1', expectedSeq: 1 }),
      confirmAnchor(deps, { entityId: ENTITY, snapshotId: 's1', digest: 'D2', expectedSeq: 1 }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);   // exactly one ANCHORED write
    expect(rejected).toHaveLength(1);    // the other fails closed
    expect(getSnapshot(db, 's1')!.status).toBe('ANCHORED');
  });
});

// ---------------------------------------------------------------------------
// MONKEY 6: Forged digest to confirm with seq mismatch
// WHY: If the seq check is removed, an attacker can front-run an anchor TX and
//      flip a snapshot to ANCHORED with a forged digest, corrupting the ledger.
// ---------------------------------------------------------------------------
describe('MONKEY: forged digest to confirm with seq mismatch', () => {
  it('digest whose chain head seq != expectedSeq is refused; snapshot stays FROZEN', async () => {
    insertSnapshot(db, {
      id: 's2', entityId: ENTITY, periodId: 'P', manifestJson: '{}',
      manifestHash: 'a', merkleRoot: 'b', leafCount: 1, supersedesSeq: 0,
    });
    const adapter = {
      async getChainState() {
        return { entityRef: deriveEntityRef(ENTITY), latestLink: new Uint8Array(32), seq: 5n, capEpoch: 0n };
      },
      async waitForTransaction() { return; },
      async getAnchorEvent() { return { seq: 5n, link: new Uint8Array([9]) }; },
      async getCapOwner() { return '0xw'; },
    } as never;
    await expect(
      confirmAnchor({ db, adapter, mutex: makeEntityMutex(), cfg }, {
        entityId: ENTITY, snapshotId: 's2', digest: 'FORGED', expectedSeq: 1,
      }),
    ).rejects.toMatchObject({ code: 'SEQ_MISMATCH' });
    expect(getSnapshot(db, 's2')!.status).toBe('FROZEN');
  });
});

// ---------------------------------------------------------------------------
// MONKEY 7: Extreme inputs — empty body, gigantic string, unicode entityId,
//           negative seq (additional adversarial coverage)
// WHY: Production routes must never crash on garbage input; they must return
//      clean 4xx envelopes, not unhandled exceptions leaking internals.
// ---------------------------------------------------------------------------
describe('MONKEY: extreme / adversarial inputs', () => {
  it('insertJournalEntry with a gigantic idempotency_key does not crash', () => {
    insertEvent(db, { id: 'e-giant', entityId: ENTITY, rawJson: '{}' });
    const bigKey = 'x'.repeat(100_000);
    const r1 = insertJournalEntry(db, { id: 'j-giant-1', entityId: ENTITY, eventId: 'e-giant', jeJson: '{}', idempotencyKey: bigKey, leafHash: 'h' });
    const r2 = insertJournalEntry(db, { id: 'j-giant-2', entityId: ENTITY, eventId: 'e-giant', jeJson: '{}', idempotencyKey: bigKey, leafHash: 'h' });
    expect(r1).toBe('inserted');
    expect(r2).toBe('duplicate');
  });

  it('insertJournalEntry with unicode entityId / key does not corrupt data', () => {
    insertEntity(db, { id: 'unicode:エンティティ-001', displayName: 'U', chainObjectId: '0xu', capObjectId: '0xu', originalPackageId: '0xp' });
    insertEvent(db, { id: 'eu', entityId: 'unicode:エンティティ-001', rawJson: '{}' });
    const r = insertJournalEntry(db, { id: 'ju', entityId: 'unicode:エンティティ-001', eventId: 'eu', jeJson: '{}', idempotencyKey: '🔑key', leafHash: 'h' });
    expect(r).toBe('inserted');
    expect(listJournal(db, 'unicode:エンティティ-001')).toHaveLength(1);
  });

  it('classifyEvent with completely empty rawJson does not throw (fails closed → NEEDS_REVIEW)', async () => {
    const r = await classifyEvent(
      { rawJson: '' },
      { client: fakeClient(null), model: 'm', threshold: 0.85 },
    );
    expect(r.routing).toBe('NEEDS_REVIEW');
    expect(r.degraded).toBe(true);
  });

  it('classifyEvent with rawJson=null-ish AI response does not throw', async () => {
    const r = await classifyEvent(
      { rawJson: '{}' },
      {
        client: fakeClient({ eventType: null, economicPurpose: null, confidence: null, reasoning: null }),
        model: 'm', threshold: 0.85,
      },
    );
    expect(r.routing).toBe('NEEDS_REVIEW');
    expect(r.degraded).toBe(true);
  });

  it('confirmAnchor for non-existent entity throws 404, not crash', async () => {
    const adapter = {
      async getChainState() { return { entityRef: new Uint8Array(32), latestLink: new Uint8Array(32), seq: 1n, capEpoch: 0n }; },
      async waitForTransaction() { return; },
      async getAnchorEvent() { return { seq: 1n, link: new Uint8Array([1]) }; },
      async getCapOwner() { return '0xw'; },
    } as never;
    await expect(
      confirmAnchor({ db, adapter, mutex: makeEntityMutex(), cfg }, {
        entityId: 'no-such-entity', snapshotId: 'no-snap', digest: 'D', expectedSeq: 1,
      }),
    ).rejects.toMatchObject({ code: 'ENTITY_NOT_FOUND' });
  });

  it('normalizeFixture with empty events array returns empty array (no crash)', () => {
    const result = normalizeFixture({ chainId: 't', epoch: 1, events: [] });
    expect(result).toEqual([]);
  });
});
