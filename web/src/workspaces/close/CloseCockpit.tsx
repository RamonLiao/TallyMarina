// web/src/workspaces/close/CloseCockpit.tsx
import { useCloseCockpit } from '../../data/useCloseCockpit';
import { useWorkspace } from '../../app/WorkspaceContext';
import { useEntityCtx } from '../../app/EntityContext';
import { isWorkspaceId } from '../../app/workspaces';
import { LightCard } from './LightCard';
import { sortLights, dispatchTarget } from './lightMeta';
import './close.css';

export function CloseCockpit({ entityId }: { entityId: string }) {
  const { data, loading } = useCloseCockpit(entityId);
  const { setWorkspace } = useWorkspace();
  const { setStep } = useEntityCtx();

  if (loading && !data) return <p>Loading close cockpit…</p>;
  if (!data) return <p>No cockpit data.</p>;

  const blockingReds = data.lights.filter((l) => l.status === 'red').length;
  const verdict = data.closeable
    ? 'All controls ready to lock.'
    : `${blockingReds} light${blockingReds === 1 ? '' : 's'} blocking close.`;

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
        {data.staleAnchor && (
          <span className="stale-anchor-warn" role="alert">⚠ stale anchor — re-lock & re-anchor</span>
        )}
      </div>
      <p role="status" aria-live="polite" className="cockpit-verdict">{verdict}</p>
      <div className="lights-grid">
        {sortLights(data.lights).map((l) => (
          <LightCard key={l.key} light={l} onDispatch={onDispatch} />
        ))}
      </div>
    </div>
  );
}
