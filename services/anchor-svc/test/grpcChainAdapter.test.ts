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
  it('parses getAnchorEvent link from base64 string AND passes include:events mask', async () => {
    const digest = '0xdigest';
    const linkB64 = Buffer.from([0xab, 0xcd]).toString('base64');
    let capturedArgs: unknown;
    const grpcWithTx = {
      core: {
        async getObject() { throw new Error('unused'); },
        async waitForTransaction() { return; },
        async getTransaction(args: unknown) {
          capturedArgs = args;
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
    // Guard: mask must be present so live gRPC nodes return events
    expect(capturedArgs).toMatchObject({ digest, include: { events: true } });
  });

  // REGRESSION: real testnet gRPC wraps getTransaction in a oneof —
  // { $kind: 'Transaction', Transaction: { events: [...] } } — NOT flat `events`.
  // The original fixture used flat events, so the wrong-path bug shipped: confirm
  // always threw "SnapshotAnchored event missing" on the real browser-sign path.
  it('parses getAnchorEvent from the real gRPC oneof shape (events under capital-T Transaction)', async () => {
    const digest = '0xrealshape';
    const linkB64 = Buffer.from([0x11, 0x22, 0x33]).toString('base64');
    const grpcWithTx = {
      core: {
        async getObject() { throw new Error('unused'); },
        async waitForTransaction() { return; },
        async getTransaction() {
          return {
            $kind: 'Transaction',
            Transaction: {
              digest,
              events: [
                {
                  packageId: '0xafc8',
                  module: 'audit_anchor',
                  eventType: '0xafc8::audit_anchor::SnapshotAnchored',
                  json: { seq: '6', link: linkB64 },
                },
              ],
            },
          };
        },
      },
    };
    const a = new SuiGrpcChainAdapter(grpcWithTx as never);
    const ev = await a.getAnchorEvent(digest);
    expect(ev.seq).toBe(6n);
    expect(Array.from(ev.link)).toEqual([0x11, 0x22, 0x33]);
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

  // REGRESSION: this SDK's gRPC core.signAndExecuteTransaction returns a oneof-wrapped
  // object — { $kind: 'Transaction', Transaction: { digest, status } } — NOT a top-level
  // { digest }. A naive top-level read silently yields undefined and fail-loud throws
  // "no digest…". Proven on real testnet. Digest lives at .Transaction.digest.
  it('execAnchor reads digest from the oneof-wrapped signAndExecuteTransaction result', async () => {
    const fakeDigest = '0xdeadbeefdigest';
    const linkB64 = Buffer.from([0x01, 0x02]).toString('base64');
    const client = {
      core: {
        async signAndExecuteTransaction() {
          return { $kind: 'Transaction', Transaction: { digest: fakeDigest, status: { success: true } } };
        },
        async waitForTransaction() { return; },
        async getTransaction() {
          return {
            $kind: 'Transaction',
            Transaction: {
              digest: fakeDigest,
              events: [{ eventType: '0xafc8::audit_anchor::SnapshotAnchored', json: { seq: '9', link: linkB64 } }],
            },
          };
        },
      },
    };
    const signer = { toSuiAddress: async () => '0xsender' } as never;
    const a = new SuiGrpcChainAdapter(client as never, signer);
    const res = await a.execAnchor({
      packageId: '0xpkg',
      chainObjectId: '0xchain',
      capObjectId: '0xcap',
      prevLink: new Uint8Array([0]),
      args: { manifestHash: new Uint8Array(32), merkleRoot: new Uint8Array(32), periodId: new Uint8Array([1]), supersedesSeq: 0n },
    });
    expect(res.digest).toBe(fakeDigest);
    expect(res.seq).toBe(9n);
    expect(Array.from(res.link)).toEqual([0x01, 0x02]);
  });

  it('throws when owner $kind is not AddressOwner', async () => {
    const capId = '0xcap';
    const client = fakeGrpc({ [capId]: { object: { owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }, json: { epoch: '7' } } } });
    const a = new SuiGrpcChainAdapter(client as never);
    await expect(a.getCapOwner(capId)).rejects.toThrow('owner address unavailable');
  });
});
