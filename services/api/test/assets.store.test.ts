import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { getAsset, insertAssetIfAbsent, listAssets, deleteAsset, appendAssetLog, countAssetUsage, type AssetRow } from '../src/assets/store.js';
import { CoinTypeError } from '../src/assets/normalize.js';

const tmpDirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assetreg-'));
  tmpDirs.push(dir);
  return join(dir, 'test.db');
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

function seedEntity(db: ReturnType<typeof openDb>): void {
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('e1','E1','0xc','0xcap','0xpkg')`).run();
}

function row(over: Partial<AssetRow> = {}): AssetRow {
  return {
    entityId: 'e1', coinType: SUI, decimals: 9, symbol: 'SUI', displayName: 'Sui',
    source: 'chain', chainObjectId: '0xmeta', metadataCapState: 'DELETED',
    fetchedAt: '2026-07-10T00:00:00Z', decidedBy: null, reason: null,
    createdAt: '2026-07-10T00:00:00Z', ...over,
  };
}

describe('asset_registry store', () => {
  it('inserts and reads back a row', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    expect(insertAssetIfAbsent(db, row())).toBe('inserted');
    expect(getAsset(db, 'e1', SUI)).toMatchObject({ decimals: 9, source: 'chain', symbol: 'SUI' });
    expect(listAssets(db, 'e1')).toHaveLength(1);
  });

  it('is idempotent — a second insert of the same key does not overwrite', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    insertAssetIfAbsent(db, row());
    expect(insertAssetIfAbsent(db, row({ decimals: 6 }))).toBe('exists');
    // WHY: decimals must never be silently rewritten. The caller compares and 409s.
    expect(getAsset(db, 'e1', SUI)!.decimals).toBe(9);
  });

  it('returns null for an unregistered coinType', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    expect(getAsset(db, 'e1', SUI)).toBeNull();
  });

  it('scopes rows to an entity', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
                VALUES ('e2','E2','0xc','0xcap','0xpkg')`).run();
    insertAssetIfAbsent(db, row());
    // WHY (D4): entity A's manual declaration must not leak into entity B's books.
    expect(getAsset(db, 'e2', SUI)).toBeNull();
  });

  it('deletes a row', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    insertAssetIfAbsent(db, row());
    deleteAsset(db, 'e1', SUI);
    expect(getAsset(db, 'e1', SUI)).toBeNull();
  });
});

describe('asset_registry CHECK constraints (monkey — raw SQLite, bypassing the store)', () => {
  // WHY: the last round's lesson was verbatim "the DB has no CHECK constraint on state,
  // so dirty values reach the predicate as plain strings". Do not repeat it.
  const dirty = (sql: string) => {
    const db = openDb(freshDbPath()); seedEntity(db);
    return () => db.prepare(sql).run();
  };

  it('rejects an unknown source', () => {
    expect(dirty(`INSERT INTO asset_registry (entity_id,coin_type,decimals,symbol,display_name,source,created_at)
                  VALUES ('e1','${SUI}',9,'S','S','hacked','t')`)).toThrow(/CHECK constraint/i);
  });

  it('rejects negative decimals', () => {
    expect(dirty(`INSERT INTO asset_registry (entity_id,coin_type,decimals,symbol,display_name,source,created_at)
                  VALUES ('e1','${SUI}',-1,'S','S','chain','t')`)).toThrow(/CHECK constraint/i);
  });

  it('rejects decimals above 36', () => {
    // WHY: the bound mirrors rules-engine schemas.ts:21, which bounds the 10^n exponent
    // to stop a BigInt DoS. A registry row above it would arm that DoS from the master data.
    expect(dirty(`INSERT INTO asset_registry (entity_id,coin_type,decimals,symbol,display_name,source,created_at)
                  VALUES ('e1','${SUI}',37,'S','S','chain','t')`)).toThrow(/CHECK constraint/i);
  });

  it('rejects an unknown log outcome', () => {
    expect(dirty(`INSERT INTO asset_registry_log (entity_id,coin_type,outcome,actor,at)
                  VALUES ('e1','${SUI}','whatever','a','t')`)).toThrow(/CHECK constraint/i);
  });

  it('rejects a metadata_cap_state outside the four legal values', () => {
    // WHY (D16): metadata_cap_state is the auditor's "can decimals still be mutated?" anchor.
    // A garbage value reaching the column would corrupt that verdict at the master-data layer,
    // exactly the failure the source-column CHECK precedent guards against. The DB, not just the
    // app layer, must refuse it — dirty values otherwise land as plain strings a reader trusts.
    expect(dirty(`INSERT INTO asset_registry (entity_id,coin_type,decimals,symbol,display_name,source,metadata_cap_state,created_at)
                  VALUES ('e1','${SUI}',9,'S','S','chain','HACKED','t')`)).toThrow(/CHECK constraint/i);
  });

  it('accepts NULL metadata_cap_state (manual rows have no chain cap state)', () => {
    // WHY: the CHECK is `IS NULL OR IN (...)`; a manual registration legitimately stores NULL.
    // Guards against a botched CHECK that forbids NULL and would break every manual insert.
    const db = openDb(freshDbPath()); seedEntity(db);
    expect(() => db.prepare(`INSERT INTO asset_registry (entity_id,coin_type,decimals,symbol,display_name,source,metadata_cap_state,created_at)
                  VALUES ('e1','${SUI}',9,'S','S','manual',NULL,'t')`).run()).not.toThrow();
  });
});

