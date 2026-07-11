import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.js';
import { DEMO_POLICY_SET, DEMO_COA_RULES } from '../src/http/policyConstants.js';
import { ensurePolicySeed, bumpVersion } from '../src/store/policyStore.js';

describe('policy persistence seed (Task 1)', () => {
  it('fresh DB has the 4 tables and JE version columns', () => {
    const db = openDb(':memory:');
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('policy_sets','coa_mapping_sets','accounts','change_log')",
    ).all() as Array<{ name: string }>).map((r) => r.name).sort();
    expect(tables).toEqual(['accounts', 'change_log', 'coa_mapping_sets', 'policy_sets']);
    const cols = (db.prepare('PRAGMA table_info(journal_entries)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('policy_set_version');
    expect(cols).toContain('rule_version');
  });

  it('seeds version 1 from the demo constants byte-for-byte for every entity', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0xc','0xcap','0xp')").run();
    ensurePolicySeed(db);
    const ps = db.prepare("SELECT version, doc, created_by FROM policy_sets WHERE entity_id='e1'").all() as Array<{ version: number; doc: string; created_by: string }>;
    expect(ps).toHaveLength(1);
    const row = ps[0]!;
    expect(row.version).toBe(1);
    expect(row.created_by).toBe('seed');
    const doc = JSON.parse(row.doc);
    // the 6 version dims carry over verbatim from the constant (byte-identical guarantee, spec §3.6)
    expect(doc.policySetVersion).toBe(DEMO_POLICY_SET.policySetVersion);
    expect(doc.ruleVersion).toBe(DEMO_POLICY_SET.ruleVersion);
    expect(doc.roundingThresholdMinor).toBe(DEMO_POLICY_SET.roundingThresholdMinor);
    const coa = db.prepare("SELECT version, rules, rule_version FROM coa_mapping_sets WHERE entity_id='e1'").get() as { version: number; rules: string; rule_version: string };
    expect(coa.version).toBe(1);
    expect(coa.rule_version).toBe('demo-rule-1');
    expect(JSON.parse(coa.rules)).toEqual(DEMO_COA_RULES);
    // accounts: 7 legacy + 8 new MVP + 1 reserved P1 = 16
    const n = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE entity_id='e1'").get() as { n: number };
    expect(n.n).toBe(16);
    const reserved = db.prepare("SELECT status FROM accounts WHERE entity_id='e1' AND name='RevaluationSurplus'").get() as { status: string };
    expect(reserved.status).toBe('reserved_p1');
    // seed writes NO change_log rows (seed is not a human change, spec §3.6)
    expect((db.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number }).n).toBe(0);
  });

  it('ensurePolicySeed is idempotent (re-open does not duplicate)', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0xc','0xcap','0xp')").run();
    ensurePolicySeed(db);
    ensurePolicySeed(db);
    expect((db.prepare('SELECT COUNT(*) AS n FROM policy_sets').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM coa_mapping_sets').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(16);
  });

  it('bumpVersion increments a trailing integer and appends -2 otherwise', () => {
    expect(bumpVersion('demo-rule-1')).toBe('demo-rule-2');
    expect(bumpVersion('demo-rule-9')).toBe('demo-rule-10');
    expect(bumpVersion('vX')).toBe('vX-2');
  });
});
