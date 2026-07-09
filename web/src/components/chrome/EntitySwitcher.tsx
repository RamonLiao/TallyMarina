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
      className="entity-switcher"
      value={entity?.id ?? ''}
      onChange={(e) => {
        const next = list.find((x) => x.id === e.target.value) ?? null;
        setEntity(next);
      }}
    >
      {entity === null && <option value="">Select entity…</option>}
      {list.map((x) => (
        <option key={x.id} value={x.id} style={{ color: 'var(--ink)' }}>{x.displayName}</option>
      ))}
    </select>
  );
}
