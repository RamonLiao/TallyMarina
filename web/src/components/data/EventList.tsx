// DATA ZONE (spec §8.4) — NEVER import Mascot here.
import type { EventDTO, EventStatus } from '../../api/types';

const STATUS_GLYPH: Record<string, string> = {
  INGESTED: '◌', AUTO: '⑂', NEEDS_REVIEW: '⑂', APPROVED: '✓', POSTED: '⛓',
};

// brass rail = "this event is in the compare basket" (repurposed blocker idiom).
function Row({
  e, selected, inCompare, onSelect, onToggleCompare,
}: {
  e: EventDTO; selected: boolean; inCompare: boolean;
  onSelect(id: string): void; onToggleCompare(id: string): void;
}) {
  const pending = e.ai === null; // not yet classified
  const type = e.final?.eventType ?? e.ai?.eventType ?? '—';
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: 'auto auto 1fr auto', gap: 'var(--s-3)',
        alignItems: 'center', padding: 'var(--s-3)',
        borderLeft: inCompare ? '3px solid var(--brass)' : '3px solid transparent',
        borderBottom: '1px solid var(--paper-line)',
        background: selected ? 'var(--paper-card)' : 'transparent',
      }}
    >
      <input
        type="checkbox"
        aria-label={`Compare ${e.id}`}
        checked={inCompare}
        onChange={() => onToggleCompare(e.id)}
        style={{ cursor: 'pointer' }}
      />
      <span aria-hidden style={{ fontSize: 16 /* icon */, color: pending ? 'var(--ink-soft)' : 'var(--ink)' }}>
        {STATUS_GLYPH[e.status] ?? '◌'}
      </span>
      <button
        onClick={() => onSelect(e.id)}
        aria-current={selected ? 'true' : undefined}
        style={{ display: 'block', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
      >
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: selected ? 700 : 500, color: 'var(--ink)' }}>{type}</span>
        <span className="mono" style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-soft)' }}>{e.id}</span>
      </button>
      <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-soft)' }}>
        {pending ? 'pending' : e.status.toLowerCase()}
      </span>
    </div>
  );
}

const FILTERS: (EventStatus | 'ALL')[] = ['ALL', 'INGESTED', 'NEEDS_REVIEW', 'AUTO', 'APPROVED', 'POSTED'];

export function EventList({
  events, selectedId, compareIds, onSelect, onToggleCompare, statusFilter, onStatusFilter,
}: {
  events: EventDTO[];
  selectedId: string | null;
  compareIds: string[];
  onSelect(id: string): void;
  onToggleCompare(id: string): void;
  statusFilter: EventStatus | 'ALL';
  onStatusFilter(s: EventStatus | 'ALL'): void;
}) {
  const shown = statusFilter === 'ALL' ? events : events.filter((e) => e.status === statusFilter);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)', padding: 'var(--s-3)' }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            aria-pressed={statusFilter === f}
            onClick={() => onStatusFilter(f)}
            style={{
              fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: '999px',
              border: '1px solid var(--paper-line)', cursor: 'pointer',
              background: statusFilter === f ? 'var(--brass-fill)' : 'transparent',
              color: 'var(--ink)', fontWeight: statusFilter === f ? 600 : 400,
            }}
          >
            {f === 'ALL' ? 'All' : f.toLowerCase()}
          </button>
        ))}
      </div>
      {shown.map((e) => (
        <Row
          key={e.id} e={e}
          selected={e.id === selectedId}
          inCompare={compareIds.includes(e.id)}
          onSelect={onSelect} onToggleCompare={onToggleCompare}
        />
      ))}
    </div>
  );
}
