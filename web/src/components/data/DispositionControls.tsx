import { useState } from 'react';
import { useDisposition } from '../../api/hooks';
import type { ExceptionDTO, DispositionState, ReasonCode } from '../../api/types';

const REASON_CODES: ReasonCode[] = [
  'MAPPING_ADDED', 'RECLASSIFIED', 'DUPLICATE_CONFIRMED',
  'IMMATERIAL_WAIVED', 'PENDING_DOC', 'CARRIED_FORWARD', 'OTHER',
];

// UI intentionally omits deferred→open (no "un-defer" action offered). The backend
// disposition.ts LEGAL table is the authoritative source of truth; this is stricter.
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

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--paper-line)',
  borderRadius: 'var(--r-sm)',
  padding: 'var(--s-3)',
  display: 'grid',
  gap: 'var(--s-2)',
  background: 'var(--paper-card)',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'var(--font-mono)',
  fontSize: 14,
  padding: 'var(--s-1) var(--s-2)',
  border: '1px solid var(--paper-line)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--paper-card)',
};

type ActivePanel = 'resolve' | 'defer' | 'dismiss' | null;

function ReasonSelect({
  value,
  onChange,
}: {
  value: ReasonCode | '';
  onChange: (v: ReasonCode | '') => void;
}) {
  return (
    <label style={{ fontSize: 13, color: 'var(--ink-soft)', display: 'grid', gap: 'var(--s-1)' }}>
      Reason (required)
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ReasonCode | '')}
        style={selectStyle}
      >
        <option value="">— choose —</option>
        {REASON_CODES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

export function DispositionControls({
  exception,
  entityId,
}: {
  exception: ExceptionDTO;
  entityId: string;
}) {
  const dispose = useDisposition(entityId);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
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

  function togglePanel(panel: ActivePanel) {
    if (activePanel === panel) {
      setActivePanel(null);
    } else {
      setActivePanel(panel);
      setReasonCode('');
      setNote('');
    }
  }

  function submitAction(state: DispositionState) {
    if (!reasonCode) return;
    dispose.mutate({
      exceptionId: exception.exceptionId,
      state,
      reasonCode,
      reasonNote: note || undefined,
    });
  }

  const noteInput = reasonCode === 'OTHER' ? (
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
  ) : null;

  const canConfirm = !!reasonCode && (reasonCode !== 'OTHER' || !!note);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        {valid.includes('resolved') && (
          <button
            className="btn-primary"
            disabled={dispose.isPending}
            aria-expanded={activePanel === 'resolve'}
            onClick={() => togglePanel('resolve')}
          >
            Resolve
          </button>
        )}
        {valid.includes('deferred') && (
          <button
            style={ghostStyle}
            disabled={dispose.isPending}
            aria-expanded={activePanel === 'defer'}
            onClick={() => togglePanel('defer')}
          >
            Defer
          </button>
        )}
        {valid.includes('dismissed') && (
          <button
            style={ghostStyle}
            disabled={dispose.isPending}
            aria-expanded={activePanel === 'dismiss'}
            onClick={() => togglePanel('dismiss')}
          >
            Dismiss…
          </button>
        )}
      </div>

      {activePanel === 'resolve' && (
        <div style={panelStyle}>
          <ReasonSelect value={reasonCode} onChange={setReasonCode} />
          {noteInput}
          <button
            className="btn-primary"
            disabled={!canConfirm || dispose.isPending}
            onClick={() => submitAction('resolved')}
          >
            Confirm Resolve
          </button>
        </div>
      )}

      {activePanel === 'defer' && (
        <div style={panelStyle}>
          <ReasonSelect value={reasonCode} onChange={setReasonCode} />
          {noteInput}
          <button
            style={ghostStyle}
            disabled={!canConfirm || dispose.isPending}
            onClick={() => submitAction('deferred')}
          >
            Confirm Defer
          </button>
        </div>
      )}

      {activePanel === 'dismiss' && (
        <div style={panelStyle}>
          <ReasonSelect value={reasonCode} onChange={setReasonCode} />
          {noteInput}
          <p
            className="mono"
            style={{ fontSize: 11, color: 'var(--ink-soft)', margin: 0 }}
          >
            will record: demo-controller · {new Date().toISOString().slice(0, 10)}
          </p>
          <button
            className="btn-primary"
            disabled={!canConfirm || dispose.isPending}
            onClick={() => submitAction('dismissed')}
          >
            Dismiss this exception
          </button>
        </div>
      )}
    </div>
  );
}
