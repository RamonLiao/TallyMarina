import type { ExceptionDTO, ExceptionCategory } from '../../api/types';

const CAT_META: Record<ExceptionCategory, { glyph: string; label: string }> = {
  RULES_FAILED: { glyph: '⛓', label: 'Rule failed' },
  CLASSIFY_REVIEW: { glyph: '⑂', label: 'Classify review' },
  LOW_CONFIDENCE_AUTO: { glyph: '◌', label: 'Low confidence' },
};

function Row({ e, selected, onSelect, proposalIds }: { e: ExceptionDTO; selected: boolean; onSelect(id: string): void; proposalIds?: Set<string> }) {
  const blocker = e.severity >= 2;
  const m = CAT_META[e.category];
  return (
    <button
      onClick={() => onSelect(e.exceptionId)}
      aria-current={selected ? 'true' : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 'var(--s-3)',
        width: '100%',
        textAlign: 'left',
        alignItems: 'center',
        padding: 'var(--s-3)',
        border: 'none',
        borderLeft: blocker ? '3px solid var(--brass)' : '3px solid transparent',
        borderBottom: '1px solid var(--paper-line)',
        background: selected ? 'var(--paper-card)' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <span aria-hidden style={{ fontSize: 18 /* icon */ }}>{m.glyph}</span>
      <span>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: blocker ? 700 : 500, color: 'var(--ink)' }}>{m.label}</span>
        {proposalIds?.has(e.exceptionId) && (
          <span className="mono" style={{
            marginLeft: 'var(--s-2)', fontSize: 'var(--text-xs)', padding: '1px 8px',
            borderRadius: 'var(--radius-pill)',
            background: 'color-mix(in srgb, var(--brass) 12%, transparent)', color: 'var(--brass)',
          }}>agent</span>
        )}
        <span
          className="mono"
          style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-soft)' }}
        >
          {e.eventId}
        </span>
      </span>
      <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-soft)' }}>
        {e.disposition ? e.disposition.state : 'open'}
      </span>
    </button>
  );
}

export function ExceptionList({
  exceptions,
  selectedId,
  onSelect,
  proposalIds,
}: {
  exceptions: ExceptionDTO[];
  selectedId: string | null;
  onSelect(id: string): void;
  proposalIds?: Set<string>;
}) {
  const blockers = exceptions.filter((e) => e.severity >= 2);
  const rest = exceptions.filter((e) => e.severity < 2);

  const section = (label: string, items: ExceptionDTO[]) =>
    items.length === 0 ? null : (
      <div key={label}>
        <div
          style={{
            padding: 'var(--s-2) var(--s-3)',
            fontSize: 'var(--text-xs)',
            letterSpacing: '0.08em',
            color: 'var(--ink-soft)',
            textTransform: 'uppercase',
          }}
        >
          {label} · {items.length}
        </div>
        {items.map((e) => (
          <Row
            key={e.exceptionId}
            e={e}
            selected={e.exceptionId === selectedId}
            onSelect={onSelect}
            proposalIds={proposalIds}
          />
        ))}
      </div>
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {section('Blocks close', blockers)}
      {section('Hold', rest)}
    </div>
  );
}
