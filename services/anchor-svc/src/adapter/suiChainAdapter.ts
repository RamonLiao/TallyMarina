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
      // A thrown error here is a transport/network failure, NOT an on-chain abort.
      // On-chain aborts come back via the FailedTransaction branch below.
      throw e;
    }

    // 2.19 returns a discriminated union: check $kind for failure.
    // ELinkMismatch identified via Move 2024 clever-error constantName; requires a gRPC
    // backend that populates cleverError. If cleverError is absent, the tx fails loud
    // rather than auto-retrying — confirm the abort shape at the testnet e2e.
    if (result.$kind === 'FailedTransaction') {
      const ftx = result.FailedTransaction;
      const err = ftx.status.success === false ? ftx.status.error : undefined;
      if (err?.$kind === 'MoveAbort' && err.MoveAbort?.cleverError?.constantName === 'ELinkMismatch') {
        throw new LinkMismatchError(err.message);
      }
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
}
