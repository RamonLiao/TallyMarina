import { Transaction } from '@mysten/sui/transactions';
import type { Signer } from '@mysten/sui/cryptography';
import {
  type AnchorResult, type ChainState, type ExecAnchorInput, type SuiChainPort,
} from '../domain/types.js';

const MODULE = 'audit_anchor';

// gRPC JSON serializes Move vector<u8> as base64 strings (not number[]).
// Handle both forms defensively.
function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string') return Uint8Array.from(Buffer.from(v, 'base64'));
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  throw new Error(`cannot convert ${typeof v} to Uint8Array`);
}

/**
 * gRPC getObject returns a protobuf-derived shape that differs from JSON-RPC:
 * owner/version nest differently and TypeName serializes as a plain string (v1.70+).
 * This adapter reads `res.object.json` for Move fields and `res.object.owner.address`
 * for ownership. Parse defensively; throw on missing fields (fail-closed).
 */
export class SuiGrpcChainAdapter implements SuiChainPort {
  // `client` is a SuiGrpcClient; we only touch `client.core`.
  constructor(private readonly client: { core: GrpcCore }, private readonly signer?: Signer) {}

  private async fields(objectId: string): Promise<Record<string, unknown>> {
    const res = await this.client.core.getObject({ objectId, include: { json: true } });
    const f = res?.object?.json as Record<string, unknown> | undefined | null;
    if (!f) throw new Error(`object ${objectId} not found or json unavailable (gRPC)`);
    return f;
  }

  async getChainState(chainObjectId: string): Promise<ChainState> {
    const f = await this.fields(chainObjectId);
    return {
      entityRef: toBytes(f.entity_ref),
      latestLink: toBytes(f.latest_link),
      seq: BigInt(f.seq as string),
      capEpoch: BigInt(f.cap_epoch as string),
    };
  }

  async getCapEpoch(capObjectId: string): Promise<bigint> {
    const f = await this.fields(capObjectId);
    return BigInt(f.epoch as string);
  }

  async getCapOwner(capObjectId: string): Promise<string> {
    const res = await this.client.core.getObject({ objectId: capObjectId, include: { json: true } });
    const owner = res?.object?.owner as { $kind?: string; AddressOwner?: string } | undefined;
    const addr = owner?.$kind === 'AddressOwner' ? owner.AddressOwner : undefined;
    if (!addr) throw new Error(`cap ${capObjectId} owner address unavailable (gRPC shape)`);
    return addr;
  }

  async waitForTransaction(digest: string): Promise<void> {
    await this.client.core.waitForTransaction({ digest });
  }

  async getAnchorEvent(digest: string): Promise<{ seq: bigint; link: Uint8Array }> {
    const res = await this.client.core.getTransaction({ digest, include: { events: true } }) as Record<string, unknown>;
    const events = (res?.['events'] ?? (res?.['transaction'] as Record<string, unknown> | undefined)?.['events']) as Array<{ eventType?: string; type?: string; json?: Record<string, unknown> | null }> | undefined;
    const ev = events?.find((e) => (e.eventType ?? e.type ?? '').endsWith(`::${MODULE}::SnapshotAnchored`));
    if (!ev || !ev.json) throw new Error('SnapshotAnchored event missing in tx ' + digest);
    return { seq: BigInt(ev.json.seq as string), link: toBytes(ev.json.link) };
  }

  /** Test-key sign path (demo-e2e only). Browser flow does NOT call this. */
  async execAnchor(input: ExecAnchorInput): Promise<AnchorResult> {
    if (!this.signer) throw new Error('execAnchor requires a signer (test-key path only)');
    const tx = new Transaction();
    tx.moveCall({
      target: `${input.packageId}::${MODULE}::anchor_snapshot`,
      arguments: [
        tx.object(input.chainObjectId),
        tx.object(input.capObjectId),
        tx.pure.vector('u8', Array.from(input.args.manifestHash)),
        tx.pure.vector('u8', Array.from(input.args.merkleRoot)),
        tx.pure.vector('u8', Array.from(input.args.periodId)),
        tx.pure.vector('u8', Array.from(input.prevLink)),
        tx.pure.u64(input.args.supersedesSeq),
      ],
    });
    tx.setSender(await this.signer.toSuiAddress());
    const res = await this.client.core.signAndExecuteTransaction({ transaction: tx, signer: this.signer });
    const digest = (res as Record<string, unknown>)?.['digest'] as string | undefined;
    if (!digest) throw new Error('no digest from signAndExecuteTransaction');
    await this.waitForTransaction(digest); // back-to-back cap txs need this (anchor-notes)
    const ev = await this.getAnchorEvent(digest);
    return { digest, seq: ev.seq, link: ev.link };
  }
}

// Minimal structural type of the SuiGrpcClient.core surface we use.
interface GrpcCore {
  getObject(args: { objectId: string; include?: { json?: boolean } }): Promise<{ object?: { json?: Record<string, unknown> | null; owner?: unknown } }>;
  getTransaction(args: { digest: string; include?: { events?: boolean } }): Promise<unknown>;
  waitForTransaction(args: { digest: string }): Promise<unknown>;
  signAndExecuteTransaction(args: { transaction: Transaction; signer: Signer }): Promise<unknown>;
}
