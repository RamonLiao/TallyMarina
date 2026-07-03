import { useState } from 'react';
import type { ProposalDTO, ExceptionDTO } from '../../api/types';
import { useAcceptProposal, useRejectProposal } from '../../api/hooks';

export function AgentProposalCard({ proposal, exception, entityId }: {
  proposal: ProposalDTO; exception: ExceptionDTO; entityId: string;
}) {
  const accept = useAcceptProposal(entityId);
  const reject = useRejectProposal(entityId);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');

  const terminal = exception.disposition?.state === 'resolved' || exception.disposition?.state === 'dismissed';
  if (exception.anchoredReadOnly || terminal || proposal.status !== 'proposed') return null;

  const pending = accept.isPending || reject.isPending;
  const err = (accept.error ?? reject.error) as Error | null;

  return (
    <div style={{
      border: '1px dashed color-mix(in srgb, var(--brass) 45%, transparent)',
      borderRadius: 'var(--r-sm)', padding: 'var(--s-4)', background: 'var(--paper-card)',
      display: 'grid', gap: 'var(--s-3)',
    }}>
      <span style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--brass)', fontWeight: 700 }}>
        Agent proposal · not applied
      </span>
      <p className="mono" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
        {proposal.action} · {proposal.reasonCode}
        {proposal.reasonNote ? <span style={{ color: 'var(--ink-soft)' }}> — {proposal.reasonNote}</span> : null}
      </p>
      <p className="mono" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-soft)' }}>
        confidence {proposal.confidence.toFixed(2)}
      </p>
      <div className="font-body" style={{ maxHeight: 220, overflowY: 'auto', fontSize: 'var(--text-sm)' }}>
        {proposal.rationale}
      </div>
      {proposal.action === 'dismissed' && (
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--debit)', fontWeight: 600 }}>
          Accepting dismisses a close-blocking exception; this transaction will NOT post.
        </p>
      )}
      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
        <button className="btn-primary" disabled={pending} onClick={() => accept.mutate(proposal.id)}>
          Accept — {proposal.action} as {proposal.reasonCode}
        </button>
        <button disabled={pending} onClick={() => setRejecting((v) => !v)} style={{
          background: 'none', border: '1px solid var(--paper-line)', borderRadius: 'var(--radius-pill)',
          padding: 'var(--s-2) var(--s-4)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
        }}>
          Reject…
        </button>
      </div>
      {rejecting && (
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <input className="mono" placeholder="Why? (optional — trains the agent)" value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', padding: 'var(--s-1) var(--s-2)', border: '1px solid var(--paper-line)', borderRadius: 'var(--r-sm)', background: 'var(--paper-card)' }} />
          <button disabled={pending}
            onClick={() => reject.mutate({ proposalId: proposal.id, note: note || undefined })}
            style={{ background: 'none', border: '1px solid var(--paper-line)', borderRadius: 'var(--radius-pill)', padding: 'var(--s-2) var(--s-4)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', justifySelf: 'start' }}>
            Confirm Reject
          </button>
        </div>
      )}
      {err && <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--debit)' }}>{err.message}</p>}
    </div>
  );
}
