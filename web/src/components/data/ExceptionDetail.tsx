import { useState } from 'react';
import type { ExceptionDTO, CopilotAdvice, ProposalDTO } from '../../api/types';
import { ConfidenceBar } from './ConfidenceBar';
import { CopilotDock } from '../chrome/CopilotDock';
import { DecideForm } from './DecideForm';
import { DispositionControls } from './DispositionControls';
import { AgentProposalCard } from './AgentProposalCard';
import { useCopilot, useDecide } from '../../api/hooks';

export function ExceptionDetail({
  exception,
  entityId,
  proposal,
}: {
  exception: ExceptionDTO;
  entityId: string;
  proposal?: ProposalDTO | null;
}) {
  const copilot = useCopilot();
  const decide = useDecide(entityId);
  const [advice, setAdvice] = useState<CopilotAdvice | null>(null);

  const isClassifyReview = exception.category === 'CLASSIFY_REVIEW';

  // Same gate AgentProposalCard applies internally (see AgentProposalCard.tsx) — kept in
  // sync here so the divider + DispositionControls demotion never outlive the card itself
  // (e.g. a manual disposition resolves the exception while the proposal cache is still
  // `proposed`, until triage-proposals is invalidated/refetched).
  const terminal = exception.disposition?.state === 'resolved' || exception.disposition?.state === 'dismissed';
  const liveProposal =
    proposal && !exception.anchoredReadOnly && !terminal && proposal.status === 'proposed' ? proposal : null;

  // Minimal EventDTO-compatible object for DecideForm (DATA ZONE — no mascot).
  const eventForForm: import('../../api/types').EventDTO = {
    id: exception.eventId,
    entityId,
    status: 'NEEDS_REVIEW' as const,
    normalized: {},
    ai: exception.ai
      ? {
          eventType: exception.ai.eventType ?? '',
          purpose: exception.ai.purpose ?? '',
          counterparty: null,
          confidence: exception.ai.confidence,
          reasoning: exception.ai.reasoning ?? '',
        }
      : null,
    final: null,
    routing: 'NEEDS_REVIEW' as const,
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      {/* DATA ZONE — ledger feel, no mascot (§8.4) */}
      <div
        className="card"
        style={{ padding: 'var(--s-6)', background: 'var(--paper-card)' }}
      >
        <p className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', marginTop: 0, marginBottom: 'var(--s-2)' }}>
          {exception.exceptionId}
        </p>
        <p className="font-body" style={{ margin: '0 0 var(--s-2)' }}>
          {exception.reason}
        </p>
        {exception.ai && (
          <ConfidenceBar confidence={exception.ai.confidence} />
        )}
        {exception.amount != null && (
          <p className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', marginTop: 'var(--s-2)', marginBottom: 0 }}>
            Amount: {exception.amount}
          </p>
        )}
      </div>

      {/* SUGGESTION ZONE — warmer, mascot allowed (§8.5) */}
      {liveProposal && <AgentProposalCard proposal={liveProposal} exception={exception} entityId={entityId} />}
      {isClassifyReview && !liveProposal && (
        <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <button
            className="btn-primary"
            disabled={copilot.isPending}
            onClick={() => copilot.mutate(exception.eventId, { onSuccess: setAdvice })}
            style={{ justifySelf: 'start' }}
          >
            {copilot.isPending ? 'Asking…' : 'Ask copilot'}
          </button>
          <CopilotDock
            advice={advice}
            loading={copilot.isPending}
            pose={advice ? 'confident' : 'raising-hand'}
          />
        </div>
      )}

      {/* DISPOSITION ZONE — sticky bottom, no mascot */}
      <div
        className="card"
        style={{
          padding: 'var(--s-4)',
          background: 'var(--paper-card)',
          position: 'sticky',
          bottom: 0,
          display: 'grid',
          gap: 'var(--s-3)',
        }}
      >
        {isClassifyReview && (
          <DecideForm
            event={eventForForm}
            draft={null}
            pending={decide.isPending}
            onDecide={(finalEventType, finalPurpose) =>
              decide.mutate({ eventId: exception.eventId, finalEventType, finalPurpose })
            }
          />
        )}
        {liveProposal && (
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            or decide manually
          </p>
        )}
        <DispositionControls exception={exception} entityId={entityId} demoted={!!liveProposal} />
      </div>
    </div>
  );
}
