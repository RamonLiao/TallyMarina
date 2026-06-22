import { useEffect } from 'react';
import { useEntities, useIngest } from '../api/hooks';
import { useEntityCtx } from '../app/EntityContext';
import { EmptyState } from '../components/chrome/EmptyState';

export function IngestStep() {
  const { data: entities, isLoading } = useEntities();
  const { entity, setEntity, goNext } = useEntityCtx();

  useEffect(() => {
    if (!entity && entities && entities.length > 0) setEntity(entities[0] ?? null);
  }, [entity, entities, setEntity]);

  const ingest = useIngest(entity?.id ?? '');

  if (isLoading) return <p className="font-body">Loading entity…</p>;
  if (!entity) return <p className="font-body">No demo entity seeded.</p>;

  return (
    <EmptyState
      title={entity.displayName}
      body="Load this period's on-chain transaction fixture. The AI will read each transaction, infer its commercial purpose, and route it — high confidence auto-passes, low confidence raises a hand for review."
      cta={
        <div style={{ display: 'grid', gap: 'var(--s-3)', justifyItems: 'center' }}>
          <button
            className="btn-primary"
            disabled={ingest.isPending}
            onClick={() => ingest.mutate(undefined, { onSuccess: () => goNext() })}
          >
            {ingest.isPending ? 'Ingesting…' : 'Ingest fixture'}
          </button>
          {ingest.isSuccess && (
            <p className="mono" style={{ fontSize: 15 }}>
              Ingested {ingest.data.ingested} events →
            </p>
          )}
          {ingest.isError && (
            <p className="mono" style={{ fontSize: 14, color: 'var(--debit)' }}>
              {(ingest.error as Error).message}
            </p>
          )}
        </div>
      }
    />
  );
}
