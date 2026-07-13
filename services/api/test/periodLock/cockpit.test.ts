import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/store/db.js';
import { buildCockpit } from '../../src/periodLock/cockpit.js';
import { hasAnchoredSnapshotForPeriod } from '../../src/store/snapshotStore.js';
import { ensurePolicySeed } from '../../src/store/policyStore.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0x1','0x2','0x3')").run();
  // Raw SQL bypasses insertEntity's ensurePolicySeed call (Task 3 read-path switchover
  // requires every entity have a persisted policy row) — re-run it explicitly.
  ensurePolicySeed(db);
});

// WHY: Task 7 replaced the mock 'pricing' light with the real 'revaluation' light — the
// mock light set shrinks to just 'export'. Confirms the swap didn't leave both around.
it('export light is mock and never green; revaluation is real (no mock pricing light)', () => {
  const v = buildCockpit(db, 'e1', '2026-Q2', 0.7);
  const exp = v.lights.find((l) => l.key === 'export')!;
  const revaluation = v.lights.find((l) => l.key === 'revaluation')!;
  expect(exp.status).toBe('mock');
  expect(v.lights.find((l) => l.key === 'pricing')).toBeUndefined();
  expect(revaluation.real).toBe(true);
  expect(revaluation.status).toBe('red'); // fresh entity: no revaluation run yet
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
// Seeds carry period_id + ACCOUNT_SEED account names so the failure is the tie-out
// imbalance itself, not an incidental unknown-class/unknown-period fail-closed path.
it('JE light is red when trial balance does not net to zero', () => {
  db.prepare("INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1','{\"wallet\":\"0xabc\"}','AUTO')").run();
  // One JE internally balanced; a second JE skews entity TB.
  const balanced = JSON.stringify({ lines: [
    { account: 'DigitalAssets', side: 'DEBIT', amountMinor: '100' },
    { account: 'StakingIncome', side: 'CREDIT', amountMinor: '100' }] });
  const skew = JSON.stringify({ lines: [
    { account: 'DigitalAssets', side: 'DEBIT', amountMinor: '50' },
    { account: 'StakingIncome', side: 'CREDIT', amountMinor: '50' },
    { account: 'DigitalAssets', side: 'DEBIT', amountMinor: '7' }] });
  db.prepare("INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id) VALUES ('j1','e1','ev1',?, 'k1','h1','2026-Q2')").run(balanced);
  db.prepare("INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id) VALUES ('j2','e1','ev1',?, 'k2','h2','2026-Q2')").run(skew);
  const je = buildCockpit(db, 'e1', '2026-Q2', 0.7).lights.find((l) => l.key === 'je')!;
  expect(je.status).toBe('red');
});

// WHY (Task 4, spec §14 step 5): a JE can be perfectly Dr=Cr balanced yet post to an
// account with no chart-of-accounts class — the TB cannot even state its closing
// balance (closingMinor null, fail-closed). The old jeLight only summed Dr/Cr and
// showed GREEN here; the upgraded light must consume buildTrialBalance's full tie-out
// (failures include unknown-class accounts) and go red.
it('JE light is red for a balanced JE posted to an unknown-class account', () => {
  db.prepare("INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev-uc','e1','{\"wallet\":\"0xabc\"}','AUTO')").run();
  const je = JSON.stringify({ lines: [
    { account: 'NotInChartOfAccounts', side: 'DEBIT', amountMinor: '100' },
    { account: 'DigitalAssets', side: 'CREDIT', amountMinor: '100' }] });
  db.prepare("INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id) VALUES ('j-uc','e1','ev-uc',?, 'k-uc','h-uc','2026-Q2')").run(je);
  const light = buildCockpit(db, 'e1', '2026-Q2', 0.7).lights.find((l) => l.key === 'je')!;
  expect(light.status).toBe('red');
});

// WHY: the green path must survive the upgrade — balanced JEs on seeded CoA accounts
// with a valid period_id tie out and the light is green (not collateral damage).
it('JE light is green for balanced JEs on known-class accounts', () => {
  db.prepare("INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev-ok','e1','{\"wallet\":\"0xabc\"}','AUTO')").run();
  const je = JSON.stringify({ lines: [
    { account: 'DigitalAssets', side: 'DEBIT', amountMinor: '100' },
    { account: 'StakingIncome', side: 'CREDIT', amountMinor: '100' }] });
  db.prepare("INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id) VALUES ('j-ok','e1','ev-ok',?, 'k-ok','h-ok','2026-Q2')").run(je);
  const light = buildCockpit(db, 'e1', '2026-Q2', 0.7).lights.find((l) => l.key === 'je')!;
  expect(light.status).toBe('green');
});

// WHY: journal_entries.period_id is nullable (legacy rows). buildTrialBalance throws on
// an unparseable period — the light must degrade fail-closed to red like recon/registry/
// revaluation lights, never 500 the whole cockpit.
it('JE light degrades to red (fail-closed), not a throw, when a JE has NULL period_id', () => {
  db.prepare("INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev-np','e1','{\"wallet\":\"0xabc\"}','AUTO')").run();
  const je = JSON.stringify({ lines: [
    { account: 'DigitalAssets', side: 'DEBIT', amountMinor: '100' },
    { account: 'StakingIncome', side: 'CREDIT', amountMinor: '100' }] });
  db.prepare("INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash) VALUES ('j-np','e1','ev-np',?, 'k-np','h-np')").run(je);
  let cockpit: ReturnType<typeof buildCockpit>;
  expect(() => { cockpit = buildCockpit(db, 'e1', '2026-Q2', 0.7); }).not.toThrow();
  expect(cockpit!.lights.find((l) => l.key === 'je')!.status).toBe('red');
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
