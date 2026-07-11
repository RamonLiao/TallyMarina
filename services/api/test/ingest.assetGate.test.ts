import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { insertAssetIfAbsent } from '../src/assets/store.js';
import { canonicalCoinType } from '../src/assets/normalize.js';
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

// The registry is keyed on the CANONICAL coinType (getAssetDecimals canonicalizes the lookup),
// so the stored key must be canonical too — otherwise the lookup silently misses.
function registerCoin(db: ReturnType<typeof freshDb>, coinType: string, decimals: number, symbol: string) {
  insertAssetIfAbsent(db, { entityId: 'e1', coinType: canonicalCoinType(coinType), decimals, symbol, displayName: symbol,
    source: 'chain', chainObjectId: '0xm', metadataCapState: 'DELETED', fetchedAt: 't', decidedBy: null, reason: null, createdAt: 't' });
}

const USDC = '0xbeef::usdc::USDC';
// A swap event: a legal sold leg (SUI@9) plus a consideration (buy) leg. Callers override the
// consideration fields to exercise the buy-leg gate in isolation.
const swap = (over: Record<string, unknown> = {}) => evt({
  eventType: 'SPOT_TRADE_SWAP',
  considerationAsset: USDC, considerationQtyMinor: '1000000', considerationDecimals: 6, ...over,
});

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

// The consideration (buy) leg is the SAME class of defect A hole as the sold leg: its scale
// (considerationDecimals) DIVIDES fair value in p06_pricefx -> cost basis -> JE -> leaf ->
// merkle root -> chain. Before this gate the buy leg was validated NOWHERE, so a wrong or
// unregistered consideration scale posted silently and rescaled cost basis by 10^n. Every case
// below keeps the SOLD leg fully legal (SUI@9 registered) so only the buy-leg check can fire.
describe('ingest asset gate — consideration (buy) leg', () => {
  it('rejects a swap whose consideration asset is unregistered, and logs it', () => {
    // WHY: an unregistered buy-leg coinType has no known scale; posting it anchors an
    // arbitrary cost basis. Sold leg is legal here, so nothing but the buy-leg check stops it.
    const db = freshDb(); register(db, 9); // SUI@9 registered; USDC deliberately NOT registered
    expect(() => ingestEvent(db, 'e1', swap())).toThrow(AssetGateError);
    expect(rejectReasons(db)).toContain('CONSIDERATION_ASSET_NOT_REGISTERED');
  });

  it('rejects a considerationDecimals that contradicts the registry, and logs it', () => {
    // WHY: considerationDecimals divides fair value; a claimed 2 against a registered 6 rescales
    // the anchored cost basis by 10^4. This is defect A applied to the buy leg.
    const db = freshDb(); register(db, 9); registerCoin(db, USDC, 6, 'USDC');
    expect(() => ingestEvent(db, 'e1', swap({ considerationDecimals: 2 }))).toThrow(/CONSIDERATION_DECIMALS_MISMATCH/);
    expect(rejectReasons(db)).toContain('CONSIDERATION_DECIMALS_MISMATCH');
  });

  it('rejects considerationDecimals present without a considerationAsset as structurally incoherent', () => {
    // WHY: a buy-leg scale with no buy-leg coinType is meaningless — symmetric to the sold leg's
    // ASSET_DECIMALS_WITHOUT_COIN_TYPE. Never let a dangling scale reach valuation.
    const db = freshDb(); register(db, 9);
    expect(() => ingestEvent(db, 'e1', swap({ considerationAsset: null, considerationDecimals: 6 })))
      .toThrow(/CONSIDERATION_DECIMALS_WITHOUT_COIN_TYPE/);
  });

  it('accepts a swap whose consideration asset is registered at the matching scale', () => {
    // WHY: the positive control — a correct buy leg must pass, or the gate is just a wall.
    const db = freshDb(); register(db, 9); registerCoin(db, USDC, 6, 'USDC');
    expect(() => ingestEvent(db, 'e1', swap())).not.toThrow();
  });

  it('lets a non-swap event with null consideration fields through untouched', () => {
    // WHY: every non-swap event carries considerationAsset/considerationDecimals as explicit
    // nulls (see the demo fixture's OPENING_LOT). The buy-leg gate must NOT mistake those for a
    // real leg and reject legitimate traffic.
    const db = freshDb(); register(db, 9);
    const raw = evt({ considerationAsset: null, considerationQtyMinor: null, considerationDecimals: null });
    expect(() => ingestEvent(db, 'e1', raw)).not.toThrow();
  });

  // The two cases a controller ran by hand and watched POST when they should have been REJECTed.
  // Encoded verbatim so this exact fail-open can never regress.
  describe('controller-reproduced bypasses (must now REJECT)', () => {
    it('blocks: sold SUI@9 legal, consideration decimals 2 vs registered 6', () => {
      const db = freshDb(); register(db, 9); registerCoin(db, USDC, 6, 'USDC');
      expect(() => ingestEvent(db, 'e1', swap({ considerationDecimals: 2 }))).toThrow(/CONSIDERATION_DECIMALS_MISMATCH/);
    });

    it('blocks: consideration = unregistered 0xdead::x::X fake coin', () => {
      const db = freshDb(); register(db, 9);
      expect(() => ingestEvent(db, 'e1', swap({ considerationAsset: '0xdead::x::X', considerationDecimals: 6 })))
        .toThrow(/CONSIDERATION_ASSET_NOT_REGISTERED/);
    });
  });
});
