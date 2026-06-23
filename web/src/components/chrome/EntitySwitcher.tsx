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
        // Drop the native chevron and paint our own (paper-tinted) so the
        // control matches the dark TopBar instead of the OS default arrow.
        appearance: 'none',
        WebkitAppearance: 'none',
        backgroundColor: 'rgba(255,255,255,0.08)',
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23F4ECD8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right var(--space-2) center',
        color: 'var(--paper)',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 'var(--radius-pill)',
        padding: 'var(--space-1) calc(var(--space-3) + 16px) var(--space-1) var(--space-3)',
        fontFamily: 'var(--font-display)',
        fontSize: 14,
        // Shrink before wrapping so the 768–1050px range doesn't force a doubled-height TopBar.
        minWidth: 0,
        maxWidth: 180,
        flexShrink: 1,
      }}
    >
      {entity === null && <option value="">Select entity…</option>}
      {list.map((x) => (
        <option key={x.id} value={x.id} style={{ color: 'var(--ink)' }}>{x.displayName}</option>
      ))}
    </select>
  );
}
