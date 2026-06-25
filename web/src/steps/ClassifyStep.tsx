import { useEntityCtx } from '../app/EntityContext';
import { useEvents, useClassify } from '../api/hooks';
import { ConfidenceBar } from '../components/data/ConfidenceBar';
import { CLASSIFY_THRESHOLD } from '../lib/constants';

export function ClassifyStep() {
  const { entity, goNext } = useEntityCtx();
  const { data: events } = useEvents(entity?.id);
  const classify = useClassify(entity?.id ?? '');

  const unclassified = (events ?? []).filter((e) => e.status === 'INGESTED');
  const allDone = (events ?? []).length > 0 && unclassified.length === 0;

  async function classifyAll() {
    for (const e of unclassified) {
      await classify.mutateAsync(e.id); // never errors (endpoint 4 degrades)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--s-6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-4)' }}>
        <h2 style={{ margin: 0 }}>Classify</h2>
        <button className="btn-primary" disabled={classify.isPending || allDone} onClick={classifyAll}>
          {classify.isPending ? 'Classifying…' : allDone ? 'All classified' : 'Classify all'}
        </button>
      </div>

      <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
        {(events ?? []).map((e) => (
          <div
            key={e.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 'var(--s-4)', padding: 'var(--s-3) 0', borderTop: '1px solid var(--paper-line)', minHeight: 44,
            }}
          >
            <div>
              <span className="mono" style={{ fontSize: 'var(--text-base)' }}>{e.id}</span>
              {/* Safe normalized field access — carry from Task 7 */}
              <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', marginLeft: 'var(--s-3)' }}>
                {String(e.normalized?.eventTime ?? '—')}
              </span>
              {(e.normalized?.amount != null || e.normalized?.coinType != null) && (
                <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', marginLeft: 'var(--s-3)' }}>
                  {String(e.normalized?.amount ?? '—')} {String(e.normalized?.coinType ?? '—')}
                </span>
              )}
              {e.ai && (
                <span className="font-body" style={{ color: 'var(--ink-soft)', marginLeft: 'var(--s-3)' }}>
                  {e.ai.eventType} · {e.ai.purpose}
                </span>
              )}
            </div>
            <ConfidenceBar confidence={e.ai?.confidence ?? null} threshold={CLASSIFY_THRESHOLD} />
          </div>
        ))}
      </div>

      {allDone && (
        <div style={{ marginTop: 'var(--s-6)', textAlign: 'right' }}>
          <button className="btn-primary" onClick={() => goNext()}>Go to review →</button>
        </div>
      )}
    </div>
  );
}
