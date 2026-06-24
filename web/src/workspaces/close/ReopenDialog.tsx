// web/src/workspaces/close/ReopenDialog.tsx
import { useState } from 'react';
import { REOPEN_REASON_CODES, type ReopenReasonCode } from '../../api/types';
import { API_BASE } from '../../api/client';
import './close.css';

export function ReopenDialog({ entityId, onChanged, onClose }: { entityId: string; onChanged: () => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [code, setCode] = useState<ReopenReasonCode>('ERROR_CORRECTION');
  const [amount, setAmount] = useState('');
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const reasonOk = reason.trim().length > 0;

  const approve = async () => {
    setBusy(true); setErr(undefined);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/period/reopen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restatementReason: reason.trim(), reasonCode: code, affectedAmountEstimate: amount.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`reopen ${res.status}`);
      onChanged(); onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reopen-dialog" role="dialog" aria-label="Reopen period">
      <div className="reopen-ribbon">⚠ mock-until-auth — SoD (maker≠checker) is UI-only until an identity system lands</div>
      <ol className="reopen-steps">
        <li className={requested ? 'step--done' : 'step--active'}>
          <strong>1 · Request</strong>
          <label>Reason code
            <select value={code} onChange={(e) => setCode(e.target.value as ReopenReasonCode)}>
              {REOPEN_REASON_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <textarea placeholder="Restatement reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={512} />
          {/* WHY: optional restatement magnitude is an audit-nice-to-have (ASC 250/IAS 8 disclosure);
              kept as a string (integer-minor-unit) — never coerced to a JS number. Must reach the backend
              when provided but NEVER gates the SoD ritual (optional field). */}
          <label>Affected amount estimate (optional)
            <input type="text" placeholder="e.g. 150000 (minor units)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <button type="button" disabled={!reasonOk} onClick={() => setRequested(true)}>Request reopen</button>
        </li>
        <li className={requested ? 'step--active' : 'step--idle'}>
          <strong>2 · Approve</strong>
          <button type="button" className="btn-primary" disabled={!requested || !reasonOk || busy} onClick={approve}>Approve &amp; reopen</button>
        </li>
      </ol>
      {err && <p role="alert" className="lock-err">{err}</p>}
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  );
}