describe('appendAssetLog + countAssetUsage', () => {
  it('records a conflict with both the claimed and the chain value', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    appendAssetLog(db, { entityId: 'e1', coinType: SUI, outcome: 'conflict',
      claimedDecimals: 6, chainDecimals: 9, actor: 'demo-controller', at: 't' });
    const r = db.prepare(`SELECT claimed_decimals, chain_decimals FROM asset_registry_log`).get() as Record<string, number>;
    // WHY: an auditor re-performing "we correctly rejected the client's value" needs both
    // numbers structured, not buried in a free-text detail column.
    expect(r.claimed_decimals).toBe(6);
    expect(r.chain_decimals).toBe(9);
  });

  it('counts zero usage for a never-used coinType', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    expect(countAssetUsage(db, 'e1', SUI)).toEqual({ events: 0, jes: 0, anchored: 0 });
  });

  it('counts an event that spells the coinType in the SHORT form', () => {
    // WHY: payloads store whatever spelling the sender used, and the fixture writes
    // '0x2::sui::SUI'. A LIKE '%<long form>%' probe finds nothing here and reports the asset
    // unused — so correctAsset would delete the master data of a fully posted asset.
    // Comparison must be on canonical types, never raw substrings.
    const db = openDb(freshDbPath()); seedEntity(db);
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1',?,'POSTED')`)
      .run(JSON.stringify({ coinType: '0x2::sui::SUI', assetDecimals: 9 }));
    expect(countAssetUsage(db, 'e1', SUI).events).toBe(1);
  });

  it('counts a JE line that references the coinType under origCoinType', () => {
    const db = openDb(freshDbPath()); seedEntity(db);
    // journal_entries.event_id has a FK to events(id) (foreign_keys=ON), so the parent
    // event must exist before the JE row. Does not affect the coinType-matching assertion.
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1','{}','POSTED')`).run();
    db.prepare(`INSERT INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash)
                VALUES ('je1','e1','ev1',?,'k1','h1')`)
      .run(JSON.stringify({ lines: [{ origCoinType: '0x2::sui::SUI' }] }));
    expect(countAssetUsage(db, 'e1', SUI).jes).toBe(1);
  });

  it('treats an unparseable payload as in-use — never as evidence of non-use', () => {
    // WHY: correction is destructive. Garbage in a row is not proof the asset is unused.
    const db = openDb(freshDbPath()); seedEntity(db);
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1','{not json','POSTED')`).run();
    expect(countAssetUsage(db, 'e1', SUI).events).toBe(1);
  });

  it('finds usage when the CALLER passes the short form and the payload stores the long form', () => {
    // WHY: countAssetUsage is the sole gate in front of correctAsset's delete. Payload-side
    // spellings were already canonicalized, but the coinType *argument* was compared raw. A
    // caller passing '0x2::sui::SUI' against a payload storing the canonical long form used to
    // report zero usage — correctAsset would then delete the registry row of a fully posted,
    // in-use asset, permanently stripping decimals off every historical quantity for it.
    const db = openDb(freshDbPath()); seedEntity(db);
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1',?,'POSTED')`)
      .run(JSON.stringify({ coinType: SUI, assetDecimals: 9 }));
    expect(countAssetUsage(db, 'e1', '0x2::sui::SUI').events).toBe(1);
  });

  it('finds usage when the CALLER passes an upper-case address and the payload stores the short form', () => {
    // WHY: same false-negative failure mode as above, but proving BOTH sides are normalized
    // independently — a caller-side canonicalization that only lowercases, or only expands,
    // would still miss this pairing and silently delete a live asset's master data.
    const db = openDb(freshDbPath()); seedEntity(db);
    db.prepare(`INSERT INTO events (id, entity_id, raw_json, status) VALUES ('ev1','e1',?,'POSTED')`)
      .run(JSON.stringify({ coinType: '0x2::sui::SUI', assetDecimals: 9 }));
    expect(countAssetUsage(db, 'e1', '0X2::sui::SUI').events).toBe(1);
  });

  it('throws CoinTypeError for an unparseable coinType argument, never {0,0,0}', () => {
    // WHY: this function gates a delete. Reporting {0,0,0} for a coinType it could not even
    // parse would tell correctAsset "safe to delete" about an argument it never understood —
    // the worst possible false negative. Failing loud is the deliberately opposite tradeoff
    // from getAssetDecimals (a read path), which returns null on a miss.
    const db = openDb(freshDbPath()); seedEntity(db);
    expect(() => countAssetUsage(db, 'e1', 'garbage')).toThrow(CoinTypeError);
  });
});
