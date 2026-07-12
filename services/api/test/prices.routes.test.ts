import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, TEST_ENTITY_ID } from './helpers/app.js';
import { insertAssetIfAbsent } from '../src/assets/store.js';
import { canonicalCoinType } from '../src/assets/normalize.js';
import type { Db } from '../src/store/db.js';

const SUI = '0x2::sui::SUI';
const SUI_CANONICAL = canonicalCoinType(SUI);
const NOW = '2026-06-01T00:00:00.000Z';

describe('/entities/:id/prices', () => {
  let app: FastifyInstance & { _db: Db };

  beforeEach(async () => {
    app = await buildTestApp();
    insertAssetIfAbsent(app._db, {
      entityId: TEST_ENTITY_ID, coinType: SUI, decimals: 9, symbol: 'SUI', displayName: 'SUI',
      source: 'chain', chainObjectId: null, metadataCapState: null, fetchedAt: null,
      decidedBy: null, reason: null, createdAt: NOW,
    });
  });
  afterEach(async () => { await app.close(); });

  describe('POST', () => {
    it('201s a valid manual price entry, forcing level/source/quoteCurrency', async () => {
      const res = await app.inject({
        method: 'POST', url: `/entities/${TEST_ENTITY_ID}/prices`,
        payload: { coinType: SUI, asOf: '2026-06-30', price: '1400.00' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.priceMinor).toBe('140000');
      expect(body.level).toBe('LEVEL_2');
      expect(body.source).toBe('manual');
      expect(body.quoteCurrency).toBe('USD');
      expect(body.coinType).toBe(SUI_CANONICAL);
      expect(body.asOf).toBe('2026-06-30');
    });

    it('400s price <= 0', async () => {
      const res = await app.inject({
        method: 'POST', url: `/entities/${TEST_ENTITY_ID}/prices`,
        payload: { coinType: SUI, asOf: '2026-06-30', price: '0.00' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s a negative price', async () => {
      const res = await app.inject({
        method: 'POST', url: `/entities/${TEST_ENTITY_ID}/prices`,
        payload: { coinType: SUI, asOf: '2026-06-30', price: '-5.00' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s a malformed price string', async () => {
      const res = await app.inject({
        method: 'POST', url: `/entities/${TEST_ENTITY_ID}/prices`,
        payload: { coinType: SUI, asOf: '2026-06-30', price: 'not-a-number' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s more than 2 decimal places', async () => {
      const res = await app.inject({
        method: 'POST', url: `/entities/${TEST_ENTITY_ID}/prices`,
        payload: { coinType: SUI, asOf: '2026-06-30', price: '1400.001' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s a coinType not in the asset registry (canonicalize-then-check)', async () => {
      const res = await app.inject({
        method: 'POST', url: `/entities/${TEST_ENTITY_ID}/prices`,
        payload: { coinType: '0xabc::usdc::USDC', asOf: '2026-06-30', price: '1.00' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('201s an asOf that falls mid-period, not just the cut-off date (spec v2.3 relaxed gate)', async () => {
      const res = await app.inject({
        method: 'POST', url: `/entities/${TEST_ENTITY_ID}/prices`,
        payload: { coinType: SUI, asOf: '2026-06-29', price: '1400.00' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().asOf).toBe('2026-06-29');
    });

    it('400s an asOf outside any known period date range', async () => {
      const res = await app.inject({
        method: 'POST', url: `/entities/${TEST_ENTITY_ID}/prices`,
        payload: { coinType: SUI, asOf: '2025-01-01', price: '1400.00' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET', () => {
    it('returns history desc with superseded=true on the older row for the same (coin, as_of)', async () => {
      await app.inject({
        method: 'POST', url: `/entities/${TEST_ENTITY_ID}/prices`,
        payload: { coinType: SUI, asOf: '2026-06-30', price: '1400.00' },
      });
      await app.inject({
        method: 'POST', url: `/entities/${TEST_ENTITY_ID}/prices`,
        payload: { coinType: SUI, asOf: '2026-06-30', price: '1500.00' },
      });
      const res = await app.inject({ method: 'GET', url: `/entities/${TEST_ENTITY_ID}/prices?coinType=${encodeURIComponent(SUI)}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.prices).toHaveLength(2);
      const [latest, older] = body.prices;
      expect(latest.priceMinor).toBe('150000');
      expect(latest.superseded).toBe(false);
      expect(older.priceMinor).toBe('140000');
      expect(older.superseded).toBe(true);
    });
  });
});
