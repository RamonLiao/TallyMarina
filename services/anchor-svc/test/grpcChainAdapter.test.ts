import { describe, it, expect } from 'vitest';
import { SuiGrpcChainAdapter } from '../src/adapter/grpcChainAdapter.js';

// Fake gRPC client modeling the protobuf-derived getObject shape.
function fakeGrpc(objects: Record<string, unknown>) {
  return {
    core: {
      async getObject({ objectId }: { objectId: string }) {
        const o = objects[objectId];
        if (!o) throw new Error('not found');
        return o;
      },
      async waitForTransaction() { return; },
    },
  };
}

describe('SuiGrpcChainAdapter parsing', () => {
  it('parses chain state from gRPC getObject shape (entity_ref/latest_link number[], seq/cap_epoch string)', async () => {
    const chainId = '0xchain';
    const client = fakeGrpc({
      [chainId]: { object: { json: { entity_ref: [1, 2, 3], latest_link: [9, 9], seq: '4', cap_epoch: '7' } } },
    });
    const a = new SuiGrpcChainAdapter(client as never);
    const s = await a.getChainState(chainId);
    expect(Array.from(s.entityRef)).toEqual([1, 2, 3]);
    expect(Array.from(s.latestLink)).toEqual([9, 9]);
    expect(s.seq).toBe(4n);
    expect(s.capEpoch).toBe(7n);
  });

  it('reads cap owner address for preflight', async () => {
    const capId = '0xcap';
    const client = fakeGrpc({ [capId]: { object: { owner: { address: '0xowner' }, json: { epoch: '7' } } } });
    const a = new SuiGrpcChainAdapter(client as never);
    expect(await a.getCapOwner(capId)).toBe('0xowner');
    expect(await a.getCapEpoch(capId)).toBe(7n);
  });
});
