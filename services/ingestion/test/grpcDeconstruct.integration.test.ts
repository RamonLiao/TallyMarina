// test/grpcDeconstruct.integration.test.ts
// BLOCKER coverage: the gRPC source must emit rawJson in the JSON-RPC-compatible
// shape that deconstruct() consumes. This test wires the real source through the
// real deconstruct() over a full proto-shaped tx and asserts the resulting
// effects are correct (counterparty populated, object move + gas effects present,
// and ZERO spurious unknown effects from leaked proto envelope fields).
import { describe, it, expect } from 'vitest';
import { SuiCheckpointGrpcSource } from '../src/source/SuiCheckpointGrpcSource.js';
import { deconstruct } from '../src/core/deconstruct.js';

const CHAIN = '4btiuiKKaR9P';
const ADDR = '0xabc';

function makeClient(opts: { height: bigint; lowest?: bigint; checkpoints: Record<string, any[]> }) {
  return {
    core: {
      async getChainIdentifier() { return { chainIdentifier: CHAIN }; },
      async getCurrentSystemState() { return { systemState: { epoch: '42' } }; },
    },
    ledgerService: {
      getServiceInfo() {
        return { response: { checkpointHeight: opts.height, lowestAvailableCheckpoint: opts.lowest } };
      },
      getCheckpoint(input: any) {
        const seq = String(input.checkpointId.sequenceNumber);
        const transactions = opts.checkpoints[seq];
        if (transactions === undefined) throw new Error(`checkpoint ${seq} not available`);
        return { response: { checkpoint: { sequenceNumber: BigInt(seq), transactions } } };
      },
    },
  };
}

// Full proto-shaped ExecutedTransaction: a coin lands on ADDR (from 0xcp-owner),
// an NFT is transferred to ADDR, gas is charged, and it carries per-tx timestamp.
function fullProtoTx() {
  return {
    digest: 'PROTO1',
    transaction: { sender: '0xsender' },
    signatures: [{ scheme: 'ed25519', signature: 'AAAA' }], // bytes-ish field that must NOT leak
    balanceChanges: [
      { address: '0xcp-owner', coinType: '0x2::sui::SUI', amount: '5000000000' },
    ],
    effects: {
      status: { success: true },
      gasUsed: { computationCost: 700n, storageCost: 300n, storageRebate: 100n, nonRefundableStorageFee: 0n },
      changedObjects: [
        { objectId: '0xnft', inputOwner: { address: '0xsender' }, outputOwner: { address: ADDR }, objectType: '0x2::nft::Art' },
      ],
    },
    events: { events: [{ eventType: '0x2::foo::Bar', packageId: '0xpkg' }] },
    checkpoint: 9n,
    timestamp: { seconds: 1700n, nanos: 500_000_000 },
  };
}

describe('gRPC source -> deconstruct integration', () => {
  it('produces a JSON-RPC-compatible envelope that deconstruct maps correctly with no spurious unknowns', async () => {
    const src = new SuiCheckpointGrpcSource(
      makeClient({ height: 9n, checkpoints: { '9': [fullProtoTx()] } }) as never,
      CHAIN,
      '9',
    );
    const page = await src.fetchTransactions({ entityRef: 'e', address: ADDR, cursor: null, limit: 1 });
    expect(page.txs).toHaveLength(1);
    const env = page.txs[0]!;

    const { effects, overflow } = deconstruct(env);
    expect(overflow).toBe(false);

    // counterparty must be populated from balanceChanges[].address -> owner.AddressOwner
    const coin = effects.find((e) => e.kind === 'coin_balance_change');
    expect(coin, 'expected a coin_balance_change effect').toBeDefined();
    expect(coin!.counterparty).toBe('0xcp-owner');
    expect(coin!.coinType).toBe('0x2::sui::SUI');
    expect(coin!.amount).toBe('5000000000');

    // object move must come through effects.changedObjects -> objectChanges
    const obj = effects.find((e) => e.kind === 'object_transfer');
    expect(obj, 'expected an object_transfer effect').toBeDefined();
    expect(obj!.objectId).toBe('0xnft');

    // gas effect from effects.gasUsed
    expect(effects.some((e) => e.kind === 'gas')).toBe(true);

    // event effect from events[]
    expect(effects.some((e) => e.kind === 'event')).toBe(true);

    // THE regression guard: no leaked proto envelope fields (digest, transaction,
    // signatures, checkpoint, timestamp) become 'unknown' effects.
    const unknowns = effects.filter((e) => e.kind === 'unknown');
    expect(unknowns, `spurious unknown effects: ${JSON.stringify(unknowns)}`).toEqual([]);

    // envelope-level lineage still intact
    expect(env.digest).toBe('PROTO1');
    expect(env.checkpoint).toBe('9');
    expect(env.status).toBe('success');
    // per-tx timestamp: 1700s + 500ms = 1700500
    expect(env.timestampMs).toBe('1700500');
  });
});
