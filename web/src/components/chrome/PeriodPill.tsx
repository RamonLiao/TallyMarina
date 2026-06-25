import { useEntityCtx } from '../../app/EntityContext';

export function PeriodPill() {
  const { periodId } = useEntityCtx();
  return (
    <span
      aria-label="Accounting period"
      style={{
        background: 'rgba(255,255,255,0.08)',
        color: 'var(--paper)',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 'var(--radius-pill)',
        padding: 'var(--space-1) var(--space-3)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
      }}
    >
      {periodId}
    </span>
  );
}
