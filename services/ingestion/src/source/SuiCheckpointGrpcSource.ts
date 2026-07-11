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
    getServiceInfo(input: unknown): PromiseLike<{
      response: { checkpointHeight?: bigint; lowestAvailableCheckpoint?: bigint };
    }>;
    getCheckpoint(input: unknown): PromiseLike<{ response: { checkpoint?: GrpcCheckpoint } }>;
  };
}

// Structural subsets of the @mysten/sui gRPC proto messages we consume. Field
// names mirror the generated d.mts (camelCase) so the mapping below is 1:1 with
// sui.rpc.v2.* — see node_modules/@mysten/sui/dist/grpc/proto/sui/rpc/v2/*.d.mts.
interface GrpcOwner { address?: string }
// sui.rpc.v2.ChangedObject: object_type (field 11) is populated by an indexing
// layer and may be absent over raw gRPC; when absent, deconstruct cannot detect
// StakedSui and classifies the move as object_transfer (never fabricated).
interface GrpcChangedObject {
  objectId?: string;
  inputOwner?: GrpcOwner;
  outputOwner?: GrpcOwner;
  objectType?: string;
}
interface GrpcBalanceChange { address?: string; coinType?: string; amount?: string }
interface GrpcGasUsed {
  computationCost?: bigint | string;
  storageCost?: bigint | string;
  storageRebate?: bigint | string;
  nonRefundableStorageFee?: bigint | string;
}
interface GrpcEvent { packageId?: string; module?: string; sender?: string; eventType?: string }
interface GrpcTransactionEvents { events?: GrpcEvent[] }
interface GrpcTimestamp { seconds?: bigint | string; nanos?: number }
interface GrpcExecutedTx {
  digest?: string;
  transaction?: { sender?: string };
  balanceChanges?: GrpcBalanceChange[];
  effects?: {
    status?: { success?: boolean };
    changedObjects?: GrpcChangedObject[];
    gasUsed?: GrpcGasUsed;
  };
  events?: GrpcTransactionEvents;
  timestamp?: GrpcTimestamp;
}
interface GrpcCheckpoint { sequenceNumber?: bigint; transactions?: GrpcExecutedTx[] }

// read_mask: parent path `transactions` pulls the whole executed-transaction
// submessage — sender, balance_changes, effects (status + gas_used +
// changed_objects), events and per-tx timestamp — so the three-facet filter and
// the JSON-RPC-compatible rawJson mapping have every field they need. A parent
// message path in a FieldMask includes all descendant fields.
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

// Strip bigints (contentHash and JSONB storage both require a bigint-free value).
function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

function ownerJson(owner: GrpcOwner | undefined): { AddressOwner: string } | undefined {
  return owner?.address !== undefined ? { AddressOwner: owner.address } : undefined;
}

// Map a gRPC proto tx into the JSON-RPC-compatible rawJson shape that
// core/deconstruct.ts parses. deconstruct only recognizes these top-level keys
// (balanceChanges, objectChanges, effects, events); emitting ONLY these keys is
// what keeps the effect stream free of spurious `unknown` effects. Proto
// envelope fields (digest, transaction, signatures, checkpoint, timestamp, bcs)
// are deliberately excluded — digest/checkpoint/timestamp live on the envelope,
// and bytes fields (bcs/signatures) are dropped so serialization stays clean.
function toRawJson(tx: GrpcExecutedTx): Record<string, unknown> {
  const rawJson: Record<string, unknown> = {};

  if (Array.isArray(tx.balanceChanges)) {
    rawJson.balanceChanges = tx.balanceChanges.map((b) => ({
      owner: ownerJson({ address: b.address }),
      coinType: b.coinType,
      amount: b.amount,
    }));
  }

  // objectChanges are derived from effects.changed_objects. deconstruct reads
  // objectId + objectType; owner/recipient are carried for lineage fidelity.
  const changed = tx.effects?.changedObjects;
  if (Array.isArray(changed)) {
    rawJson.objectChanges = changed.map((o) => ({
      objectId: o.objectId,
      objectType: o.objectType,
      owner: ownerJson(o.inputOwner),
      recipient: o.outputOwner?.address,
    }));
  }

  // effects: status carried as JSON-RPC { status: 'success'|'failure' }; gasUsed
  // (when present) is what makes deconstruct emit the single gas effect. Always
  // present so status is preserved even for gas-free system txs.
  const effects: Record<string, unknown> = {
    status: { status: tx.effects?.status?.success === true ? 'success' : 'failure' },
  };
  if (tx.effects?.gasUsed) effects.gasUsed = tx.effects.gasUsed;
  rawJson.effects = effects;

  // events: proto TransactionEvents.events -> flat array deconstruct iterates.
  if (Array.isArray(tx.events?.events)) rawJson.events = tx.events!.events;

  return toJsonSafe(rawJson);
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
    // Validate digest at the source: an empty digest would otherwise surface as a
    // vague zod failure downstream in ingestEntity. Fail loud with the checkpoint
    // sequence so the offending tx is locatable.
    if (!tx.digest) {
      throw new Error(`gRPC tx in checkpoint ${checkpointSeq} has no digest (unexpected empty ExecutedTransaction.digest)`);
    }
    return {
      digest: tx.digest,
      checkpoint: checkpointSeq.toString(),
      timestampMs: timestampToMs(tx.timestamp),
      status: tx.effects?.status?.success === true ? 'success' : 'failure',
      rawJson: toRawJson(tx),
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

    // Retention guard (spec §13): the node prunes checkpoints below
    // lowestAvailableCheckpoint. Requesting a start (from --from-checkpoint or a
    // resume cursor) below it can never succeed, so fail loud up front with an
    // actionable message rather than 6 pages into a scan. Backfilling below
    // retention requires an archival source. (AnomalyKind 'retention_gap' is
    // reserved for that future archival path; not raised on this scan path.)
    const lowest = info.response.lowestAvailableCheckpoint;
    if (lowest !== undefined && start < lowest) {
      throw new Error(
        `start checkpoint ${start} is below the node's lowest available checkpoint ${lowest}; ` +
          `it has been pruned. Raise --from-checkpoint (or the resume cursor) to >= ${lowest}, ` +
          `or backfill below retention from an archival source (see spec §13).`,
      );
    }

    const txs: RawTxEnvelope[] = [];
    let seq = start;
    let scanned = 0n;
    for (; scanned < maxCheckpoints && seq <= latest; seq++, scanned++) {
      const res = await this.client.ledgerService.getCheckpoint({
        checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber: seq },
        readMask: CHECKPOINT_READ_MASK,
      });
      const checkpoint = res.response.checkpoint;
      // fail-loud, not silent-skip: a missing checkpoint mid-scan means the
      // accounting stream would have a hole (recon break). Surface it.
      if (!checkpoint) {
        throw new Error(
          `checkpoint ${seq} unavailable mid-scan (pruned or below retention); ` +
            `cannot skip without breaking reconciliation. Backfill below retention needs an archival source (spec §13).`,
        );
      }
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
