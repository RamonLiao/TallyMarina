import { describe, it, expect } from 'vitest';
import { SuiChainAdapter } from '../src/adapter/suiChainAdapter.js';
import { LinkMismatchError, type AnchorCallArgs } from '../src/domain/types.js';

/**
 * WHY these tests exist: over JSON-RPC the SDK does NOT populate
 * cleverError.constantName and reports abortCode '0' (confirmed on testnet P126),
 * so the adapter cannot read the abort *reason* from the error. It instead re-reads
 * the head and infers ELinkMismatch from "the prev_link I sent no longer matches".
 * These tests pin that inference: LinkMismatchError (→ caller retries) MUST fire
 * exactly when the head advanced, and MUST NOT fire for any other abort or a real
 * transport failure. If this logic regresses, the concurrent-writer retry silently
 * dies again — which is the bug this whole change fixes.
 */

const PKG = '0xpkg';
const PREV = Uint8Array.from(Array(32).fill(7)); // prev_link we send on-chain

const args: AnchorCallArgs = {
  manifestHash: Uint8Array.from(Array(32).fill(0xaa)),
  merkleRoot: Uint8Array.from(Array(32).fill(0xbb)),
  periodId: new TextEncoder().encode('2026-Q2'),
  supersedesSeq: 0n,
};

/**
 * Minimal CoreClient fake. getObject serves BOTH reads on the abort path:
 *  - chain object ('0xchain'): entity_ref / latest_link / seq / cap_epoch
 *  - cap object  ('0xcap'):    epoch
 * capEpoch defaults equal to chainCapEpoch (cap current) so classification falls through
 * to the head check unless a test deliberately makes them differ (stale cap).
 */
function makeClient(opts: { exec: () => Promise<unknown>; head: number[]; capEpoch?: string; chainCapEpoch?: string }) {
  const capEpoch = opts.capEpoch ?? '0';
  const chainCapEpoch = opts.chainCapEpoch ?? '0';
  return {
    signAndExecuteTransaction: opts.exec,
    getObject: async ({ objectId }: { objectId: string }) =>
      objectId === '0xcap'
        ? { object: { json: { epoch: capEpoch } } }
        : { object: { json: { entity_ref: [1, 2, 3], latest_link: opts.head, seq: '5', cap_epoch: chainCapEpoch } } },
  } as unknown as ConstructorParameters<typeof SuiChainAdapter>[0];
}

const signer = {} as unknown as ConstructorParameters<typeof SuiChainAdapter>[1];

const anchorAbort = {
  $kind: 'MoveAbort' as const,
  message: 'MoveAbort ... anchor_snapshot (line 131)',
  MoveAbort: { abortCode: '0', location: { package: PKG, functionName: 'anchor_snapshot' } },
};

function call(adapter: SuiChainAdapter) {
  return adapter.execAnchor({
    packageId: PKG, chainObjectId: '0xchain', capObjectId: '0xcap', prevLink: PREV, args,
  });
}

describe('SuiChainAdapter.execAnchor abort classification', () => {
  it('dry-run THROW + head advanced → LinkMismatchError (retry path reachable)', async () => {
    const client = makeClient({
      exec: async () => { throw { executionError: anchorAbort }; },
      head: Array(32).fill(9), // head != PREV → append-only race
    });
    await expect(call(new SuiChainAdapter(client, signer))).rejects.toBeInstanceOf(LinkMismatchError);
  });

  it('dry-run THROW + head still equals our prev_link → generic error, NOT LinkMismatchError', async () => {
    // e.g. EStaleCap/EWrongChain: head unchanged, so retrying would not help → must not retry.
    const client = makeClient({
      exec: async () => { throw { executionError: anchorAbort }; },
      head: Array(32).fill(7), // head == PREV
    });
    const p = call(new SuiChainAdapter(client, signer));
    await expect(p).rejects.toThrow(/not a prev_link race/);
    await expect(p).rejects.not.toBeInstanceOf(LinkMismatchError);
  });

  it('stale cap (cap.epoch != chain.cap_epoch) + head advanced → generic error, NOT LinkMismatchError', async () => {
    // codex correctness case: an EStaleCap abort can coincide with an unrelated concurrent
    // head advance. The cap-epoch check must win so we surface stale-cap and do NOT retry
    // (retry would re-fail at the gate). Head advanced here yet it must stay non-retryable.
    const client = makeClient({
      exec: async () => { throw { executionError: anchorAbort }; },
      head: Array(32).fill(9), // head advanced
      capEpoch: '0', chainCapEpoch: '1', // cap rotated out from under us
    });
    const p = call(new SuiChainAdapter(client, signer));
    await expect(p).rejects.toThrow(/stale cap epoch/);
    await expect(p).rejects.not.toBeInstanceOf(LinkMismatchError);
  });

  it('FailedTransaction return + head advanced → LinkMismatchError', async () => {
    const client = makeClient({
      exec: async () => ({
        $kind: 'FailedTransaction',
        FailedTransaction: { status: { success: false, error: anchorAbort } },
      }),
      head: Array(32).fill(9),
    });
    await expect(call(new SuiChainAdapter(client, signer))).rejects.toBeInstanceOf(LinkMismatchError);
  });

  it('genuine transport error (no MoveAbort) is re-thrown unchanged, no re-read/retry', async () => {
    const boom = new Error('ECONNRESET');
    const client = makeClient({ exec: async () => { throw boom; }, head: Array(32).fill(9) });
    await expect(call(new SuiChainAdapter(client, signer))).rejects.toBe(boom);
  });

  it('abort from a DIFFERENT function is not classified as our anchor abort', async () => {
    const otherAbort = {
      $kind: 'MoveAbort',
      message: 'abort in some_other_fn',
      MoveAbort: { location: { package: PKG, functionName: 'some_other_fn' } },
    };
    const client = makeClient({
      exec: async () => { throw { executionError: otherAbort }; },
      head: Array(32).fill(9),
    });
    // not our anchor_snapshot abort → treated as transport failure, re-thrown as-is
    await expect(call(new SuiChainAdapter(client, signer))).rejects.not.toBeInstanceOf(LinkMismatchError);
  });
});
