import { Transaction } from '@mysten/sui/transactions';
import type { CoreClient } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import {
  LinkMismatchError,
  type AnchorResult, type ChainState, type ExecAnchorInput, type SuiChainPort,
} from '../domain/types.js';

const MODULE = 'audit_anchor';

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
      if (String((e as Error).message).includes('ELinkMismatch') || isLinkMismatchAbort(e)) {
        throw new LinkMismatchError(String((e as Error).message));
      }
      throw e;
    }

    // 2.19 returns a discriminated union: check $kind for failure
    if (result.$kind === 'FailedTransaction') {
      const tx2 = result.FailedTransaction;
      const err = tx2.status.success === false
        ? JSON.stringify(tx2.status.error)
        : 'unknown';
      if (err.includes('ELinkMismatch') || isLinkMismatchAbort(err)) throw new LinkMismatchError(err);
      throw new Error(`anchor tx failed: ${err}`);
    }

    const succeeded = result.Transaction;
    // events is conditional on Include; cast since we passed include: { events: true }
    const events = succeeded.events as Array<{ eventType: string; json: Record<string, unknown> | null }> | undefined;
    const ev = events?.find((e) => e.eventType.endsWith(`::${MODULE}::SnapshotAnchored`));
    if (!ev) throw new Error('SnapshotAnchored event missing');
    const pj = ev.json as Record<string, unknown>;
    return {
      digest: succeeded.digest,
      seq: BigInt(pj.seq as string),
      link: Uint8Array.from(pj.link as number[]),
    };
  }
}

// ELinkMismatch is abort code in audit_anchor; match its MoveAbort string form
// (e.g. "MoveAbort(...audit_anchor..., <code>)"). Confirm the exact abort-code
// number/string from the failing-tx output during the e2e and tighten this.
function isLinkMismatchAbort(e: unknown): boolean {
  const s = typeof e === 'string' ? e : String((e as Error)?.message ?? '');
  return /MoveAbort/.test(s) && /audit_anchor/.test(s);
}
