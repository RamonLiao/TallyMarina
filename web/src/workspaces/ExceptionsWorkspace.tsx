import { useState } from 'react';
import { useEntityCtx } from '../app/EntityContext';
import { useExceptions } from '../api/hooks';
import { ExceptionList } from '../components/data/ExceptionList';
import { ExceptionDetail } from '../components/data/ExceptionDetail';
import { EmptyState } from '../components/chrome/EmptyState';

export function ExceptionsWorkspace() {
  const { entity } = useEntityCtx();
  const { data } = useExceptions(entity?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const exceptions = data?.exceptions ?? [];
  const selected = exceptions.find((e) => e.exceptionId === selectedId) ?? null;

  if (exceptions.length === 0) return <EmptyState variant="clear-seas" />;

  return (
    <div
      className={`exceptions-layout${selectedId ? ' has-selection' : ''}`}
      style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'flex-start' }}
    >
      <div
        className="card exceptions-list-pane"
        style={{ flex: '0 0 320px', padding: 0, overflow: 'hidden' }}
      >
        <div style={{ padding: 'var(--s-3)', fontSize: 'var(--text-sm)' }}>
          {data?.summary.open ?? 0} open · {data?.summary.blocking ?? 0} blocking close
        </div>
        <ExceptionList
          exceptions={exceptions}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="exceptions-detail-pane" style={{ flex: '1 1 360px' }}>
        {/* Back affordance — visible only on narrow viewports via CSS */}
        {selected && (
          <button
            className="exceptions-back-btn"
            onClick={() => setSelectedId(null)}
            style={{
              marginBottom: 'var(--s-3)',
              background: 'none',
              border: 'none',
              color: 'var(--brass)',
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              padding: '4px 0',
            }}
          >
            ‹ Queue · {exceptions.filter((e) => e.disposition?.state !== 'dismissed' && e.disposition?.state !== 'resolved').length} left
          </button>
        )}
        {selected ? (
          <ExceptionDetail exception={selected} entityId={entity!.id} />
        ) : (
          <EmptyState variant="pick-one" />
        )}
      </div>
    </div>
  );
}
