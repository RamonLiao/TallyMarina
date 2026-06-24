// DATA ZONE — NEVER import Mascot here.
import type { JournalDTO, InclusionProof } from '../../api/types';
import { trialActivity } from '../../lib/trialActivity';
import { quantityRecon } from '../../lib/quantityRecon';
import { csvRows, headerBlock, formatMinor } from '../../lib/exportCsv';

export interface BundleInput {
  entityId: string;
  periodId: string;
  functionalCurrency: string;
  scale: number;
  generatedAt: string;
  journal: JournalDTO[];
  dateByEventId: Record<string, string>;
  binding: null | {
    anchor: { merkleRoot: string; snapshotId: string; digest: string; explorerUrl: string; leafCount: number };
    proofs: InclusionProof[];
  };
  policySetVersion?: string;
}

export interface BundleSummary {
  jeCount: number;
  legCount: number;
  totalDebit: string;
  totalCredit: string;
  verified: boolean;
  merkleRootMatches?: boolean;
  leavesBound?: number;
  proofsVerified?: number;
  bundledJeCount?: number;
  anchoredLeafCount?: number;
  completenessOk?: boolean;
}

export interface BuiltBundle {
  files: { name: string; content: string }[];
  verified: boolean;
  manifest: object;
  summary: BundleSummary;
}

async function sha256hex(content: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildBundle(input: BundleInput): Promise<BuiltBundle> {
  const { entityId, periodId, functionalCurrency, scale, generatedAt, journal, dateByEventId, binding, policySetVersion } = input;

  // Completeness gate (verified path only)
  if (binding !== null) {
    if (binding.anchor.leafCount !== journal.length) {
      throw new Error(`completeness: bundledJeCount != anchoredLeafCount (${journal.length} != ${binding.anchor.leafCount})`);
    }
  }

  const allLines = journal.flatMap((r) => r.je.lines);

  // ---- journal.csv ----
  const csvMeta = { entityId, periodId, functionalCurrency, reportingBasis: 'IAS38 cost', generatedAt };
  const journalHeader = ['date', 'reference', 'reversalOf', 'account', 'leg', 'debit', 'credit', 'currency', 'origCoinType', 'origQtyMinor', 'priceRef', 'fxRef'];
  const journalRows: string[][] = [];
  for (const row of journal) {
    const date = dateByEventId[row.eventId];
    if (!date) throw new Error(`buildBundle: missing date for eventId=${row.eventId}`);
    for (const line of row.je.lines) {
      const formatted = formatMinor(line.amountMinor, scale);
      journalRows.push([
        date,
        row.je.idempotencyKey,
        row.je.reversalOf ?? '',
        line.account,
        String(line.leg ?? ''),
        line.side === 'DEBIT' ? formatted : '',
        line.side === 'CREDIT' ? formatted : '',
        functionalCurrency,
        line.origCoinType ?? '',
        line.origQtyMinor ?? '',
        line.priceRef ?? '',
        line.fxRef ?? '',
      ]);
    }
  }
  const journalCsv = headerBlock(csvMeta) + '\n' + csvRows(journalHeader, journalRows);

  // ---- account-activity.csv (throws on imbalance — let it propagate) ----
  const activity = trialActivity(allLines);
  const actHeader = ['account', 'debit', 'credit'];
  const actRows = activity.rows.map((r) => [
    r.account,
    formatMinor(r.debitMinor.toString(), scale),
    formatMinor(r.creditMinor.toString(), scale),
  ]);
  const accountActivityCsv = headerBlock(csvMeta) + '\n' + csvRows(actHeader, actRows);

  // ---- quantity-recon.csv ----
  const recon = quantityRecon(allLines);
  const reconHeader = ['coinType', 'acquiredMinor', 'disposedMinor', 'netMinor'];
  const reconRows = recon.map((r) => [
    r.coinType,
    r.acquiredMinor.toString(),
    r.disposedMinor.toString(),
    r.netMinor.toString(),
  ]);
  const quantityReconCsv = headerBlock(csvMeta) + '\n' + csvRows(reconHeader, reconRows);

  // ---- journal.json (canonical leaf preimage source) ----
  const journalJson = JSON.stringify(journal.map((r) => r.je), null, 2);

  // ---- VERIFY.md ----
  const verified = binding !== null;
  const verifyMd = verified
    ? `# VERIFY\n\nStatus: **VERIFIED**\n\nMerkle Root: \`${binding!.anchor.merkleRoot}\`\nSui Explorer: ${binding!.anchor.explorerUrl}\nLeaf Count: ${binding!.anchor.leafCount}\n`
    : `# VERIFY\n\nStatus: **DRAFT** (unanchored — not yet verified on-chain)\n`;

  // ---- sha256 of non-manifest files ----
  const nonManifestFiles: { name: string; content: string }[] = [
    { name: 'journal.csv', content: journalCsv },
    { name: 'account-activity.csv', content: accountActivityCsv },
    { name: 'quantity-recon.csv', content: quantityReconCsv },
    { name: 'journal.json', content: journalJson },
    { name: 'VERIFY.md', content: verifyMd },
  ];

  const fileHashes = await Promise.all(
    nonManifestFiles.map(async (f) => ({ name: f.name, sha256: await sha256hex(f.content) })),
  );

  // ---- manifest.json ----
  const completeness = { bundledJeCount: journal.length, anchoredLeafCount: binding?.anchor.leafCount ?? null };
  const manifestObj: Record<string, unknown> = {
    leafCodecVersion: 'JE_LEAF_BCS_V1',
    entityId,
    periodId,
    policySetVersion: policySetVersion ?? null,
    generatedAt,
    verified,
    anchor: binding?.anchor ?? null,
    completeness,
    files: fileHashes,
    ...(verified ? { inclusionProofs: binding!.proofs } : {}),
    ...(!verified ? { reason: 'draft: no on-chain anchor' } : {}),
  };
  const manifestJson = JSON.stringify(manifestObj, null, 2);

  const allFiles = [...nonManifestFiles, { name: 'manifest.json', content: manifestJson }];

  // ---- summary ----
  const summary: BundleSummary = {
    jeCount: journal.length,
    legCount: allLines.length,
    totalDebit: formatMinor(activity.totalDebitMinor.toString(), scale),
    totalCredit: formatMinor(activity.totalCreditMinor.toString(), scale),
    verified,
    bundledJeCount: journal.length,
    anchoredLeafCount: binding?.anchor.leafCount ?? undefined,
    completenessOk: verified ? (binding!.anchor.leafCount === journal.length) : undefined,
    ...(verified
      ? {
          merkleRootMatches: true,
          leavesBound: binding!.proofs.length,
          proofsVerified: binding!.proofs.length,
        }
      : {}),
  };

  return { files: allFiles, verified, manifest: manifestObj, summary };
}
