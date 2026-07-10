import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { insertAssetIfAbsent } from '../src/assets/store.js';
import { ingestEvent, AssetGateError } from '../src/http/ingestEvent.js';

const tmpDirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'ingestgate-')); tmpDirs.push(dir);
  const db = openDb(join(dir, 'test.db'));
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('e1','E1','0xc','0xcap','0xpkg')`).run();
  return db;
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const SUI_LONG = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const evt = (over: Record<string, unknown> = {}) => JSON.stringify({
  eventTime: '2026-04-10T00:00:00Z', coinType: '0x2::sui::SUI', assetDecimals: 9, quantityMinor: '1000000000', ...over,
});

function register(db: ReturnType<typeof freshDb>, decimals: number) {
  insertAssetIfAbsent(db, { entityId: 'e1', coinType: SUI_LONG, decimals, symbol: 'SUI', displayName: 'Sui',
    source: 'chain', chainObjectId: '0xm', metadataCapState: 'DELETED', fetchedAt: 't', decidedBy: null, reason: null, createdAt: 't' });
}

function rejectReasons(db: ReturnType<typeof freshDb>): string[] {
  return (db.prepare(`SELECT reason FROM rejected_event_log`).all() as { reason: string }[]).map((r) => r.reason);
}

describe('ingest asset gate', () => {
  it('accepts an event whose assetDecimals matches the registry', () => {
    const db = freshDb(); register(db, 9);
    expect(() => ingestEvent(db, 'e1', evt())).not.toThrow();
  });

  it('matches across the short and long coinType forms', () => {
    const db = freshDb(); register(db, 9);
    expect(() => ingestEvent(db, 'e1', evt({ coinType: SUI_LONG }))).not.toThrow();
  });

  it('rejects an unregistered asset and logs the rejection', () => {
    const db = freshDb();
    expect(() => ingestEvent(db, 'e1', evt())).toThrow(AssetGateError);
    expect(rejectReasons(db)).toContain('ASSET_NOT_REGISTERED');
  });

  it('rejects an assetDecimals that contradicts the registry — this is defect A', () => {
    // WHY: this value feeds mulUnitPrice -> cost basis -> JE -> leaf -> merkle root -> chain.
    // Two events for one coinType with different scales would anchor an incoherent ledger.
    const db = freshDb(); register(db, 9);
    expect(() => ingestEvent(db, 'e1', evt({ assetDecimals: 6 }))).toThrow(/ASSET_DECIMALS_MISMATCH/);
    expect(rejectReasons(db)).toContain('ASSET_DECIMALS_MISMATCH');
  });

  it('rejects assetDecimals without a coinType as structurally incoherent', () => {
    const db = freshDb();
    const raw = JSON.stringify({ eventTime: '2026-04-10T00:00:00Z', assetDecimals: 9 });
    expect(() => ingestEvent(db, 'e1', raw)).toThrow(/ASSET_DECIMALS_WITHOUT_COIN_TYPE/);
  });

  it('lets a coinType-free event through untouched', () => {
    // WHY: fiat and gas events have no asset scale to check.
    const db = freshDb();
    const raw = JSON.stringify({ eventTime: '2026-04-10T00:00:00Z', amountMinor: '100' });
    expect(() => ingestEvent(db, 'e1', raw)).not.toThrow();
  });

  it('does not insert the event when the gate rejects it', () => {
    const db = freshDb();
    try { ingestEvent(db, 'e1', evt()); } catch { /* expected */ }
    expect((db.prepare(`SELECT COUNT(*) n FROM events`).get() as { n: number }).n).toBe(0);
  });
});
