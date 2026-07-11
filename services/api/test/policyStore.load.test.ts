import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.js';
import {
  getActivePolicy, getActiveCoaMapping, toResolvedPolicySet, buildCoaMappingFromRules,
  PolicyPersistenceError, SEED_POLICY_DOC, ensurePolicySeed,
} from '../src/store/policyStore.js';
import { DEMO_POLICY_SET, DEMO_COA_RULES } from '../src/http/policyConstants.js';

function dbWithEntity() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0xc','0xcap','0xp')").run();
  // openDb already ran ensurePolicySeed BEFORE the entity existed; re-run for it:
  ensurePolicySeed(db);
  return db;
}

describe('policy loaders (Task 2)', () => {
  it('getActivePolicy returns the max version and a validated doc', () => {
    const db = dbWithEntity();
    const { version, doc } = getActivePolicy(db, 'e1');
    expect(version).toBe(1);
    expect(doc).toEqual(SEED_POLICY_DOC);
  });

  it('toResolvedPolicySet reproduces DEMO_POLICY_SET byte-for-byte from the seed doc', () => {
    // THE byte-identical linchpin: engine input from DB seed === engine input from constant.
    expect(toResolvedPolicySet(SEED_POLICY_DOC, true)).toEqual({ ...DEMO_POLICY_SET, periodOpen: true });
    expect(toResolvedPolicySet(SEED_POLICY_DOC, false)).toEqual({ ...DEMO_POLICY_SET, periodOpen: false });
  });

  it('buildCoaMappingFromRules resolves like the legacy mapping (incl. catch-all and miss→null)', () => {
    const m = buildCoaMappingFromRules(DEMO_COA_RULES);
    expect(m.resolve({ eventType: 'GAS_FEE' as never, leg: 'NETWORK_FEE', coinType: '0x2::sui::SUI' })).toBe('GasFeeExpense');
    expect(m.resolve({ eventType: 'INTERNAL_TRANSFER' as never, leg: 'WALLET:0xabc', coinType: '0x2::sui::SUI' })).toBe('DigitalAssets');
    expect(m.resolve({ eventType: 'GAS_FEE' as never, leg: 'NO_SUCH_LEG', coinType: '0x2::sui::SUI' })).toBeNull();
  });

  it('POLICY_MISSING: entity without rows fails loud, never falls back to constants', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('ghost','G','0xc','0xcap','0xp')").run();
    // deliberately NOT re-running ensurePolicySeed
    expect(() => getActivePolicy(db, 'ghost')).toThrowError(PolicyPersistenceError);
    try { getActivePolicy(db, 'ghost'); } catch (e) { expect((e as PolicyPersistenceError).code).toBe('POLICY_MISSING'); }
  });

  // Monkey tests (test.md): raw-SQLite dirty payloads must fail loud, not be swallowed.
  it('POLICY_CORRUPT: unknown enum value in doc fails loud', () => {
    const db = dbWithEntity();
    db.prepare("INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by) VALUES ('e1', 2, ?, 't', 'monkey')")
      .run(JSON.stringify({ ...SEED_POLICY_DOC, costBasisMethod: 'LIFO' }));
    try { getActivePolicy(db, 'e1'); expect.unreachable('should throw'); }
    catch (e) { expect((e as PolicyPersistenceError).code).toBe('POLICY_CORRUPT'); }
  });

  it('POLICY_CORRUPT: missing field / non-JSON doc / non-array rules all fail loud', () => {
    const db = dbWithEntity();
    const { policySetVersion: _drop, ...missingField } = SEED_POLICY_DOC;
    db.prepare("INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by) VALUES ('e1', 2, ?, 't', 'monkey')").run(JSON.stringify(missingField));
    expect(() => getActivePolicy(db, 'e1')).toThrowError(PolicyPersistenceError);
    db.prepare("INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by) VALUES ('e1', 3, 'not-json', 't', 'monkey')").run();
    expect(() => getActivePolicy(db, 'e1')).toThrowError(PolicyPersistenceError);
    db.prepare("INSERT INTO coa_mapping_sets (entity_id, version, rules, rule_version, created_at, created_by) VALUES ('e1', 2, ?, 'demo-rule-1', 't', 'monkey')").run(JSON.stringify({ not: 'an array' }));
    expect(() => getActiveCoaMapping(db, 'e1')).toThrowError(PolicyPersistenceError);
  });

  it('POLICY_CORRUPT: a valid-but-non-FIFO doc (WAC) is storable but not executable', () => {
    try {
      toResolvedPolicySet({ ...SEED_POLICY_DOC, costBasisMethod: 'WAC' }, true);
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyPersistenceError);
      expect((e as PolicyPersistenceError).code).toBe('POLICY_CORRUPT');
    }
  });
});
