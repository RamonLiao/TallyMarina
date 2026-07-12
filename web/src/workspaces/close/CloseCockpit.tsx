// web/src/workspaces/close/CloseCockpit.tsx
import { useState } from 'react';
import { useCloseCockpit } from '../../data/useCloseCockpit';
import { useWorkspace } from '../../app/WorkspaceContext';
import { useEntityCtx } from '../../app/EntityContext';
import { isWorkspaceId } from '../../app/workspaces';
import { LightCard } from './LightCard';
import { sortLights, dispatchTarget, isBlocking } from './lightMeta';
import { LockPanel } from './LockPanel';
import { ReopenDialog } from './ReopenDialog';
import './close.css';

export function CloseCockpit({ entityId }: { entityId: string }) {
  const { setWorkspace } = useWorkspace();
  const { setStep, periodId } = useEntityCtx();
  const { data, loading, refetch } = useCloseCockpit(entityId, periodId);
  const [reopenOpen, setReopenOpen] = useState(false);

  if (loading && !data) return <p>Loading close cockpit…</p>;
  if (!data) return <p>No cockpit data.</p>;

  // red OR stale blocks close (spec D12/D13) — semantics live in lightMeta.isBlocking,
  // shared with LockPanel's blockers filter so the two can't drift.
  const blocking = data.lights.filter((l) => isBlocking(l.status)).length;
  const verdict = data.closeable
    ? 'All controls ready to lock.'
    : `${blocking} light${blocking === 1 ? '' : 's'} blocking close.`;

  const onDispatch = (key: string) => {
    const target = dispatchTarget(key);
    if (!target) return;
    if (isWorkspaceId(target)) setWorkspace(target);
    else setStep(target);
  };

  return (
    <div className="close-cockpit">
      <div className={`period-ribbon${data.status === 'LOCKED' ? ' period-ribbon--locked' : ''}`}>
        <span className={`status-chip status-chip--${data.status.toLowerCase()}`}>{data.status}</span>
        {data.reopenCount > 0 && <span className="reopen-badge">reopened ×{data.reopenCount}</span>}
        {data.anchorStaleness?.stale && (
          <span className="stale-anchor-chip" role="alert">
            ⚠ Books changed since anchor (v{data.anchorStaleness.anchoredSeq})
          </span>
        )}
      </div>
      <p role="status" aria-live="polite" className="cockpit-verdict">{verdict}</p>
      <div className="lights-grid">
        {sortLights(data.lights).map((l) => (
          <LightCard key={l.key} light={l} onDispatch={onDispatch} />
        ))}
      </div>
      <LockPanel data={data} entityId={entityId} periodId={periodId} onChanged={refetch} />
      {data.status === 'LOCKED' && (
        <button type="button" onClick={() => setReopenOpen(true)}>Reopen…</button>
      )}
      {reopenOpen && (
        <ReopenDialog entityId={entityId} periodId={periodId} onChanged={refetch} onClose={() => setReopenOpen(false)} />
      )}
    </div>
  );
}
