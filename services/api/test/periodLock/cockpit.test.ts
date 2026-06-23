import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/store/db.js';
import { buildCockpit } from '../../src/periodLock/cockpit.js';
import { hasAnchoredSnapshotForPeriod } from '../../src/store/snapshotStore.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0x1','0x2','0x3')").run();
});

it('pricing and export lights are mock and never green', () => {
  const v = buildCockpit(db, 'e1', '2026-Q2', 0.7);
  const pricing = v.lights.find((l) => l.key === 'pricing')!;
  const exp = v.lights.find((l) => l.key === 'export')!;
  expect(pricing.status).toBe('mock');
  expect(exp.status).toBe('mock');
  expect(pricing.real).toBe(false);
});

// WHY: closeable must ignore mock lights (no signal) but require every real/derived
// blocking light green — else "all green = closeable" overstates what was verified.
it('closeable ignores mock lights', () => {
  // No events => completeness red (presence check fails) => not closeable.
  const v = buildCockpit(db, 'e1', '2026-Q2', 0.7);
  expect(v.closeable).toBe(false);
});

// WHY: JE light bundles per-JE balance AND aggregate trial-balance tie-out;
// individually-balanced JEs whose entity TB nets non-zero must NOT show green.
it('JE light is red when trial balance does not net to zero', () => {
  db.prepare("INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1','{\"wallet\":\"0xabc\"}','AUTO')").run();
  // One JE internally balanced; a second JE balanced alone but skews entity TB.
  const balanced = JSON.stringify({ lines: [{ side: 'DEBIT', amountMinor: '100' }, { side: 'CREDIT', amountMinor: '100' }] });
  const skew = JSON.stringify({ lines: [{ side: 'DEBIT', amountMinor: '50' }, { side: 'CREDIT', amountMinor: '50' }, { side: 'DEBIT', amountMinor: '7' }] });
  db.prepare("INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash) VALUES ('j1','e1','ev1',?, 'k1','h1')").run(balanced);
  db.prepare("INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash) VALUES ('j2','e1','ev1',?, 'k2','h2')").run(skew);
  const je = buildCockpit(db, 'e1', '2026-Q2', 0.7).lights.find((l) => l.key === 'je')!;
  expect(je.status).toBe('red');
});

// WHY: cockpit must degrade an un-verifiable recon control to red (fail-closed), never 500.
// A wallet-less event causes openMaterialReconBlockers → walletAssetMovements to throw;
// buildCockpit must catch that and return recon light red instead of propagating the error.
it('reconLight degrades to red (fail-closed) when an event has no wallet field', () => {
  // Seed event with no wallet in rawJson — triggers the throw path in walletAssetMovements.
  db.prepare("INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev-nowal','e1','{}','AUTO')").run();
  // Seed a balanced JE so that light is not an additional blocker we need to reason about.
  const balanced = JSON.stringify({ lines: [{ side: 'DEBIT', amountMinor: '100' }, { side: 'CREDIT', amountMinor: '100' }] });
  db.prepare("INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash) VALUES ('j-nw','e1','ev-nowal',?, 'kw','hw')").run(balanced);

  // Must not throw.
  let cockpit: ReturnType<typeof buildCockpit>;
  expect(() => { cockpit = buildCockpit(db, 'e1', '2026-Q2', 0.7); }).not.toThrow();
  const recon = cockpit!.lights.find((l) => l.key === 'recon')!;
  expect(recon.status).toBe('red');
  expect(recon.real).toBe(true);
});

it('hasAnchoredSnapshotForPeriod is false for a different period', () => {
  db.prepare("INSERT INTO snapshots (id, entity_id, period_id, manifest_json, manifest_hash, merkle_root, leaf_count, supersedes_seq, status) VALUES ('s1','e1','2026-Q1','{}','h','r',1,NULL,'ANCHORED')").run();
  expect(hasAnchoredSnapshotForPeriod(db, 'e1', '2026-Q1')).toBe(true);
  expect(hasAnchoredSnapshotForPeriod(db, 'e1', '2026-Q2')).toBe(false);
});
