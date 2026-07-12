import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import {
  insertPricePoint, latestPricesAt, listPriceHistory, priceSetHash,
  periodCutoff, cutoffPeriod,
} from '../src/store/pricePointStore.js';

const SUI = '0x2::sui::SUI';

function mkDb(): Db {
  const db = openDb(':memory:');
  insertEntity(db, { id: 'e1', displayName: 'Acme', chainObjectId: '0xc', capObjectId: '0xk', originalPackageId: '0xp' });
  return db;
}

const point = (over: Partial<Parameters<typeof insertPricePoint>[1]> = {}) => ({
  entityId: 'e1', coinType: SUI, asOf: '2026-06-30', priceMinor: '140000',
  quoteCurrency: 'USD', principalMarket: 'manual', source: 'manual', level: 'LEVEL_2', ...over,
});

describe('price_points store', () => {
  let db: Db;
  beforeEach(() => { db = mkDb(); });

  it('insert then latestPricesAt retrieves it', () => {
    const row = insertPricePoint(db, point());
    const latest = latestPricesAt(db, 'e1', '2026-06-30');
    expect(latest).toHaveLength(1);
    expect(latest[0]?.id).toBe(row.id);
    expect(latest[0]?.priceMinor).toBe('140000');
  });

  it('re-insert for the same (coin, as_of) is append-only: latest picks the new row, history keeps both', () => {
    const first = insertPricePoint(db, point());
    const second = insertPricePoint(db, point({ priceMinor: '150000' }));
    expect(second.id).not.toBe(first.id);

    const latest = latestPricesAt(db, 'e1', '2026-06-30');
    expect(latest).toHaveLength(1);
    expect(latest[0]?.id).toBe(second.id);
    expect(latest[0]?.priceMinor).toBe('150000');

    const history = listPriceHistory(db, 'e1', SUI);
    expect(history).toHaveLength(2);
    expect(history.map((r) => r.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('has no UPDATE/DELETE code path — module exports only insert/read functions', async () => {
    const mod = await import('../src/store/pricePointStore.js');
    const exported = Object.keys(mod);
    expect(exported).toEqual(expect.arrayContaining(['insertPricePoint', 'latestPricesAt', 'listPriceHistory', 'priceSetHash']));
    expect(exported.some((n) => /update|delete/i.test(n))).toBe(false);
  });

  it('priceSetHash is order-independent (sorted-ids hash)', () => {
    const a = insertPricePoint(db, point({ coinType: '0x2::sui::SUI' }));
    const b = insertPricePoint(db, point({ coinType: '0xabc::usdc::USDC', asOf: '2026-06-30' }));
    expect(priceSetHash([a, b])).toBe(priceSetHash([b, a]));
  });

  it('periodCutoff / cutoffPeriod round-trip for the MVP demo period', () => {
    expect(periodCutoff('2026-Q2')).toBe('2026-06-30');
    expect(cutoffPeriod('2026-06-30')).toBe('2026-Q2');
  });

  it('periodCutoff throws for an unknown period', () => {
    expect(() => periodCutoff('2099-Q1')).toThrow();
  });

  it('cutoffPeriod throws for a date that is not a known cut-off', () => {
    expect(() => cutoffPeriod('2026-01-01')).toThrow();
  });

  it('monkey: a raw-SQL negative price_minor row makes latestPricesAt fail loud', () => {
    insertPricePoint(db, point());
    db.prepare(
      `INSERT INTO price_points (id, entity_id, coin_type, as_of, price_minor, quote_currency, principal_market, source, level, created_at)
       VALUES ('px-dirty', 'e1', ?, '2026-06-30', '-5', 'USD', 'manual', 'manual', 'LEVEL_2', '9999-12-31T23:59:59.999Z')`,
    ).run(SUI);
    expect(() => latestPricesAt(db, 'e1', '2026-06-30')).toThrow();
  });
});
