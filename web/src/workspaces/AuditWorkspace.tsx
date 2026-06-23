// DATA ZONE (spec §8.4) — NEVER import Mascot here (right pane is all data surfaces).
import { useState } from 'react';
import { useEntityCtx } from '../app/EntityContext';
import { useEvents, useJournal } from '../api/hooks';
import { EventList } from '../components/data/EventList';
import { EmptyState } from '../components/chrome/EmptyState';
import { EventLineage } from '../components/data/EventLineage';
import { EventCompare } from '../components/data/EventCompare';
import { deriveMode, lineageTarget } from '../lib/auditSelection';
import type { EventStatus } from '../api/types';

export function AuditWorkspace() {
  const { entity } = useEntityCtx();
  const { data: events } = useEvents(entity?.id);
  const { data: journal } = useJournal(entity?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'ALL'>('ALL');

  const list = events ?? [];
  if (list.length === 0) return <EmptyState variant="clear-seas" />;

  const mode = deriveMode({ selectedId, compareIds });
  const toggleCompare = (id: string) =>
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const targetId = lineageTarget({ selectedId, compareIds });
  const target = list.find((e) => e.id === targetId) ?? null;
  const hasSel = mode !== 'pick';

  return (
    <div
      className={`exceptions-layout${hasSel ? ' has-selection' : ''}`}
      style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'flex-start' }}
    >
      <div className="card exceptions-list-pane" style={{ flex: '0 0 320px', padding: 0, overflow: 'hidden' }}>
        <EventList
          events={list}
          selectedId={selectedId}
          compareIds={compareIds}
          onSelect={(id) => { setSelectedId(id); setCompareIds([]); }}
          onToggleCompare={toggleCompare}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
        />
      </div>
      <div className="exceptions-detail-pane" style={{ flex: '1 1 360px', minWidth: 0 }}>
        {hasSel && (
          <button
            className="exceptions-back-btn"
            onClick={() => { setSelectedId(null); setCompareIds([]); }}
            style={{ marginBottom: 'var(--s-3)', background: 'none', border: 'none', color: 'var(--brass)', fontWeight: 600, fontSize: 14, cursor: 'pointer', padding: '4px 0' }}
          >
            ‹ Events · {list.length}
          </button>
        )}
        {mode === 'pick' && <EmptyState variant="pick-one" />}
        {mode === 'lineage' && target && (
          <EventLineage event={target} entityId={entity!.id} journal={journal ?? []} />
        )}
        {mode === 'compare' && (
          <EventCompare
            events={list.filter((e) => compareIds.includes(e.id))}
            journal={journal ?? []}
            onOpenLineage={(id) => { setCompareIds([]); setSelectedId(id); }}
          />
        )}
      </div>
    </div>
  );
}
