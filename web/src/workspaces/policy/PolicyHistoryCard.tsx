import { useEffect, useState } from 'react';
import type { ChangeRowDTO } from '../../api/types';
import { getPolicyHistory } from '../../api/endpoints';
import './policy.css';

export function PolicyHistoryCard({ entityId }: { entityId: string }) {
  const [changes, setChanges] = useState<ChangeRowDTO[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setChanges(undefined);
    setError(undefined);
    getPolicyHistory(entityId)
      .then((h) => { if (!cancelled) setChanges(h.changes); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [entityId]);

  const sorted = changes ? [...changes].sort((a, b) => b.seq - a.seq) : undefined;

  return (
    <section className="card policy-history">
      <h3 className="policy-card-title">Change history</h3>
      {error && <p className="policy-bad">history unavailable: {error}</p>}
      {!error && !sorted && <p>Loading history…</p>}
      {sorted && sorted.length === 0 && <p>No changes yet.</p>}
      {sorted && sorted.length > 0 && (
        <ul className="policy-history-list">
          {sorted.map((c) => (
            <li key={c.seq} className="policy-history-row">
              <div className="mono">{c.at} · {c.actor} · {c.objectType} · {c.reason}</div>
              <details>
                <summary>diff</summary>
                <pre className="policy-history-diff">before: {c.before ?? 'null'}</pre>
                <pre className="policy-history-diff">after: {c.after}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
