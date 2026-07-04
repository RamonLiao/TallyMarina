import { describe, it, expect, vi } from 'vitest';
import { MemwalMemory } from '../src/triage/memory/memwalMemory.js';
import type { MemoryClient, MemoryHit } from '../src/triage/memory/types.js';
import type { MemoryConfig } from '../src/config.js';

const cfg: MemoryConfig = {
  mode: 'memwal', namespacePrefix: 'triage', recallLimit: 5, recallMaxDistance: null,
  recallTimeoutMs: 50, privateKey: 'k', accountId: 'a',
};
const feat = { eventType: 'RECEIPT', category: 'RULES_FAILED', amountBand: '1e3' };

function fallbackStub(hits: MemoryHit[]): MemoryClient {
  return { recall: async () => hits, remember: async () => {}, probe: async () => {}, close: async () => {} };
}

function fakeMemWal(over: Partial<Record<string, unknown>> = {}) {
  return {
    recall: vi.fn(async () => ({ results: [{ text: 'M-HIT', distance: 0.1 }] })),
    rememberAndWait: vi.fn(async () => {}),
    compatibility: vi.fn(async () => ({ ok: true })),
    health: vi.fn(async () => ({ ok: true })),
    destroy: vi.fn(() => {}),
    ...over,
  };
}

describe('MemwalMemory', () => {
  it('maps recall {results} → MemoryHit[]', async () => {
    const mw = fakeMemWal();
    const m = new MemwalMemory({ createMemWal: () => mw, fallback: fallbackStub([]), cfg });
    const hits = await m.recall({ entityId: 'e1', query: 'q', features: feat, limit: 5 });
    expect(hits).toEqual([{ text: 'M-HIT', distance: 0.1 }]);
  });

  it('recall throw → fail-open to fallback', async () => {
    const mw = fakeMemWal({ recall: vi.fn(async () => { throw new Error('relayer down'); }) });
    const m = new MemwalMemory({ createMemWal: () => mw, fallback: fallbackStub([{ text: 'LOCAL' }]), cfg });
    const hits = await m.recall({ entityId: 'e1', query: 'q', features: feat, limit: 5 });
    expect(hits).toEqual([{ text: 'LOCAL' }]);
  });

  it('recall timeout → fail-open to fallback', async () => {
    const mw = fakeMemWal({ recall: vi.fn(() => new Promise(() => {})) }); // never resolves
    const m = new MemwalMemory({ createMemWal: () => mw, fallback: fallbackStub([{ text: 'LOCAL' }]), cfg });
    const hits = await m.recall({ entityId: 'e1', query: 'q', features: feat, limit: 5 });
    expect(hits).toEqual([{ text: 'LOCAL' }]);
  });

  it('per-entity: distinct entityId → distinct MemWal instance (isolation)', async () => {
    const created: string[] = [];
    const m = new MemwalMemory({
      createMemWal: (ns) => { created.push(ns); return fakeMemWal(); },
      fallback: fallbackStub([]), cfg,
    });
    await m.recall({ entityId: 'A', query: 'q', features: feat, limit: 5 });
    await m.recall({ entityId: 'B', query: 'q', features: feat, limit: 5 });
    await m.recall({ entityId: 'A', query: 'q', features: feat, limit: 5 }); // cached, no new create
    expect(created).toEqual(['triage:A', 'triage:B']);
  });

  it('remember → rememberAndWait with rendered record', async () => {
    const mw = fakeMemWal();
    const m = new MemwalMemory({ createMemWal: () => mw, fallback: fallbackStub([]), cfg });
    await m.remember({ entityId: 'e1', record: {
      entityId: 'e1', eventType: 'RECEIPT', category: 'RULES_FAILED', amountBand: '1e3',
      outcome: 'ACCEPTED', action: 'deferred', reasonCode: 'PENDING_DOC', note: null,
    } });
    expect(mw.rememberAndWait).toHaveBeenCalledWith(expect.stringContaining('[ACCEPTED]'));
  });

  it('probe throws when compatibility fails (fail-loud)', async () => {
    const mw = fakeMemWal({ compatibility: vi.fn(async () => { throw new Error('peer missing'); }) });
    const m = new MemwalMemory({ createMemWal: () => mw, fallback: fallbackStub([]), cfg });
    await expect(m.probe()).rejects.toThrow(/peer missing|memory probe/);
  });

  it('close destroys all cached instances', async () => {
    const mws = [fakeMemWal(), fakeMemWal()];
    let i = 0;
    const m = new MemwalMemory({ createMemWal: () => (mws[i++] ?? fakeMemWal()), fallback: fallbackStub([]), cfg });
    await m.recall({ entityId: 'A', query: 'q', features: feat, limit: 5 });
    await m.recall({ entityId: 'B', query: 'q', features: feat, limit: 5 });
    await m.close();
    expect(mws[0]?.destroy).toHaveBeenCalled();
    expect(mws[1]?.destroy).toHaveBeenCalled();
  });
});
