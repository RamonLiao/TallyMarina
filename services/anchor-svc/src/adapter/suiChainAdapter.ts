import { Transaction } from '@mysten/sui/transactions';
import type { CoreClient } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import {
  LinkMismatchError,
  type AnchorResult, type ChainState, type ExecAnchorInput, type SuiChainPort,
} from '../domain/types.js';

const MODULE = 'audit_anchor';
const ANCHOR_FN = 'anchor_snapshot';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Shape of a MoveAbort error as surfaced by @mysten/sui (JSON-RPC and gRPC). */
interface MoveAbortLike {
  $kind?: string;
  message?: string;
  MoveAbort?: { location?: { package?: string; functionName?: string } };
}

/**
 * Return the abort message iff this is a MoveAbort raised inside our package's
 * `anchor_snapshot` — otherwise null. We key on package + functionName, which are
 * STABLE over JSON-RPC; `cleverError.constantName` is NOT populated by the JSON-RPC
 * backend (confirmed on testnet P126) and `location.instruction` drifts on recompile,
 * so neither is a reliable discriminator. The abort *reason* (link mismatch vs other)
 * is decided separately by re-reading head state — see anchorAbortError.
 */
function anchorAbortMessage(err: MoveAbortLike | undefined, packageId: string): string | null {
  if (err?.$kind !== 'MoveAbort') return null;
  const loc = err.MoveAbort?.location;
  if (loc?.package === packageId && loc?.functionName === ANCHOR_FN) {
    return err.message ?? `${MODULE}::${ANCHOR_FN} abort`;
  }
  return null;
}

export class SuiChainAdapter implements SuiChainPort {
  constructor(private readonly client: CoreClient, private readonly signer: Signer) {}

  async getChainState(chainObjectId: string): Promise<ChainState> {
    const res = await this.client.getObject({ objectId: chainObjectId, include: { json: true } });
    const f = res.object.json;
    if (!f) throw new Error(`chain object ${chainObjectId} not found or json unavailable`);
    return {
      entityRef: Uint8Array.from(f.entity_ref as number[]),
      latestLink: Uint8Array.from(f.latest_link as number[]),
      seq: BigInt(f.seq as string),
      capEpoch: BigInt(f.cap_epoch as string),
    };
  }

  async getCapEpoch(capObjectId: string): Promise<bigint> {
    const res = await this.client.getObject({ objectId: capObjectId, include: { json: true } });
    const f = res.object.json;
    if (!f) throw new Error(`cap object ${capObjectId} not found or json unavailable`);
    return BigInt(f.epoch as string);
  }

  async execAnchor(input: ExecAnchorInput): Promise<AnchorResult> {
    const { packageId, chainObjectId, capObjectId, prevLink, args } = input;
    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::${MODULE}::anchor_snapshot`,
      arguments: [
        tx.object(chainObjectId),
        tx.object(capObjectId),
        tx.pure.vector('u8', Array.from(args.manifestHash)),
        tx.pure.vector('u8', Array.from(args.merkleRoot)),
        tx.pure.vector('u8', Array.from(args.periodId)),
        tx.pure.vector('u8', Array.from(prevLink)),
        tx.pure.u64(args.supersedesSeq),
      ],
    });

    let result;
    try {
      result = await this.client.signAndExecuteTransaction({
        transaction: tx,
        signer: this.signer,
        include: { events: true, effects: true },
      });
    } catch (e) {
      // An on-chain abort can surface as a THROW here: with no explicit gas budget the
      // JSON-RPC client dry-runs to estimate gas, and a MoveAbort during that dry-run is
      // thrown (as SimulationError) BEFORE the tx is submitted — it does NOT reach the
      // FailedTransaction branch below. Detect our anchor_snapshot abort and classify it;
      // anything else is a genuine transport/network failure and re-throws unchanged.
      const msg = anchorAbortMessage((e as { executionError?: MoveAbortLike })?.executionError, packageId);
      if (msg === null) throw e;
      throw await this.anchorAbortError(input, msg);
    }

    // Submitted-then-aborted path: surfaces when an explicit gas budget skips the dry-run.
    // cleverError/constantName is absent over JSON-RPC, so we never key on it — the abort
    // reason is decided by re-reading head state in classifyAnchorAbort.
    if (result.$kind === 'FailedTransaction') {
      const ftx = result.FailedTransaction;
      const err = ftx.status.success === false ? ftx.status.error : undefined;
      const msg = anchorAbortMessage(err as MoveAbortLike | undefined, packageId);
      if (msg !== null) throw await this.anchorAbortError(input, msg);
      throw new Error(`anchor tx failed: ${err?.message ?? 'unknown'}`);
    }

    const succeeded = result.Transaction;
    // events is conditional on Include; cast since we passed include: { events: true }
    const events = succeeded.events as Array<{ eventType: string; json: Record<string, unknown> | null }> | undefined;
    const ev = events?.find((e) => e.eventType.endsWith(`::${MODULE}::SnapshotAnchored`));
    if (!ev) throw new Error('SnapshotAnchored event missing');
    if (ev.json === null) throw new Error('SnapshotAnchored event has null json payload');
    const pj = ev.json as Record<string, unknown>;
    return {
      digest: succeeded.digest,
      seq: BigInt(pj.seq as string),
      link: Uint8Array.from(pj.link as number[]),
    };
  }

  /**
   * Build (via two state reads) the Error to throw for an anchor_snapshot abort:
   * LinkMismatchError → caller retries once; any other Error → no retry.
   *
   * Over JSON-RPC the abort reason is unavailable (no cleverError, abortCode 0), so we
   * reconstruct it from post-abort state:
   *  1. cap.epoch != chain.cap_epoch → cap rotated between gate read and execution
   *     (EStaleCap). Surface directly; retrying would re-fail at the gate.
   *  2. else prev_link we sent != current latest_link → head advanced under us
   *     (ELinkMismatch) → LinkMismatchError; caller retries once with a fresh head.
   *  3. else → some other abort (EWrongChain / seq overflow); no retry.
   *
   * LIMITATION (accepted, not a defect): post-abort state cannot perfectly reconstruct
   * the original abort reason — a non-link abort racing with a concurrent head advance
   * can be mislabeled as a link race (→ one wasted retry), and a real link race followed
   * by an immediate cap rotation can be labeled stale-cap (→ no retry). Both outcomes
   * stay FAIL-CLOSED: the on-chain asserts + the A4 gate (re-run on retry) guarantee no
   * incorrect anchor regardless of classification; retry is only a liveness optimization
   * for the common concurrent-writer case. A perfectly stable reason identifier is
   * provably unavailable over JSON-RPC; switch the transport to gRPC (SuiGrpcClient,
   * which populates cleverError.constantName) if exact classification is ever required.
   *
   * If a re-read itself fails (network), that error propagates — never swallowed.
   */
  private async anchorAbortError(
    input: { prevLink: Uint8Array; chainObjectId: string; capObjectId: string },
    abortMsg: string,
  ): Promise<Error> {
    const head = await this.getChainState(input.chainObjectId);
    const capEpoch = await this.getCapEpoch(input.capObjectId);
    if (capEpoch !== head.capEpoch) {
      return new Error(`anchor tx aborted (stale cap epoch ${capEpoch} vs chain ${head.capEpoch}): ${abortMsg}`);
    }
    if (!bytesEqual(input.prevLink, head.latestLink)) return new LinkMismatchError(abortMsg);
    return new Error(`anchor tx aborted (not a prev_link race): ${abortMsg}`);
  }
}
