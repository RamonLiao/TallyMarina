// test/suiCheckpointGrpcSource.test.ts
import { describe, it, expect } from 'vitest';
import { SuiCheckpointGrpcSource } from '../src/source/SuiCheckpointGrpcSource.js';

const CHAIN = '4btiuiKKaR9P';

// Offline fake of the gRPC client structural subset. `checkpoints` maps a
// sequence number -> the transactions array that GetCheckpoint returns.
function makeClient(opts: {
  chainId?: string;
  epoch?: string;
  height: bigint;
  checkpoints: Record<string, any[]>;
}) {
  return {
    core: {
      async getChainIdentifier() { return { chainIdentifier: opts.chainId ?? CHAIN }; },
      async getCurrentSystemState() { return { systemState: { epoch: opts.epoch ?? '42' } }; },
    },
    ledgerService: {
      getServiceInfo() { return { response: { checkpointHeight: opts.height } }; },
      getCheckpoint(input: any) {
        const seq = String(input.checkpointId.sequenceNumber);
        const transactions = opts.checkpoints[seq];
        if (transactions === undefined) throw new Error(`checkpoint ${seq} not available`);
        return { response: { checkpoint: { sequenceNumber: BigInt(seq), transactions } } };
      },
    },
  };
}

// A fully-populated (all three facets present) tx that does NOT touch `addr`.
function unrelatedTx(digest: string) {
  return {
    digest,
    transaction: { sender: '0xother' },
    balanceChanges: [{ address: '0xother', coinType: '0x2::sui::SUI', amount: '-1' }],
    effects: { status: { success: true }, changedObjects: [{ objectId: '0xo', outputOwner: { address: '0xother' } }] },
    timestamp: { seconds: 1700n, nanos: 0 },
  };
}

const ADDR = '0xabc';

