import { useEffect, useMemo, useState } from 'react';
import { useReconciliation } from '../data/useReconciliation';
import { useJournal, useEvents } from '../api/hooks';
import { recomputeMovements } from '../lib/reconMovements';
import { ReconTable } from './recon/ReconTable';
import { ReconDetail } from './recon/ReconDetail';
import { EmptyState } from '../components/chrome/EmptyState';
import './recon/recon.css';

export function ReconciliationWorkspace({ entityId }: { entityId: string }) {
  const { data, loading, error, refetch } = useReconciliation(entityId);
  const { data: journal = [] } = useJournal(entityId);
  const { data: events = [] } = useEvents(entityId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Reset selection on entity switch (selection-leak guard).
  useEffect(() => { setSelectedKey(null); }, [entityId]);

  const clientMovements = useMemo(() => {
    if (!journal.length || !events.length) return {};
    try {
      return recomputeMovements(journal, events);
    } catch {
      // Integrity gap — return empty so drift check fires on every row
      return {};
    }
  }, [journal, events]);

  if (loading) return <div className="recon-loading">Loading reconciliation…</div>;
  if (error) return <div className="recon-err" role="alert">Failed to load reconciliation: {error}</div>;
  if (!data) return null;

  const allBalanced = data.rows.length === 0 || data.rows.every((r) => BigInt(r.breakMinor) === 0n);
  if (allBalanced) {
    return (
      <EmptyState
        variant="clear-seas"
        title="Books balanced ⚖"
        body="All accounts reconciled — books tie to statements ⚖"
      />
    );
  }

  const selected = selectedKey ? data.rows.find((r) => `${r.wallet}|${r.coinType}` === selectedKey) ?? null : null;
  const anchored = false; // single-period demo: wire to useAnchors(entityId).length>0 if/when available.

  return (
    <div className={`recon-workspace${selected ? ' has-selection' : ''}`}>
      <header className="recon-summary">
        {data.summary.openMaterial > 0
          ? <span className="brk--material">material breaks: {data.summary.openMaterial}</span>
          : <span>all reconciled</span>}
      </header>
      <ReconTable rows={data.rows} selectedKey={selectedKey} onSelect={setSelectedKey} clientMovements={clientMovements} />
      {selected && (
        <>
          <button className="exceptions-back-btn" onClick={() => setSelectedKey(null)}>‹ Accounts · {data.rows.length}</button>
          <ReconDetail row={selected} realWallet={data.realWallet} anchored={anchored} onDisposed={refetch} clientMovements={clientMovements} />
        </>
      )}
    </div>
  );
}
