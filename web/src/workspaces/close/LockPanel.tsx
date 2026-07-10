// web/src/workspaces/close/LockPanel.tsx
import { useState } from 'react';
import type { CloseCockpitResponse } from '../../api/types';
import { API_BASE } from '../../api/client';
import './close.css';

export function LockPanel({ data, entityId, periodId, onChanged }: { data: CloseCockpitResponse; entityId: string; periodId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const blockers = data.lights.filter((l) => l.status === 'red').map((l) => l.key);
  const canLock = data.closeable && data.status === 'OPEN';

  const lock = async () => {
    setBusy(true); setErr(undefined);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/period/lock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ periodId }),
      });
      if (!res.ok) throw new Error(`lock ${res.status}`);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-panel">
      <button type="button" className="btn-primary" disabled={!canLock || busy} onClick={lock}>
        {data.status === 'LOCKED' ? 'Period locked' : 'Lock the period'}
      </button>
      {!canLock && data.status === 'OPEN' && (
        <p role="status" className="lock-blockers"><span aria-hidden="true" className="lock-blockers__icon">⚠</span>Locked out by: {blockers.join(', ') || '—'}</p>
      )}
      {err && <p className="lock-err" role="alert">{err}</p>}
    </div>
  );
}