describe('SuiCheckpointGrpcSource', () => {
  it('facet 1: matches by transaction.sender', async () => {
    const tx = { digest: 'S', transaction: { sender: ADDR }, balanceChanges: [], effects: { status: { success: true }, changedObjects: [] }, timestamp: { seconds: 10n, nanos: 0 } };
    const src = new SuiCheckpointGrpcSource(makeClient({ height: 5n, checkpoints: { '5': [tx] } }) as never, CHAIN, '5');
    const r = await src.fetchTransactions({ entityRef: 'e', address: ADDR, cursor: null, limit: 10 });
    expect(r.txs.map((t) => t.digest)).toEqual(['S']);
    expect(r.txs[0].checkpoint).toBe('5');
    expect(r.txs[0].status).toBe('success');
  });

  it('facet 2: matches by balanceChanges owner address', async () => {
    const tx = { digest: 'B', transaction: { sender: '0xother' }, balanceChanges: [{ address: ADDR, coinType: 'x', amount: '5' }], effects: { status: { success: true }, changedObjects: [] }, timestamp: { seconds: 10n, nanos: 0 } };
    const src = new SuiCheckpointGrpcSource(makeClient({ height: 5n, checkpoints: { '5': [tx] } }) as never, CHAIN, '5');
    const r = await src.fetchTransactions({ entityRef: 'e', address: ADDR, cursor: null, limit: 10 });
    expect(r.txs.map((t) => t.digest)).toEqual(['B']);
  });

  it('facet 3: matches by object-level transfer in changed_objects (outputOwner)', async () => {
    // Object-only move: sender differs, no balanceChange touches ADDR — only the NFT lands on ADDR.
    const tx = { digest: 'O', transaction: { sender: '0xother' }, balanceChanges: [{ address: '0xother', coinType: 'x', amount: '-1' }], effects: { status: { success: true }, changedObjects: [{ objectId: '0xnft', inputOwner: { address: '0xother' }, outputOwner: { address: ADDR } }] }, timestamp: { seconds: 10n, nanos: 0 } };
    const src = new SuiCheckpointGrpcSource(makeClient({ height: 5n, checkpoints: { '5': [tx] } }) as never, CHAIN, '5');
    const r = await src.fetchTransactions({ entityRef: 'e', address: ADDR, cursor: null, limit: 10 });
    expect(r.txs.map((t) => t.digest)).toEqual(['O']);
  });

  it('filters out a fully-populated unrelated tx', async () => {
    const src = new SuiCheckpointGrpcSource(makeClient({ height: 5n, checkpoints: { '5': [unrelatedTx('U')] } }) as never, CHAIN, '5');
    const r = await src.fetchTransactions({ entityRef: 'e', address: ADDR, cursor: null, limit: 10 });
    expect(r.txs).toEqual([]);
  });

  it('fail-closed: conservatively includes a tx with missing facet fields', async () => {
    // No sender, no balanceChanges, no changedObjects -> cannot rule out relevance -> include.
    const tx = { digest: 'M', effects: { status: { success: true } }, timestamp: { seconds: 10n, nanos: 0 } };
    const src = new SuiCheckpointGrpcSource(makeClient({ height: 5n, checkpoints: { '5': [tx] } }) as never, CHAIN, '5');
    const r = await src.fetchTransactions({ entityRef: 'e', address: ADDR, cursor: null, limit: 10 });
    expect(r.txs.map((t) => t.digest)).toEqual(['M']);
  });

  it('cursor advances by (last scanned checkpoint + 1) and reports hasNextPage until latest', async () => {
    const cps: Record<string, any[]> = { '5': [], '6': [], '7': [] };
    const src = new SuiCheckpointGrpcSource(makeClient({ height: 10n, checkpoints: cps }) as never, CHAIN, '5');
    const r = await src.fetchTransactions({ entityRef: 'e', address: ADDR, cursor: null, limit: 3 });
    expect(r.nextCursor).toBe('8');      // scanned 5,6,7 -> next = 8
    expect(r.hasNextPage).toBe(true);    // 7 < 10
  });

  it('empty page at the tip: no scan, cursor holds, hasNextPage false (idempotent re-scan)', async () => {
    // start = 11 but latest height = 10 -> nothing to scan yet.
    const src = new SuiCheckpointGrpcSource(makeClient({ height: 10n, checkpoints: {} }) as never, CHAIN, '11');
    const r = await src.fetchTransactions({ entityRef: 'e', address: ADDR, cursor: null, limit: 3 });
    expect(r.txs).toEqual([]);
    expect(r.nextCursor).toBe('11');     // holds so the next run re-scans 11 when produced
    expect(r.hasNextPage).toBe(false);
  });

  it('caught up: last page reaches latest -> hasNextPage false', async () => {
    const src = new SuiCheckpointGrpcSource(makeClient({ height: 6n, checkpoints: { '5': [], '6': [] } }) as never, CHAIN, '5');
    const r = await src.fetchTransactions({ entityRef: 'e', address: ADDR, cursor: null, limit: 10 });
    expect(r.nextCursor).toBe('7');
    expect(r.hasNextPage).toBe(false);   // 6 == latest
  });

  it('describe() asserts the expected chain identifier and returns epoch', async () => {
    const src = new SuiCheckpointGrpcSource(makeClient({ height: 5n, checkpoints: {} }) as never, CHAIN, '5');
    const d = await src.describe();
    expect(d.chainIdentifier).toBe(CHAIN);
    expect(d.epoch).toBe(42);
  });

  it('describe() throws on chain identifier mismatch (network guard, F3)', async () => {
    // MUTATION: expectedChainId is deliberately wrong -> guard must fire.
    const src = new SuiCheckpointGrpcSource(makeClient({ chainId: CHAIN, height: 5n, checkpoints: {} }) as never, 'MAINNET_ID', '5');
    await expect(src.describe()).rejects.toThrow(/chain identifier mismatch/);
  });

  it('rejects a non-numeric / negative start checkpoint', () => {
    const c = makeClient({ height: 5n, checkpoints: {} }) as never;
    expect(() => new SuiCheckpointGrpcSource(c, CHAIN, 'abc')).toThrow();
    expect(() => new SuiCheckpointGrpcSource(c, CHAIN, '-1')).toThrow();
  });

  it('rejects a corrupted (non-numeric) resume cursor', async () => {
    const src = new SuiCheckpointGrpcSource(makeClient({ height: 5n, checkpoints: {} }) as never, CHAIN, '5');
    await expect(src.fetchTransactions({ entityRef: 'e', address: ADDR, cursor: 'not-a-number', limit: 3 })).rejects.toThrow();
  });
});
