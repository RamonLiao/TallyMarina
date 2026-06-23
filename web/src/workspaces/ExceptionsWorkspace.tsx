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
      className="exceptions-layout"
      style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'flex-start' }}
    >
      <div className="card" style={{ flex: '0 0 320px', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 'var(--s-3)', fontSize: 13 }}>
          {data?.summary.open ?? 0} open · {data?.summary.blocking ?? 0} blocking close
        </div>
        <ExceptionList
          exceptions={exceptions}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div style={{ flex: '1 1 360px' }}>
        {selected ? (
          <ExceptionDetail exception={selected} entityId={entity!.id} />
        ) : (
          <EmptyState variant="pick-one" />
        )}
      </div>
    </div>
  );
}
