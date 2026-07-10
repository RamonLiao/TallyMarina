import { describe, it, expect } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertAssetIfAbsent } from '../src/assets/store.js';
import { canonicalCoinType } from '../src/assets/normalize.js';
import { ingestEvent } from '../src/http/ingestEvent.js';
import { insertEvent, getEvent, type EventRow } from '../src/store/eventStore.js';
import { buildRuleInput } from '../src/http/buildRuleInput.js';
import { lotsForEvent } from '../src/http/lotsForEvent.js';
import { evaluate } from '../src/deps/rulesEngine.js';
import { buildSnapshot, InMemorySnapshotRepo } from '../src/deps/snapshotSvc.js';

// D5 (spec): the registry VALIDATES assetDecimals, it does not replace it. So the ingest gate
// must leave leaf hashes, merkle roots and every previously anchored snapshot byte-identical —
// that is what buys zero re-anchor. Before Task 12b closed the seeder bypass, no test exercised
// a full ingest -> run-rules -> snapshot path THROUGH the gate, so this property was only ever
// argued from a diff, never pinned by a test that would go red.
//
// This test builds the same event two ways — through ingestEvent() (the gate) and through the
// pre-gate insertEvent() writer — and drives both stored payloads through the identical
// rules+snapshot pipeline. The merkleRoot/manifestHash equality proves the gate inserts no
// transformation into the downstream anchor. The raw_json byte-identity assertion is the one
// that proves the gate stores the payload VERBATIM (see the mutation notes below).

const ENTITY = 'acme:pilot-001';
const PERIOD = '2026-Q2';
// manifestHash folds in createdAtLogical (routes.ts uses Date.now()), so it is NOT a content
// invariant. Pin it identically for both paths, otherwise a manifestHash diff would be a test
// artifact, not a D5 signal. merkleRoot is the content invariant and needs no pinning.
const CREATED_AT = 1_717_200_000_000;

// Pretty-printed ON PURPOSE. The round-trip mutation JSON.stringify(JSON.parse(x)) only changes
// bytes when x is non-canonical; feeding compact JSON would make that mutation a no-op and the
// byte-identity assertion could not go red. A receipt (acquires a lot, consumes none) posts a
// JE from an empty lot pool, so the snapshot is non-empty.
function rawEvent(id: string): string {
  return JSON.stringify(
    {
      schemaVersion: 'v1', eventId: id, eventType: 'DIGITAL_ASSET_RECEIPT', eventGroupId: null,
      entityId: ENTITY, bookId: 'main', wallet: '0xacmeTreasury', counterparty: '0xcustomerA',
      coinType: '0x2::sui::SUI', assetDecimals: 9, quantityMinor: '5000000000',
      eventTime: '2026-06-01T09:00:00Z', economicPurpose: 'RECEIVABLE_SETTLEMENT',
      ownershipChange: true, considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null,
      rawPayloadHash: 'demo-hash', txDigest: 'DEMOReceipt001', eventIndex: 0,
    },
    null,
    2, // <- non-canonical whitespace
  );
}

function registerSui(db: Db): void {
  insertAssetIfAbsent(db, {
    entityId: ENTITY, coinType: canonicalCoinType('0x2::sui::SUI'), decimals: 9,
    symbol: 'SUI', displayName: 'SUI', source: 'manual',
    chainObjectId: null, metadataCapState: null, fetchedAt: null,
    decidedBy: 'test', reason: 'd5 parity fixture', createdAt: '2026-01-01T00:00:00Z',
  });
}

function newDb(): Db {
  const db = openDb(':memory:');
  insertEntity(db, { id: ENTITY, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
  return db;
}

function pipeline(db: Db, row: EventRow): { merkleRoot: string; manifestHash: string } {
  const output = evaluate(buildRuleInput(row, { periodId: PERIOD, periodOpen: true, lots: lotsForEvent(db, row) }));
  if (output.decision !== 'POSTABLE') throw new Error(`expected POSTABLE, got ${output.decision}`);
  expect(output.journalEntries.length).toBeGreaterThan(0);
  const { auditSnapshot } = buildSnapshot(
    [output], { entityId: ENTITY, periodId: PERIOD, createdAtLogical: CREATED_AT }, new InMemorySnapshotRepo(),
  );
  return { merkleRoot: auditSnapshot.merkleRoot, manifestHash: auditSnapshot.manifestHash };
}

describe('D5: the ingest gate is byte-identical to the pre-gate path (zero re-anchor)', () => {
  it('gated ingestEvent() and pre-gate insertEvent() produce the same merkleRoot, manifestHash, and stored raw_json', () => {
    const raw = rawEvent('evt-d5');

    // DB-A: through the gate. The gate mints/accepts the id; use the same id in DB-B so runId
    // (run-<id>) is not an accidental variable.
    const dbA = newDb();
    registerSui(dbA);
    const { eventId } = ingestEvent(dbA, ENTITY, raw, 'evt-d5');
    const rowA = getEvent(dbA, eventId)!;

    // DB-B: the pre-gate writer, same id, same payload. insertEvent bypasses the registry gate,
    // so no asset registration is needed here — that is the point of the comparison.
    const dbB = newDb();
    insertEvent(dbB, { id: eventId, entityId: ENTITY, rawJson: raw });
    const rowB = getEvent(dbB, eventId)!;

    const gated = pipeline(dbA, rowA);
    const ungated = pipeline(dbB, rowB);

    // Content invariant: the gate adds no transformation to the anchor preimage.
    expect(gated.merkleRoot).toBe(ungated.merkleRoot);
    expect(gated.manifestHash).toBe(ungated.manifestHash);

    // Verbatim-storage invariant: the gate stored raw_json byte-for-byte, not a re-serialization.
    // This is the assertion that actually pins D5's "does not replace the value" claim — the
    // merkleRoot assertion above is insensitive to a whitespace/extra-key mutation because the
    // leaf preimage is derived from je_json (JE_LEAF_BCS_V1 whitelist), not from raw_json bytes.
    expect(rowA.rawJson).toBe(rowB.rawJson);
    expect(rowA.rawJson).toBe(raw);
  });
});
