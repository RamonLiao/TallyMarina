import { useEffect, useState } from 'react';
import { useEntities, useSnapshot, usePrepareAnchor, useConfirmAnchor, useAnchors, useJournal } from '../api/hooks';
import { useEntityCtx } from '../app/EntityContext';
import { useWallet } from '../wallet/useWallet';
import { HashChain } from '../components/data/HashChain';
import { Celebration } from '../components/chrome/Celebration';
import { Mascot } from '../components/chrome/Mascot';
import type { AnchorDTO, AnchorStaleness } from '../api/types';

export function AnchorStep({ anchorStaleness }: { anchorStaleness?: AnchorStaleness | null } = {}) {
  const { data: entities } = useEntities();
  const { entity, setEntity, periodId } = useEntityCtx();
  useEffect(() => { if (!entity && entities?.[0]) setEntity(entities[0]); }, [entity, entities, setEntity]);

  const wallet = useWallet();
  const snap = useSnapshot(entity?.id ?? '');
  const prepare = usePrepareAnchor(entity?.id ?? '');
  const confirm = useConfirmAnchor(entity?.id ?? '');
  const { data: journal } = useJournal(entity?.id);
  const firstIdempotencyKey = journal?.[0]?.idempotencyKey;
  const { data: anchorData } = useAnchors(entity?.id, firstIdempotencyKey);

  // Soft-force restatement copy (§W-F2): once anchorStaleness.stale, the Freeze CTA
  // names the concrete NEXT version (latestSnapshotSeq + 1) so the user knows exactly
  // which snapshot they're about to produce. This never blocks — it's a label only.
  const freezeLabel = anchorStaleness?.stale
    ? `Freeze restatement (v${anchorStaleness.latestSnapshotSeq + 1})`
    : 'Freeze snapshot';

  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [confirmed, setConfirmed] = useState<AnchorDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function anchorNow() {
    if (!entity || !snapshotId || !wallet.address) return;
    setErr(null); setSigning(true);
    try {
      const prep = await prepare.mutateAsync({ snapshotId, walletAddress: wallet.address });
      const { digest } = await wallet.signAndExecute(prep.txKind); // wallet resolves gas+versions (§5)
      const anchor = await confirm.mutateAsync({ snapshotId, digest, expectedSeq: prep.expectedSeq });
      setConfirmed(anchor);
    } catch (e) {
      setErr((e as Error).message); // wallet rejection / chain mismatch — never writes ANCHORED
    } finally {
      setSigning(false);
    }
  }

  if (confirmed) {
    // Render `confirmed` immediately; once useAnchors refetches it also appears in
    // anchorData.anchors (same id) — merge by id (confirmed wins) to avoid a duplicate
    // React key while never showing a staler copy than what we just confirmed.
    const fetched = anchorData?.anchors ?? [];
    const anchors = fetched.some((a) => a.id === confirmed.id)
      ? fetched.map((a) => (a.id === confirmed.id ? confirmed : a))
      : [...fetched, confirmed];
    return (
      <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
        <Celebration digest={confirmed.digest} explorerUrl={confirmed.explorerUrl} />
        <HashChain anchors={anchors} inclusionProof={anchorData?.inclusionProof ?? null} />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <div className="card" style={{ padding: 'var(--s-6)' }}>
        <h2 style={{ marginTop: 0 }}>Snapshot & Anchor</h2>

        {!snapshotId && (
          <button
            className="btn-primary"
            disabled={snap.isPending}
            onClick={() => snap.mutate(periodId, { onSuccess: (s) => setSnapshotId(s.id) })}
          >
            {snap.isPending ? 'Freezing…' : freezeLabel}
          </button>
        )}

        {snap.isSuccess && snapshotId && (
          <div style={{ display: 'grid', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
            <p className="mono" style={{ fontSize: 'var(--text-base)' }}>
              merkleRoot {snap.data.merkleRoot.slice(0, 14)}… · {snap.data.leafCount} leaves · FROZEN
            </p>
            {!wallet.address && <p className="font-body" style={{ color: 'var(--warn)' }}>Connect a wallet to anchor.</p>}
            <button className="btn-primary" disabled={!wallet.address || signing} onClick={anchorNow}>
              {signing ? 'Awaiting signature…' : 'Anchor on-chain'}
            </button>
            {signing && (
              <div className="austere" style={{ padding: 'var(--s-4)', display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                <Mascot pose="thinking" size={32} />
                <span className="mono" style={{ color: 'var(--austere-mono)' }}>Awaiting wallet signature…</span>
              </div>
            )}
            {err && <p className="mono" style={{ color: 'var(--debit)', fontSize: 'var(--text-sm)' }}>{err}</p>}
          </div>
        )}
      </div>

      <HashChain anchors={anchorData?.anchors ?? []} inclusionProof={anchorData?.inclusionProof ?? null} />
    </div>
  );
}
