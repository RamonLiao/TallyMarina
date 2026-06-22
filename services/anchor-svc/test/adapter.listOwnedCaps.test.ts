import { describe, it, expect, vi } from 'vitest';
import type { CoreClient } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { SuiChainAdapter } from '../src/adapter/suiChainAdapter.js';

const PKG = '0xpkg';
const OWNER = '0xowner';

/**
 * Monkey tests for SuiChainAdapter.listOwnedAnchorCaps().
 * Tests pagination threading, chain_id validation, type filtering, and cursor stall detection.
 */
describe('SuiChainAdapter.listOwnedAnchorCaps', () => {
  it('single page with 2 caps → returns both with correct { capObjectId, chainId }', async () => {
    const recordedCalls: Array<{ owner?: string; cursor?: string | null; type?: string }> = [];

    const fakeClient = {
      listOwnedObjects: vi.fn(async (params: any) => {
        recordedCalls.push({ owner: params.owner, cursor: params.cursor, type: params.type });
        return {
          objects: [
            { objectId: '0xcap1', json: { chain_id: '0xchain1' } } as any,
            { objectId: '0xcap2', json: { chain_id: '0xchain2' } } as any,
          ],
          hasNextPage: false,
          cursor: null,
        };
      }),
    };

    const fakeSigner = {} as Signer;
    const adapter = new SuiChainAdapter(fakeClient as unknown as CoreClient, fakeSigner);
    const caps = await adapter.listOwnedAnchorCaps(OWNER, PKG);

    expect(caps).toEqual([
      { capObjectId: '0xcap1', chainId: '0xchain1' },
      { capObjectId: '0xcap2', chainId: '0xchain2' },
    ]);
    expect(recordedCalls[0]?.owner).toBe(OWNER);
    expect(recordedCalls[0]?.cursor).toBeUndefined();
    expect(recordedCalls[0]?.type).toBe(`${PKG}::audit_anchor::AnchorCap`);
  });

  it('multi-page: page1 hasNextPage:true, page2 hasNextPage:false → threads cursor correctly', async () => {
    const recordedCalls: Array<{ cursor?: string | null; type?: string }> = [];

    const fakeClient = {
      listOwnedObjects: vi.fn(async (params: any) => {
        recordedCalls.push({ cursor: params.cursor, type: params.type });

        // First call: cursor undefined
        if (params.cursor === undefined) {
          return {
            objects: [{ objectId: '0xcap1', json: { chain_id: '0xchain1' } } as any],
            hasNextPage: true,
            cursor: 'c1',
          };
        }
        // Second call: cursor 'c1'
        if (params.cursor === 'c1') {
          return {
            objects: [{ objectId: '0xcap2', json: { chain_id: '0xchain2' } } as any],
            hasNextPage: false,
            cursor: null,
          };
        }
        throw new Error('unexpected cursor');
      }),
    };

    const fakeSigner = {} as Signer;
    const adapter = new SuiChainAdapter(fakeClient as unknown as CoreClient, fakeSigner);
    const caps = await adapter.listOwnedAnchorCaps(OWNER, PKG);

    expect(caps).toEqual([
      { capObjectId: '0xcap1', chainId: '0xchain1' },
      { capObjectId: '0xcap2', chainId: '0xchain2' },
    ]);
    expect(recordedCalls.length).toBe(2);
    expect(recordedCalls[0]?.cursor).toBeUndefined();
    expect(recordedCalls[1]?.cursor).toBe('c1');
  });

  it('cursor stall: hasNextPage:true but cursor equals incoming cursor → throws', async () => {
    const fakeClient = {
      listOwnedObjects: vi.fn(async (params: any) => {
        return {
          objects: [{ objectId: '0xcap1', json: { chain_id: '0xchain1' } } as any],
          hasNextPage: true,
          cursor: params.cursor, // SAME cursor coming back → stall!
        };
      }),
    };

    const fakeSigner = {} as Signer;
    const adapter = new SuiChainAdapter(fakeClient as unknown as CoreClient, fakeSigner);

    await expect(adapter.listOwnedAnchorCaps(OWNER, PKG)).rejects.toThrow(/cursor did not advance/);
  });

  it('cursor returns null on second page with hasNextPage:true → throws stall', async () => {
    const fakeClient = {
      listOwnedObjects: vi.fn(async (params: any) => {
        if (params.cursor === undefined) {
          return {
            objects: [{ objectId: '0xcap1', json: { chain_id: '0xchain1' } } as any],
            hasNextPage: true,
            cursor: 'c1',
          };
        }
        // Second call returns hasNextPage:true but cursor:null (should not happen, but stall check catches it)
        return {
          objects: [{ objectId: '0xcap2', json: { chain_id: '0xchain2' } } as any],
          hasNextPage: true,
          cursor: null,
        };
      }),
    };

    const fakeSigner = {} as Signer;
    const adapter = new SuiChainAdapter(fakeClient as unknown as CoreClient, fakeSigner);

    await expect(adapter.listOwnedAnchorCaps(OWNER, PKG)).rejects.toThrow(/cursor did not advance/);
  });

  it('missing chain_id field in cap json → throws', async () => {
    const fakeClient = {
      listOwnedObjects: vi.fn(async () => {
        return {
          objects: [{ objectId: '0xcapX', json: {} } as any],
          hasNextPage: false,
          cursor: null,
        };
      }),
    };

    const fakeSigner = {} as Signer;
    const adapter = new SuiChainAdapter(fakeClient as unknown as CoreClient, fakeSigner);

    await expect(adapter.listOwnedAnchorCaps(OWNER, PKG)).rejects.toThrow(/missing\/invalid chain_id/);
  });

  it('chain_id is null in cap json → throws', async () => {
    const fakeClient = {
      listOwnedObjects: vi.fn(async () => {
        return {
          objects: [{ objectId: '0xcapX', json: { chain_id: null } } as any],
          hasNextPage: false,
          cursor: null,
        };
      }),
    };

    const fakeSigner = {} as Signer;
    const adapter = new SuiChainAdapter(fakeClient as unknown as CoreClient, fakeSigner);

    await expect(adapter.listOwnedAnchorCaps(OWNER, PKG)).rejects.toThrow(/missing\/invalid chain_id/);
  });

  it('chain_id is empty string → throws', async () => {
    const fakeClient = {
      listOwnedObjects: vi.fn(async () => {
        return {
          objects: [{ objectId: '0xcapX', json: { chain_id: '' } } as any],
          hasNextPage: false,
          cursor: null,
        };
      }),
    };

    const fakeSigner = {} as Signer;
    const adapter = new SuiChainAdapter(fakeClient as unknown as CoreClient, fakeSigner);

    await expect(adapter.listOwnedAnchorCaps(OWNER, PKG)).rejects.toThrow(/missing\/invalid chain_id/);
  });

  it('chain_id is non-string (number) → throws', async () => {
    const fakeClient = {
      listOwnedObjects: vi.fn(async () => {
        return {
          objects: [{ objectId: '0xcapX', json: { chain_id: 123 } } as any],
          hasNextPage: false,
          cursor: null,
        };
      }),
    };

    const fakeSigner = {} as Signer;
    const adapter = new SuiChainAdapter(fakeClient as unknown as CoreClient, fakeSigner);

    await expect(adapter.listOwnedAnchorCaps(OWNER, PKG)).rejects.toThrow(/missing\/invalid chain_id/);
  });

  it('type filter is constructed from originalPackageId', async () => {
    const recordedCalls: Array<{ type?: string }> = [];

    const fakeClient = {
      listOwnedObjects: vi.fn(async (params: any) => {
        recordedCalls.push({ type: params.type });
        return {
          objects: [{ objectId: '0xcap1', json: { chain_id: '0xchain1' } } as any],
          hasNextPage: false,
          cursor: null,
        };
      }),
    };

    const fakeSigner = {} as Signer;
    const adapter = new SuiChainAdapter(fakeClient as unknown as CoreClient, fakeSigner);
    await adapter.listOwnedAnchorCaps(OWNER, PKG);

    expect(recordedCalls[0]?.type).toBe(`${PKG}::audit_anchor::AnchorCap`);
  });

  it('json can be null/undefined (object not found) → throws chain_id check', async () => {
    const fakeClient = {
      listOwnedObjects: vi.fn(async () => {
        return {
          objects: [{ objectId: '0xcapX', json: null } as any],
          hasNextPage: false,
          cursor: null,
        };
      }),
    };

    const fakeSigner = {} as Signer;
    const adapter = new SuiChainAdapter(fakeClient as unknown as CoreClient, fakeSigner);

    await expect(adapter.listOwnedAnchorCaps(OWNER, PKG)).rejects.toThrow(/missing\/invalid chain_id/);
  });
});
