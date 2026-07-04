// services/api/test/snapshot.periodScope.test.ts
//
// C2 Task 8 intent test: a snapshot built for a period must contain ONLY that
// period's JE leaves. Seeds JEs across two periods so an (incorrect) all-history
// build would produce leafCount 3, not the period-scoped 2 / 1.
import { describe, it, expect } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertJournalEntry, listJournal } from '../src/store/journalStore.js';
import { buildSnapshot, InMemorySnapshotRepo } from '../src/deps/snapshotSvc.js';
import type { JournalEntry, RuleOutput } from '../src/deps/rulesEngine.js';

const ENTITY = 'acme:pilot-001';

function seedJe(db: Db, id: string, periodId: string) {
  const lines = [
    { account: '1000', side: 'DEBIT', amountMinor: '100', origCoinType: '0x2::sui::SUI', origQtyMinor: '100', priceRef: null, fxRef: null, leg: 'MAIN' },
    { account: '4000', side: 'CREDIT', amountMinor: '100', origCoinType: '0x2::sui::SUI', origQtyMinor: '100', priceRef: null, fxRef: null, leg: 'MAIN' },
  ];
  db.prepare("INSERT INTO events (id, entity_id, raw_json, status, period_id) VALUES (?, ?, '{}', 'AUTO', ?)").run(`evt-${id}`, ENTITY, periodId);
  insertJournalEntry(db, {
    id: `je-${id}`, entityId: ENTITY, eventId: `evt-${id}`,
    jeJson: JSON.stringify({ idempotencyKey: id, lineageHash: `h-${id}`, reversalOf: null, lines }),
    idempotencyKey: id, leafHash: `leaf-${id}`, periodId,
  });
}

function buildForPeriod(db: Db, periodId: string) {
  const jes: JournalEntry[] = listJournal(db, ENTITY, periodId).map((r) => JSON.parse(r.jeJson) as JournalEntry);
  const outputs: RuleOutput[] = jes.map((je) => ({
    decision: 'POSTABLE' as const,
    assessment: { eventType: 'DIGITAL_ASSET_RECEIPT' as const, accountingClass: '', measurementModel: '' },
    measurements: [], lotMovements: [], journalEntries: [je], disclosureFacts: [], exceptions: [],
    explanation: { ruleIds: [], policyVersions: ['demo-ps-1'], priceRefs: [], fxRefs: [] },
  }));
  const repo = new InMemorySnapshotRepo();
  return buildSnapshot(outputs, { entityId: ENTITY, periodId, createdAtLogical: Date.now() }, repo);
}

describe('snapshot build is period-scoped (C2 Task 8)', () => {
  it('leafCount matches only the target period JE count, not the all-history total', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES (?, 'Acme', '0x1', '0x2', '0x3')").run(ENTITY);
    // 2 JEs in Q1, 1 JE in Q2 — an all-history build would wrongly yield leafCount 3.
    seedJe(db, 'j1', '2026-Q1');
    seedJe(db, 'j2', '2026-Q1');
    seedJe(db, 'j3', '2026-Q2');

    const q1 = buildForPeriod(db, '2026-Q1');
    expect(q1.auditSnapshot.leafCount).toBe(2);

    const q2 = buildForPeriod(db, '2026-Q2');
    expect(q2.auditSnapshot.leafCount).toBe(1);

    // Sanity: confirms the fixture actually spans periods (guards against a
    // no-op filter silently passing this test).
    expect(listJournal(db, ENTITY).length).toBe(3);
  });
});
