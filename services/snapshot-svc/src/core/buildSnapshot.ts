import { buildMerkle } from '../deps/rulesEngine.js';
import type { RuleOutput, JournalEntry } from '../deps/rulesEngine.js';
import { validateMeta, assertPolicyVersionsUtf8 } from './validate.js';
import { manifestHash } from './manifestHash.js';
import { MANIFEST_CODEC_VERSION } from './manifestCodec.js';
import { AuditSnapshotRepo } from '../repo/snapshotRepo.js';
import {
  SnapshotMeta, SnapshotError, AuditSnapshot, AnchorPayload, SnapshotManifestStruct,
} from '../domain/types.js';

function dedupeSort(xs: string[]): string[] {
  return [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function buildSnapshot(
  outputs: RuleOutput[],
  meta: SnapshotMeta,
  repo: AuditSnapshotRepo,
  opts?: { restate?: boolean },
): { auditSnapshot: AuditSnapshot; anchorPayload: AnchorPayload } {
  validateMeta(meta);

  const postable = outputs.filter((o) => o.decision === 'POSTABLE');
  const jes: JournalEntry[] = postable.flatMap((o) => o.journalEntries);
  if (jes.length === 0) {
    throw new SnapshotError('EMPTY_SNAPSHOT', 'no POSTABLE journal entries to snapshot');
  }

  let merkle;
  try {
    merkle = buildMerkle(jes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('duplicate idempotencyKey')) {
      throw new SnapshotError('DUPLICATE_IDEMPOTENCY_KEY', msg);
    }
    throw e; // 未知 buildMerkle 錯誤照常冒泡，不吞
  }
  const { manifest: mm } = merkle;

  const policyVersions = dedupeSort(postable.flatMap((o) => o.explanation.policyVersions));
  assertPolicyVersionsUtf8(policyVersions);

  const manifest: SnapshotManifestStruct = {
    manifestVersion: MANIFEST_CODEC_VERSION,
    entityId: meta.entityId,
    periodId: meta.periodId,
    merkleRoot: mm.merkleRoot,
    leafCount: mm.leafCount,
    leafCodecVersion: mm.leafCodecVersion,
    merkleParams: {
      algo: mm.algo,
      leafDomainPrefix: mm.leafDomainPrefix,
      nodeDomainPrefix: mm.nodeDomainPrefix,
      oddNodePolicy: mm.oddNodePolicy,
      orderingPolicy: mm.orderingPolicy,
    },
    policyVersions,
    createdAtLogical: meta.createdAtLogical,
  };

  const mh = manifestHash(manifest);

  const { snapshot } = repo.freeze(
    {
      entityId: meta.entityId,
      periodId: meta.periodId,
      manifest,
      manifestHash: mh,
      merkleRoot: mm.merkleRoot,
      leafCount: mm.leafCount,
    },
    opts,
  );

  const anchorPayload: AnchorPayload = {
    manifestHash: snapshot.manifestHash,
    merkleRoot: snapshot.merkleRoot,
    periodId: snapshot.periodId,
    supersedesSeq: snapshot.supersedesSeq ?? 0,
  };

  return { auditSnapshot: snapshot, anchorPayload };
}
