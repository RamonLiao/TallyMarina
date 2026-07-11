// services/api/test/recon.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../src/store/db.js';
import { insertEvent } from '../src/store/eventStore.js';
import { insertJournalEntry } from '../src/store/journalStore.js';
import { registerRoutes } from '../src/http/routes.js';
import { OffMemory } from '../src/triage/memory/offMemory.js';

function mkApp(db: Db): FastifyInstance {
  const app = Fastify();
  registerRoutes(app, {
    db,
    cfg: { reconLiveWallet: '0xreal', explorerBase: 'https://x', exceptionLowConfidence: 0.85 } as never,
    classifyClient: {} as never,
    copilotClient: {} as never,
    anchorAdapter: null as never,
    mutex: { run: (_k: string, fn: () => Promise<never>) => fn() },
    memory: new OffMemory(),
  });
  return app;
}

describe('reconciliation routes', () => {
  let db: Db; let app: FastifyInstance;
  beforeEach(async () => {
    db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
    insertEvent(db, { id: 'evt-001', entityId: 'acme:pilot-001', rawJson: JSON.stringify({ wallet: '0xacmeTreasury', coinType: '0x2::sui::SUI', eventTime: '2026-05-01T00:00:00Z' }) });
    insertJournalEntry(db, { id: 'je-1', entityId: 'acme:pilot-001', eventId: 'evt-001', jeJson: JSON.stringify({ idempotencyKey: 'evt-001', lineageHash: 'h', reversalOf: null, lines: [
      { account: '1000', side: 'DEBIT', amountMinor: '5000000000', origCoinType: '0x2::sui::SUI', origQtyMinor: '5000000000', priceRef: null, fxRef: null, leg: 'MAIN' },
      { account: '4000', side: 'CREDIT', amountMinor: '1200000000', origCoinType: '0x2::sui::SUI', origQtyMinor: '1200000000', priceRef: null, fxRef: null, leg: 'MAIN' },
    ] }), idempotencyKey: 'evt-001', leafHash: 'leaf-1' });
    app = mkApp(db);
    await app.ready();
  });

  it('GET reconciliation returns rows with provenance + realWallet + summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/entities/acme:pilot-001/reconciliation' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.realWallet).toBe('0xreal');
    const sui = body.rows.find((r: { coinType: string }) => r.coinType === '0x2::sui::SUI');
    expect(sui.provenance).toEqual({ computed: 'book', statement: 'mock', chain: 'live' });
    const usdc = body.rows.find((r: { coinType: string }) => r.coinType === '0xbeef::usdc::USDC');
    expect(usdc.provenance.chain).toBe('n/a');
    expect(typeof body.summary.material).toBe('number');
  });

  it('POST disposition rejects breakId with multiple pipes (400)', async () => {
    const res = await app.inject({ method: 'POST', url: `/recon-breaks/${encodeURIComponent('0xa|0x2::sui::SUI|x')}/disposition`, payload: { state: 'resolved', reasonCode: 'error' } });
    expect(res.statusCode).toBe(400);
  });

  it('POST disposition on a real material break persists with server decidedBy', async () => {
    const breakId = encodeURIComponent('0xacmeTreasury|0x2::sui::SUI');
    const res = await app.inject({ method: 'POST', url: `/recon-breaks/${breakId}/disposition`, payload: { state: 'resolved', reasonCode: 'error', reasonNote: 'x', decidedBy: 'attacker' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().disposition.decidedBy).toBe('demo-controller'); // client value ignored
  });

  it('POST disposition on forged breakId 404', async () => {
    const res = await app.inject({ method: 'POST', url: `/recon-breaks/${encodeURIComponent('0xnope|0xfake::x::X')}/disposition`, payload: { state: 'resolved', reasonCode: 'error' } });
    expect(res.statusCode).toBe(404);
  });
});
