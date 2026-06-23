import { useEffect, useState } from 'react';
import { useEntities, useReviewQueue, useCopilot, useDecide } from '../api/hooks';
import { useEntityCtx } from '../app/EntityContext';
import { CopilotDock } from '../components/chrome/CopilotDock';
import { DecideForm } from '../components/data/DecideForm';
import type { CopilotAdvice } from '../api/types';
import type { MascotPose } from '../components/chrome/Mascot';

// Derive avatar pose from copilot hook state — must be driven by hook, not random.
function derivePose(isPending: boolean, advice: CopilotAdvice | null): MascotPose {
  if (isPending) return 'thinking';           // aqua pulse — AI working
  if (advice) return 'confident';             // advice available — high signal
  return 'raising-hand';                      // waiting for human — NEEDS_REVIEW default
}

export function ReviewStep() {
  const { data: entities } = useEntities();
  const { entity, setEntity, goNext } = useEntityCtx();
  useEffect(() => { if (!entity && entities?.[0]) setEntity(entities[0]); }, [entity, entities, setEntity]);

  const { data: queue } = useReviewQueue(entity?.id);
  const copilot = useCopilot();
  const decide = useDecide(entity?.id ?? '');
  const [advice, setAdvice] = useState<CopilotAdvice | null>(null);

  const current = (queue ?? [])[0];
  const empty = (queue ?? []).length === 0;

  // Derive draft for DecideForm adopt button
  const draft = advice?.suggestedEntry
    ? {
        eventType: current?.ai?.eventType,
        purpose: current?.ai?.purpose,
      }
    : null;

  const pose = derivePose(copilot.isPending, advice);

  if (empty) {
    return (
      <div className="card" style={{ padding: 'var(--s-6)' }}>
        <p className="font-body">Review queue clear — all events approved or auto-routed.</p>
        <div style={{ textAlign: 'right' }}>
          <button className="btn-primary" onClick={() => goNext()}>Post the journal →</button>
        </div>
      </div>
    );
  }

  return (
    <div className="review-layout" style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="card" style={{ padding: 'var(--s-6)', flex: '1 1 320px' }}>
        <h2 style={{ marginTop: 0 }}>Review</h2>
        <p className="mono" style={{ fontSize: 15 }}>{current!.id}</p>
        <div style={{ display: 'flex', gap: 'var(--s-3)', margin: 'var(--s-3) 0 var(--s-6)' }}>
          <button
            className="btn-primary"
            disabled={copilot.isPending}
            onClick={() => copilot.mutate(current!.id, { onSuccess: (a) => setAdvice(a) })}
          >
            {copilot.isPending ? 'Asking…' : 'Ask copilot'}
          </button>
        </div>
        <DecideForm
          event={current!}
          draft={draft}
          pending={decide.isPending}
          onDecide={(finalEventType, finalPurpose) =>
            decide.mutate({ eventId: current!.id, finalEventType, finalPurpose }, { onSuccess: () => setAdvice(null) })
          }
        />
      </div>
      <CopilotDock advice={advice} loading={copilot.isPending} pose={pose} />
    </div>
  );
}
