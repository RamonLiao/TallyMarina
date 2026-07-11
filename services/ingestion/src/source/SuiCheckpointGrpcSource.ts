import type { FetchPage, FetchResult, RawTxEnvelope } from '../domain/types.js';
import type { IngestionSource } from './IngestionSource.js';

// Structural subset of @mysten/sui SuiGrpcClient (spec §13.1). gRPC has no
// by-address query API, so this source scans checkpoints and filters locally;
// persisting into DB seeds the custom indexer. Kept structural so tests run
// offline, matching the SuiClientLike pattern of the retired JSON-RPC source.
//
// Shapes verified against @mysten/sui@2.19.0:
//   core.getChainIdentifier()      -> { chainIdentifier }
//   core.getCurrentSystemState()   -> { systemState: { epoch } }
//   ledgerService.getServiceInfo() -> UnaryCall<{ response: { checkpointHeight } }>
//   ledgerService.getCheckpoint()  -> UnaryCall<{ response: { checkpoint } }>
// UnaryCall is awaitable and resolves to a { response } envelope.
interface CheckpointGrpcClientLike {
  core: {
    getChainIdentifier(): Promise<{ chainIdentifier: string }>;
    getCurrentSystemState(): Promise<{ systemState: { epoch: string } }>;
  };
  ledgerService: {
    getServiceInfo(input: unknown): PromiseLike<{ response: { checkpointHeight?: bigint } }>;
    getCheckpoint(input: unknown): PromiseLike<{ response: { checkpoint?: GrpcCheckpoint } }>;
  };
}

interface GrpcOwner { address?: string }
interface GrpcChangedObject { objectId?: string; inputOwner?: GrpcOwner; outputOwner?: GrpcOwner }
interface GrpcBalanceChange { address?: string; coinType?: string; amount?: string }
interface GrpcTimestamp { seconds?: bigint | string; nanos?: number }
interface GrpcExecutedTx {
  digest?: string;
  transaction?: { sender?: string };
  balanceChanges?: GrpcBalanceChange[];
  effects?: { status?: { success?: boolean }; changedObjects?: GrpcChangedObject[] };
  timestamp?: GrpcTimestamp;
}
interface GrpcCheckpoint { sequenceNumber?: bigint; transactions?: GrpcExecutedTx[] }

// read_mask: parent path `transactions` pulls the whole executed-transaction
// submessage (sender, balance_changes, effects.changed_objects, timestamp) so
// the three-facet filter and rawJson have every field they need.
const CHECKPOINT_READ_MASK = { paths: ['sequence_number', 'transactions'] };

function parseSeq(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative integer, got: ${value}`);
  return BigInt(value);
}

function timestampToMs(ts: GrpcTimestamp | undefined): string {
  if (!ts || ts.seconds === undefined) return '0';
  const seconds = BigInt(ts.seconds);
  const millisFromNanos = BigInt(Math.floor((ts.nanos ?? 0) / 1_000_000));
  return (seconds * 1000n + millisFromNanos).toString();
}

// proto messages carry bigint fields; JSON-stringify them (contentHash and
// JSONB storage both require a bigint-free value). This is the "proto JSON化".
function toJsonSafe(tx: GrpcExecutedTx): unknown {
  return JSON.parse(JSON.stringify(tx, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

export class SuiCheckpointGrpcSource implements IngestionSource {
  readonly kind = 'sui-grpc' as const;
  private readonly startCheckpoint: bigint;

  constructor(
    private client: CheckpointGrpcClientLike,
    private expectedChainId: string,
    startCheckpoint: string,
  ) {
    // fail-loud on a bad --from-checkpoint before any network call.
    this.startCheckpoint = parseSeq(startCheckpoint, 'startCheckpoint');
  }

  // Three-facet relevance test (spec §13.2 d): sender, balanceChanges owner,
  // and object-level moves in changed_objects (input/output owner). Fail-closed:
  // if any facet's field is absent we cannot rule the tx out, so we include it
  // rather than risk a silent miss (漏帳). Full read_mask makes complete data
  // the norm; conservative inclusion only triggers on truncated responses.
  private isRelevant(tx: GrpcExecutedTx, address: string): boolean {
    const sender = tx.transaction?.sender;
    const balanceChanges = tx.balanceChanges;
    const changedObjects = tx.effects?.changedObjects;

    const senderKnown = sender !== undefined;
    const balancesKnown = Array.isArray(balanceChanges);
    const objectsKnown = Array.isArray(changedObjects);

    const matched =
      sender === address ||
      (balancesKnown && balanceChanges!.some((b) => b.address === address)) ||
      (objectsKnown && changedObjects!.some(
        (o) => o.inputOwner?.address === address || o.outputOwner?.address === address,
      ));

    const complete = senderKnown && balancesKnown && objectsKnown;
    return matched || !complete;
  }

  private toEnvelope(tx: GrpcExecutedTx, checkpointSeq: bigint): RawTxEnvelope {
    return {
      digest: String(tx.digest ?? ''),
      checkpoint: checkpointSeq.toString(),
      timestampMs: timestampToMs(tx.timestamp),
      status: tx.effects?.status?.success === true ? 'success' : 'failure',
      rawJson: toJsonSafe(tx),
    };
  }

  async fetchTransactions(req: FetchPage): Promise<FetchResult> {
    // cursor = next checkpoint sequence to scan. null/undefined => startCheckpoint.
    // NOTE semantic difference from the JSON-RPC source: req.limit here caps the
    // number of CHECKPOINTS scanned per page (N), not the number of txs returned.
    const start = req.cursor == null ? this.startCheckpoint : parseSeq(req.cursor, 'cursor');
    const maxCheckpoints = req.limit > 0 ? BigInt(req.limit) : 1n;

    const info = await this.client.ledgerService.getServiceInfo({});
    const latest = info.response.checkpointHeight;
    if (latest === undefined) throw new Error('getServiceInfo returned no checkpointHeight');

    const txs: RawTxEnvelope[] = [];
    let seq = start;
    let scanned = 0n;
    for (; scanned < maxCheckpoints && seq <= latest; seq++, scanned++) {
      const res = await this.client.ledgerService.getCheckpoint({
        checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber: seq },
        readMask: CHECKPOINT_READ_MASK,
      });
      const checkpoint = res.response.checkpoint;
      if (!checkpoint) throw new Error(`checkpoint ${seq} unavailable (pruned or below retention)`);
      for (const tx of checkpoint.transactions ?? []) {
        if (this.isRelevant(tx, req.address)) txs.push(this.toEnvelope(tx, seq));
      }
    }

    // lastScanned = seq - 1 (== start - 1 when nothing was scanned at the tip).
    const lastScanned = seq - 1n;
    return {
      txs,
      nextCursor: seq.toString(),                 // last scanned checkpoint + 1
      hasNextPage: lastScanned < latest,          // still trailing the tip
    };
  }

  async describe() {
    const { chainIdentifier } = await this.client.core.getChainIdentifier();
    if (chainIdentifier !== this.expectedChainId) {
      throw new Error(`chain identifier mismatch: got ${chainIdentifier}, expected ${this.expectedChainId}`);
    }
    const { systemState } = await this.client.core.getCurrentSystemState();
    return { chainIdentifier, epoch: Number(systemState.epoch) };
  }
}
