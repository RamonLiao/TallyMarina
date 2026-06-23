import { useState } from 'react';
import { useDisposition } from '../../api/hooks';
import type { ExceptionDTO, DispositionState, ReasonCode } from '../../api/types';

const REASON_CODES: ReasonCode[] = [
  'MAPPING_ADDED', 'RECLASSIFIED', 'DUPLICATE_CONFIRMED',
  'IMMATERIAL_WAIVED', 'PENDING_DOC', 'CARRIED_FORWARD', 'OTHER',
];

const LEGAL: Record<DispositionState, DispositionState[]> = {
  open: ['resolved', 'deferred', 'dismissed'],
  deferred: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};

const ghostStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--paper-line)',
  borderRadius: 'var(--radius-pill)',
  padding: 'var(--s-2) var(--s-4)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 14,
};

export function DispositionControls({
  exception,
  entityId,
}: {
  exception: ExceptionDTO;
  entityId: string;
}) {
  const dispose = useDisposition(entityId);
  const [dismissing, setDismissing] = useState(false);
  const [reasonCode, setReasonCode] = useState<ReasonCode | ''>('');
  const [note, setNote] = useState('');

  const cur: DispositionState = exception.disposition?.state ?? 'open';

  if (exception.anchoredReadOnly) {
    return (
      <p className="font-body" style={{ color: 'var(--ink-soft)', fontSize: 13, margin: 0 }}>
        ⚓ Period anchored — exceptions are informational (read-only).
      </p>
    );
  }

  const valid = LEGAL[cur];
  if (valid.length === 0) {
    return (
      <p className="font-body" style={{ color: 'var(--ink-soft)', fontSize: 13, margin: 0 }}>
        Disposition: <b>{cur}</b> (terminal — no further actions).
      </p>
    );
  }

  const submitDirect = (state: DispositionState, code: ReasonCode) =>
    dispose.mutate({ exceptionId: exception.exceptionId, state, reasonCode: code });

  const submitDismiss = () => {
    if (!reasonCode) return;
    dispose.mutate({
      exceptionId: exception.exceptionId,
      state: 'dismissed',
      reasonCode,
      reasonNote: note || undefined,
    });
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        {valid.includes('resolved') && (
          <button
            className="btn-primary"
            disabled={dispose.isPending}
            onClick={() => submitDirect('resolved', 'RECLASSIFIED')}
          >
            Resolve
          </button>
        )}
        {valid.includes('deferred') && (
          <button
            style={ghostStyle}
            disabled={dispose.isPending}
            onClick={() => submitDirect('deferred', 'CARRIED_FORWARD')}
          >
            Defer
          </button>
        )}
        {valid.includes('dismissed') && (
          <button
            style={ghostStyle}
            onClick={() => { setDismissing((v) => !v); setReasonCode(''); setNote(''); }}
          >
            Dismiss…
          </button>
        )}
      </div>

      {dismissing && (
        <div
          style={{
            border: '1px solid var(--paper-line)',
            borderRadius: 'var(--r-sm)',
            padding: 'var(--s-3)',
            display: 'grid',
            gap: 'var(--s-2)',
            background: 'var(--paper-card)',
          }}
        >
          <label style={{ fontSize: 13, color: 'var(--ink-soft)', display: 'grid', gap: 'var(--s-1)' }}>
            Reason (required)
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as ReasonCode)}
              style={{
                width: '100%',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                padding: 'var(--s-1) var(--s-2)',
                border: '1px solid var(--paper-line)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--paper-card)',
              }}
            >
              <option value="">— choose —</option>
              {REASON_CODES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          {reasonCode === 'OTHER' && (
            <input
              className="mono"
              placeholder="Describe reason…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                padding: 'var(--s-1) var(--s-2)',
                border: '1px solid var(--paper-line)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--paper-card)',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          )}

          <p
            className="mono"
            style={{ fontSize: 11, color: 'var(--ink-soft)', margin: 0 }}
          >
            will record: demo-controller · {new Date().toISOString().slice(0, 10)}
          </p>

          <button
            className="btn-primary"
            disabled={!reasonCode || (reasonCode === 'OTHER' && !note) || dispose.isPending}
            onClick={submitDismiss}
          >
            Dismiss this exception
          </button>
        </div>
      )}
    </div>
  );
}
