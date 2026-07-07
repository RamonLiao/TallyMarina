// DATA ZONE — NEVER import Mascot here.
import { zipSync } from 'fflate';
import type { JournalDTO, EventDTO, AnchorDTO, InclusionProof, AnchorStaleness } from '../../api/types';
import { leafHash } from '../../lib/leafEncode';
import { resolveProofState } from '../../lib/proofVerify';
import { ImbalanceError } from '../../lib/trialActivity';
import { buildBundle } from './buildBundle';
import type { BundleSummary } from './buildBundle';

export interface ExportResult {
  ok: true;
  verified: boolean;
  filename: string;
  zip: Uint8Array;
  summary: BundleSummary;
  /** Present when verified=true. Full merkleRoot hex from the on-chain anchor (spec §7). */
  merkleRoot?: string;
  /** Present when verified=true. Explorer URL for the on-chain anchor transaction. */
  explorerUrl?: string;
}

export type ExportFailure =
  | { ok: false; kind: 'imbalance'; debit: string; credit: string }
  | { ok: false; kind: 'empty' }
  | { ok: false; kind: 'stale-restatement'; anchoredSeq: number; latestSnapshotSeq: number }
  | { ok: false; kind: 'error'; message: string };

export type ExportOutcome = ExportResult | ExportFailure;

export async function assembleExport(args: {
  entityId: string;
  periodId: string;
  functionalCurrency: string;
  scale: number;
  generatedAt: string;
  journal: JournalDTO[];
  events: EventDTO[];
  anchors: AnchorDTO[];
  fetchProof: (idempotencyKey: string) => Promise<{ anchors: AnchorDTO[]; inclusionProof: InclusionProof | null }>;
  policySetVersion?: string | null;
  anchorStaleness?: AnchorStaleness | null;
}): Promise<ExportOutcome> {
  const { entityId, periodId, functionalCurrency, scale, generatedAt, journal, events, anchors, fetchProof, policySetVersion, anchorStaleness } = args;

  // Step 1: empty guard
  if (journal.length === 0) return { ok: false, kind: 'empty' };

  // C-F3: a stale anchor means the on-chain proof no longer matches the current books.
  // Surface an explicit restatement disclosure instead of failing opaquely inside the
  // L2/proof loop. Empty journal already returned above.
  if (anchorStaleness?.stale) {
    return {
      ok: false, kind: 'stale-restatement',
      anchoredSeq: anchorStaleness.anchoredSeq,
      latestSnapshotSeq: anchorStaleness.latestSnapshotSeq,
    };
  }

  try {
    // Step 2: build date map from events
    const dateByEventId: Record<string, string> = {};
    for (const ev of events) {
      const norm = ev.normalized;
      let date: string | undefined;
      if (typeof norm.eventTime === 'string' && norm.eventTime) {
        date = norm.eventTime;
      } else if (typeof norm.timestampMs === 'string' || typeof norm.timestampMs === 'number') {
        date = new Date(Number(norm.timestampMs)).toISOString();
      } else {
        throw new Error(`assembleExport: event ${ev.id} has no usable date (no eventTime or timestampMs)`);
      }
      dateByEventId[ev.id] = date;
    }

    // Step 4: resolve period anchor (highest seq with periodId match and non-null merkleRoot)
    const periodAnchors = anchors
      .filter((a) => a.periodId === periodId && a.merkleRoot != null)
      .sort((a, b) => b.seq - a.seq);
    const resolvedAnchor = periodAnchors[0] ?? null;

    let binding: null | {
      anchor: { merkleRoot: string; snapshotId: string; digest: string; explorerUrl: string; leafCount: number };
      proofs: InclusionProof[];
    } = null;

    if (resolvedAnchor !== null) {
      // Step 5: verified candidate — L2 leaf hash check + proof verification
      const collectedProofs: InclusionProof[] = [];

      for (const row of journal) {
        // L2: recompute leaf hash and assert match
        const recomputed = await leafHash(row.je);
        if (recomputed !== row.leafHash) {
          throw new Error(
            `L2 leaf mismatch for ${row.je.idempotencyKey}: expected ${row.leafHash}, got ${recomputed}`,
          );
        }

        // Fetch inclusion proof
        const fetched = await fetchProof(row.je.idempotencyKey);
        if (fetched.inclusionProof == null) {
          throw new Error(
            `assembleExport: inclusionProof is null for ${row.je.idempotencyKey} on anchored period — cannot produce verified export`,
          );
        }

        // Resolve proof state — must be verified-onchain against the resolved anchor.
        //
        // Backend-trust seam（不可消除）：resolveProofState 使用的是每條 JE 個別 fetch
        // 回來的 fetched.anchors；cross-check 比對的是 args.anchors 裡的 period-level anchor。
        // 若後端同時回傳一致的偽造 anchors，這個 cross-check 會變成 vacuous（兩邊都是假的）。
        // 前端無法消除這個信任縫——真正的防竄改保證來自 L2 leaf hash 重算 + 鏈上 merkleRoot 驗證。
        const state = await resolveProofState({
          leafHash: row.leafHash,
          proof: fetched.inclusionProof,
          anchors: fetched.anchors,
        });

        if (state.kind !== 'verified-onchain') {
          throw new Error(
            `assembleExport: proof for ${row.je.idempotencyKey} resolved to '${state.kind}', expected 'verified-onchain'`,
          );
        }

        if (state.anchor.merkleRoot?.toLowerCase() !== resolvedAnchor.merkleRoot?.toLowerCase()) {
          throw new Error(
            `assembleExport: proof for ${row.je.idempotencyKey} anchors to root ${state.anchor.merkleRoot} but period anchor is ${resolvedAnchor.merkleRoot}`,
          );
        }

        collectedProofs.push(fetched.inclusionProof);
      }

      // Step 6: build binding
      binding = {
        anchor: {
          merkleRoot: resolvedAnchor.merkleRoot!,
          snapshotId: resolvedAnchor.snapshotId,
          digest: resolvedAnchor.digest,
          explorerUrl: resolvedAnchor.explorerUrl,
          leafCount: resolvedAnchor.leafCount,
        },
        proofs: collectedProofs,
      };
    }

    // Step 7: build bundle (throws ImbalanceError on imbalance, Error on missing date / completeness)
    const built = await buildBundle({
      entityId,
      periodId,
      functionalCurrency,
      scale,
      generatedAt,
      journal,
      dateByEventId,
      binding,
      ...(policySetVersion != null ? { policySetVersion } : {}),
    });

    // Step 8: zip
    const zip = zipSync(
      Object.fromEntries(built.files.map((f) => [f.name, new TextEncoder().encode(f.content)])),
    );

    // Step 9: filename
    const verified = binding !== null;
    const filename = verified
      ? `export-${entityId}-${periodId}.zip`
      : `export-${entityId}-${periodId}-UNVERIFIED-DRAFT.zip`;

    return {
      ok: true,
      verified,
      filename,
      zip,
      summary: built.summary,
      ...(binding !== null && {
        merkleRoot: binding.anchor.merkleRoot,
        explorerUrl: binding.anchor.explorerUrl,
      }),
    };
  } catch (err) {
    if (err instanceof ImbalanceError) {
      return {
        ok: false,
        kind: 'imbalance',
        debit: err.debit.toString(),
        credit: err.credit.toString(),
      };
    }
    return {
      ok: false,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
