import { useEntities } from '../../api/hooks';
import { useEntityCtx } from '../../app/EntityContext';

export function EntitySwitcher() {
  const { data: entities, isLoading } = useEntities();
  const { entity, setEntity } = useEntityCtx();

  if (isLoading) {
    return <span className="font-body" style={{ color: 'var(--paper)', opacity: 0.7 }}>Loading…</span>;
  }
  const list = entities ?? [];
  return (
    <select
      aria-label="Entity"
      value={entity?.id ?? ''}
      onChange={(e) => {
        const next = list.find((x) => x.id === e.target.value) ?? null;
        setEntity(next);
      }}
      style={{
        background: 'rgba(255,255,255,0.08)',
        color: 'var(--paper)',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 'var(--radius-pill)',
        padding: 'var(--space-1) var(--space-3)',
        fontFamily: 'var(--font-display)',
        fontSize: 14,
      }}
    >
      {entity === null && <option value="">Select entity…</option>}
      {list.map((x) => (
        <option key={x.id} value={x.id} style={{ color: 'var(--ink)' }}>{x.displayName}</option>
      ))}
    </select>
  );
}
