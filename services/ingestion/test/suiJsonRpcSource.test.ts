// test/suiJsonRpcSource.test.ts
import { describe, it, expect } from 'vitest';
import { SuiJsonRpcSource } from '../src/source/SuiJsonRpcSource.js';

const stubClient = {
  async getChainIdentifier() { return '4btiuiKKaR9P'; },
  async getLatestSuiSystemState() { return { epoch: '42' }; },
  async queryTransactionBlocks() {
    return {
      data: [{ digest: 'A', checkpoint: '10', timestampMs: '1700', effects: { status: { status: 'success' } } }],
      nextCursor: 'c1', hasNextPage: true,
    };
  },
};

describe('SuiJsonRpcSource', () => {
  it('maps responses to envelopes and preserves rawJson', async () => {
    const src = new SuiJsonRpcSource(stubClient as never, '4btiuiKKaR9P');
    const r = await src.fetchTransactions({ entityRef: 'e', address: '0xa', cursor: null, limit: 50 });
    expect(r.txs[0].digest).toBe('A');
    expect(r.txs[0].status).toBe('success');
    expect(r.nextCursor).toBe('c1');
  });
  it('describe() asserts the expected chain identifier', async () => {
    const src = new SuiJsonRpcSource(stubClient as never, '4btiuiKKaR9P');
    expect((await src.describe()).chainIdentifier).toBe('4btiuiKKaR9P');
  });
  it('describe() throws on chain identifier mismatch (network guard, F3)', async () => {
    const wrong = new SuiJsonRpcSource(stubClient as never, 'MAINNET_ID');
    await expect(src_describe(wrong)).rejects.toThrow();
  });
});
function src_describe(s: { describe: () => Promise<unknown> }) { return s.describe(); }
