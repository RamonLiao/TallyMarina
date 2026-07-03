// DATA ZONE (spec §8.4). No mascot. Human decides — AI only pre-fills the draft.
import { useState } from 'react';
import type { EventDTO } from '../../api/types';

const ghostStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--paper-line)',
  borderRadius: 'var(--radius-pill)',
  padding: 'var(--s-2) var(--s-4)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
};

export function DecideForm({
  event, draft, onDecide, pending, demoted,
}: {
  event: EventDTO;
  /** AI suggestedEntry lines for pre-fill. Adopt only populates the form — AI has NO posting authority. */
  draft?: { eventType?: string; purpose?: string } | null;
  onDecide(finalEventType: string, finalPurpose: string): void;
  pending: boolean;
  /** When true (a live agent proposal is the primary CTA), drop btn-primary from Approve. */
  demoted?: boolean;
}) {
  const [eventType, setEventType] = useState(event.ai?.eventType ?? '');
  const [purpose, setPurpose] = useState(event.ai?.purpose ?? '');

  const input: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)', padding: 'var(--s-2) var(--s-3)',
    border: '1px solid var(--paper-line)', borderRadius: 'var(--r-sm)', background: 'var(--paper-card)',
    width: '100%', boxSizing: 'border-box',
  };

  function adoptDraft() {
    if (draft?.eventType) setEventType(draft.eventType);
    if (draft?.purpose) setPurpose(draft.purpose);
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onDecide(eventType, purpose); }}
      style={{ display: 'grid', gap: 'var(--s-3)', maxWidth: 420 }}
    >
      <label style={{ display: 'grid', gap: 'var(--s-1)', fontSize: 'var(--text-sm)', color: 'var(--ink-soft)' }}>
        Final event type
        <input style={input} value={eventType} onChange={(e) => setEventType(e.target.value)} required />
      </label>
      <label style={{ display: 'grid', gap: 'var(--s-1)', fontSize: 'var(--text-sm)', color: 'var(--ink-soft)' }}>
        Final purpose
        <input style={input} value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
      </label>
      {draft && (
        <button
          type="button"
          onClick={adoptDraft}
          style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
        >
          ↓ Adopt AI draft (pre-fills form only — you decide)
        </button>
      )}
      <button
        className={demoted ? undefined : 'btn-primary'}
        style={demoted ? ghostStyle : undefined}
        type="submit"
        disabled={pending || !eventType || !purpose}
      >
        {pending ? 'Approving…' : 'Approve'}
      </button>
    </form>
  );
}
