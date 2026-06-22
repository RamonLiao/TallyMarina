import { useEntityCtx } from '../app/EntityContext';
import { useJournal, useRunRules } from '../api/hooks';
import { JournalTable } from '../components/data/JournalTable';

export function JournalStep() {
  const { entity, periodId, goNext } = useEntityCtx();
  const { data: journal } = useJournal(entity?.id);
  const runRules = useRunRules(entity?.id ?? '');

  const hasJournal = (journal ?? []).length > 0;

  return (
    <div className="card" style={{ padding: 'var(--s-6)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--s-4)',
        }}
      >
        <h2 style={{ margin: 0 }}>Journal</h2>
        {!hasJournal && (
          <button
            className="btn-primary"
            disabled={runRules.isPending}
            onClick={() => runRules.mutate(periodId)}
          >
            {runRules.isPending ? 'Posting…' : 'Run rules → post journal'}
          </button>
        )}
      </div>

      {runRules.isSuccess && (
        <p className="mono" style={{ fontSize: 15 }}>
          Posted {runRules.data.posted} · skipped {runRules.data.skipped}
        </p>
      )}

      {hasJournal ? (
        <JournalTable journal={journal!} />
      ) : (
        <p className="font-body" style={{ color: 'var(--ink-soft)' }}>
          No journal yet — run the deterministic rules engine.
        </p>
      )}

      {hasJournal && (
        <div style={{ marginTop: 'var(--s-6)', textAlign: 'right' }}>
          <button className="btn-primary" onClick={() => goNext()}>
            Snapshot &amp; anchor →
          </button>
        </div>
      )}
    </div>
  );
}
