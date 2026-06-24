import { describe, it, expect } from 'vitest';
import { buildBundle } from './buildBundle';
import type { BundleInput } from './buildBundle';
import type { JournalDTO, InclusionProof } from '../../api/types';

// ---- fixture helpers ----

function L(account: string, side: 'DEBIT' | 'CREDIT', amountMinor: string) {
  return { account, side, amountMinor, origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null };
}

function makeJE(id: string, eventId: string, ikey: string): JournalDTO {
  return {
    id,
    eventId,
    idempotencyKey: ikey,
    leafHash: `leaf-${id}`,
    je: {
      idempotencyKey: ikey,
      lineageHash: `lh-${id}`,
      reversalOf: null,
      lines: [
        L('Cash', 'DEBIT', '10000'),
        L('Revenue', 'CREDIT', '10000'),
      ],
    },
  };
}

const je1 = makeJE('je1', 'ev1', 'ik1');
const je2 = makeJE('je2', 'ev2', 'ik2');
const journal: JournalDTO[] = [je1, je2];

const dateByEventId: Record<string, string> = { ev1: '2025-01-01', ev2: '2025-01-02' };

const baseInput: Omit<BundleInput, 'binding'> = {
  entityId: 'ent-1',
  periodId: 'p-2025-01',
  functionalCurrency: 'USD',
  scale: 2,
  generatedAt: '2025-01-31T00:00:00Z',
  journal,
  dateByEventId,
};

const proof1: InclusionProof = { idempotencyKey: 'ik1', leafIndex: 0, siblings: [], merkleRoot: 'root-abc' };
const proof2: InclusionProof = { idempotencyKey: 'ik2', leafIndex: 1, siblings: [], merkleRoot: 'root-abc' };

const verifiedInput: BundleInput = {
  ...baseInput,
  binding: {
    anchor: { merkleRoot: 'root-abc', snapshotId: 'snap-1', digest: 'tx-abc', explorerUrl: 'https://x', leafCount: 2 },
    proofs: [proof1, proof2],
  },
};

const draftInput: BundleInput = { ...baseInput, binding: null };

// ---- tests ----

describe('buildBundle', () => {
  it('verified path: returns verified=true, correct files, summary.completenessOk=true', async () => {
    const result = await buildBundle(verifiedInput);

    expect(result.verified).toBe(true);
    expect(result.summary.verified).toBe(true);
    expect(result.summary.completenessOk).toBe(true);

    const names = result.files.map((f) => f.name);
    expect(names).toContain('journal.csv');
    expect(names).toContain('account-activity.csv');
    expect(names).toContain('quantity-recon.csv');
    expect(names).toContain('journal.json');
    expect(names).toContain('manifest.json');
    expect(names).toContain('VERIFY.md');
  });

  it('verified path: manifest has verified:true, non-null anchor, inclusionProofs', async () => {
    const result = await buildBundle(verifiedInput);
    const manifestFile = result.files.find((f) => f.name === 'manifest.json')!;
    const manifest = JSON.parse(manifestFile.content) as Record<string, unknown>;

    expect(manifest.verified).toBe(true);
    expect(manifest.anchor).not.toBeNull();
    const inclusionProofs = manifest.inclusionProofs as unknown[];
    expect(inclusionProofs).toHaveLength(journal.length);
    const completeness = manifest.completeness as Record<string, unknown>;
    expect(completeness.bundledJeCount).toBe(completeness.anchoredLeafCount);
  });

  it('draft path: verified=false, manifest verified:false, anchor:null, no inclusionProofs', async () => {
    const result = await buildBundle(draftInput);

    expect(result.verified).toBe(false);
    expect(result.summary.verified).toBe(false);

    const manifestFile = result.files.find((f) => f.name === 'manifest.json')!;
    const manifest = JSON.parse(manifestFile.content) as Record<string, unknown>;

    expect(manifest.verified).toBe(false);
    expect(manifest.anchor).toBeNull();
    expect(manifest.inclusionProofs).toBeUndefined();
  });

  it('manifest files[] excludes manifest.json itself, sha256 is 64-hex per file', async () => {
    const result = await buildBundle(verifiedInput);
    const manifestFile = result.files.find((f) => f.name === 'manifest.json')!;
    const manifest = JSON.parse(manifestFile.content) as { files: Array<{ name: string; sha256: string }> };

    const fileNames = manifest.files.map((f) => f.name);
    expect(fileNames).not.toContain('manifest.json');
    for (const f of manifest.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('completeness mismatch throws', async () => {
    const badInput: BundleInput = {
      ...baseInput,
      binding: {
        anchor: { merkleRoot: 'root-abc', snapshotId: 'snap-1', digest: 'tx-abc', explorerUrl: 'https://x', leafCount: 99 },
        proofs: [proof1, proof2],
      },
    };
    await expect(buildBundle(badInput)).rejects.toThrow('completeness');
  });

  it('missing date for eventId throws', async () => {
    const badDateInput: BundleInput = { ...draftInput, dateByEventId: {} };
    await expect(buildBundle(badDateInput)).rejects.toThrow();
  });
});
