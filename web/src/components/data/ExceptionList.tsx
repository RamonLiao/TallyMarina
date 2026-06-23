import type { ExceptionDTO, ExceptionCategory } from '../../api/types';

const CAT_META: Record<ExceptionCategory, { glyph: string; label: string }> = {
  RULES_FAILED: { glyph: '⛓', label: 'Rule failed' },
  CLASSIFY_REVIEW: { glyph: '⑂', label: 'Classify review' },
  LOW_CONFIDENCE_AUTO: { glyph: '◌', label: 'Low confidence' },
};

function Row({ e, selected, onSelect }: { e: ExceptionDTO; selected: boolean; onSelect(id: string): void }) {
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
        borderLeft: blocker ? '3px solid var(--brass)' : '3px solid transparent',
        background: selected ? 'var(--paper-card)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--paper-line)',
        cursor: 'pointer',
      }}
    >
      <span aria-hidden style={{ fontSize: 18 }}>{m.glyph}</span>
      <span>
        <span style={{ fontSize: 12, fontWeight: blocker ? 700 : 500, color: 'var(--ink)' }}>{m.label}</span>
        <span
          className="mono"
          style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}
        >
          {e.eventId}
        </span>
      </span>
      <span className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
        {e.disposition ? e.disposition.state : 'open'}
      </span>
    </button>
  );
}

export function ExceptionList({
  exceptions,
  selectedId,
  onSelect,
}: {
  exceptions: ExceptionDTO[];
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const blockers = exceptions.filter((e) => e.severity >= 2);
  const rest = exceptions.filter((e) => e.severity < 2);

  const section = (label: string, items: ExceptionDTO[]) =>
    items.length === 0 ? null : (
      <div key={label}>
        <div
          style={{
            padding: 'var(--s-2) var(--s-3)',
            fontSize: 11,
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
