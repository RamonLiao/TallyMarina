import { STEPS, type StepId } from '../../app/steps';
import { Mascot } from './Mascot';
import { useEntityCtx } from '../../app/EntityContext';

export function StepRail({ current }: { current: StepId }) {
  const { setStep } = useEntityCtx();
  const currentN = STEPS.find((s) => s.id === current)?.n ?? 1;
  return (
    <nav
      aria-label="Close-the-period progress"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-4) 0',
        flexWrap: 'wrap',
      }}
    >
      {STEPS.map((s, i) => {
        const active = s.id === current;
        const done = s.n < currentN;
        // Only current or already-completed steps are reachable; jumping forward would
        // bypass the goNext() gating that each step relies on.
        const navigable = s.n <= currentN && !active;
        return (
          <div
            key={s.id}
            data-active={active}
            role={navigable ? 'button' : undefined}
            tabIndex={navigable ? 0 : undefined}
            onClick={navigable ? () => setStep(s.id) : undefined}
            onKeyDown={
              navigable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setStep(s.id);
                    }
                  }
                : undefined
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              opacity: active || done ? 1 : 0.45,
              cursor: navigable ? 'pointer' : 'default',
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                background: done ? 'var(--credit)' : active ? 'var(--brass-fill)' : 'transparent',
                color: done ? 'var(--paper)' : 'var(--ink)',
                border: `1px solid ${active || done ? 'transparent' : 'var(--paper-line)'}`,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {done ? '✓' : s.n}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--ink)' : 'var(--ink-soft)',
              }}
            >
              {s.label}
            </span>
            {active && (
              <span data-testid="rail-otter">
                <Mascot pose="sailing" size={28} />
              </span>
            )}
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                style={{
                  marginLeft: 'var(--space-1)',
                  width: 40,
                  height: 1,
                  background: done ? 'var(--credit)' : 'var(--paper-line)',
                  display: 'inline-block',
                }}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
