import { describe, it, expect } from 'vitest';
import { SuiGrpcChainAdapter } from '../src/adapter/grpcChainAdapter.js';

// Fake gRPC client modeling the protobuf-derived getObject shape.
function fakeGrpc(objects: Record<string, unknown>) {
  return {
    core: {
      async getObject({ objectId }: { objectId: string; include?: { json?: boolean } }) {
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

  it('reads cap owner address for preflight (correct $kind/AddressOwner shape)', async () => {
    const capId = '0xcap';
    const client = fakeGrpc({ [capId]: { object: { owner: { $kind: 'AddressOwner', AddressOwner: '0xowner' }, json: { epoch: '7' } } } });
    const a = new SuiGrpcChainAdapter(client as never);
    expect(await a.getCapOwner(capId)).toBe('0xowner');
    expect(await a.getCapEpoch(capId)).toBe(7n);
  });

  // C1: Real gRPC shape — Move vector<u8> serialised as base64 strings.
  // This test FAILS if the base64 decode branch is removed from toBytes().
  it('parses chain state from gRPC getObject shape (entity_ref/latest_link base64 strings)', async () => {
    const chainId = '0xchain-b64';
    const entityRefB64 = Buffer.from([1, 2, 3]).toString('base64');
    const latestLinkB64 = Buffer.from([9, 9]).toString('base64');
    const client = fakeGrpc({
      [chainId]: { object: { json: { entity_ref: entityRefB64, latest_link: latestLinkB64, seq: '4', cap_epoch: '7' } } },
    });
    const a = new SuiGrpcChainAdapter(client as never);
    const s = await a.getChainState(chainId);
    expect(Array.from(s.entityRef)).toEqual([1, 2, 3]);
    expect(Array.from(s.latestLink)).toEqual([9, 9]);
    expect(s.seq).toBe(4n);
    expect(s.capEpoch).toBe(7n);
  });

  // C1: getAnchorEvent link field also comes as base64 in real gRPC.
  it('parses getAnchorEvent link from base64 string', async () => {
    const digest = '0xdigest';
    const linkB64 = Buffer.from([0xab, 0xcd]).toString('base64');
    const grpcWithTx = {
      core: {
        async getObject() { throw new Error('unused'); },
        async waitForTransaction() { return; },
        async getTransaction() {
          return {
            events: [{ eventType: '::audit_anchor::SnapshotAnchored', json: { seq: '3', link: linkB64 } }],
          };
        },
      },
    };
    const a = new SuiGrpcChainAdapter(grpcWithTx as never);
    const ev = await a.getAnchorEvent(digest);
    expect(ev.seq).toBe(3n);
    expect(Array.from(ev.link)).toEqual([0xab, 0xcd]);
  });

  // I2: toBytes() must pass through a raw Uint8Array without mutation.
  it('getChainState passes through Uint8Array entity_ref directly (I2)', async () => {
    const chainId = '0xchain-u8a';
    const rawRef = new Uint8Array([5, 6, 7]);
    const rawLink = new Uint8Array([8]);
    const client = fakeGrpc({
      [chainId]: { object: { json: { entity_ref: rawRef, latest_link: rawLink, seq: '1', cap_epoch: '2' } } },
    });
    const a = new SuiGrpcChainAdapter(client as never);
    const s = await a.getChainState(chainId);
    expect(Array.from(s.entityRef)).toEqual([5, 6, 7]);
    expect(Array.from(s.latestLink)).toEqual([8]);
  });

  it('throws when owner $kind is not AddressOwner', async () => {
    const capId = '0xcap';
    const client = fakeGrpc({ [capId]: { object: { owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }, json: { epoch: '7' } } } });
    const a = new SuiGrpcChainAdapter(client as never);
    await expect(a.getCapOwner(capId)).rejects.toThrow('owner address unavailable');
  });
});
