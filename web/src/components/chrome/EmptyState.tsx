// CHROME ZONE — empty/onboarding is an explicit §8.4 mascot-allowed zone.
import { Mascot } from './Mascot';

// variant 'clear-seas' = no exceptions, celebratory — otter-at-helm, cream bg, brass CTA;
// variant 'pick-one'   = quiet prompt to select an item from the list;
// undefined/default    = neutral sailing mascot (backward-compatible).
export function EmptyState({
  title,
  body,
  cta,
  variant,
}: {
  title?: string;
  body?: string;
  cta?: React.ReactNode;
  variant?: 'clear-seas' | 'pick-one';
}) {
  if (variant === 'clear-seas') {
    return (
      <div
        className="card empty-state-clear-seas"
        style={{
          padding: 'var(--s-12)',
          textAlign: 'center',
          display: 'grid',
          placeItems: 'center',
          gap: 'var(--s-4)',
          background: 'var(--paper)',
          animation: 'es-reveal 0.45s ease both',
        }}
      >
        <style>{`
          @keyframes es-reveal {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .empty-state-clear-seas .es-mascot { animation: es-reveal 0.4s 0.05s ease both; }
          .empty-state-clear-seas .es-title  { animation: es-reveal 0.4s 0.15s ease both; }
          .empty-state-clear-seas .es-body   { animation: es-reveal 0.4s 0.25s ease both; }
          .empty-state-clear-seas .es-cta    { animation: es-reveal 0.4s 0.35s ease both; }
        `}</style>
        <span className="es-mascot">
          <Mascot pose="celebrate" size={112} />
        </span>
        <h2 className="es-title" style={{ margin: 0, fontSize: 'var(--text-2xl)', color: 'var(--ink)' }}>
          {title ?? 'Clear seas · 0 exceptions blocking close'}
        </h2>
        <p
          className="es-body font-body"
          style={{ maxWidth: 460, color: 'var(--ink-soft)', margin: 0 }}
        >
          {body ?? 'No exceptions to triage. The ledger is clean and ready for period close.'}
        </p>
        <span className="es-cta">
          {cta ?? (
            <span
              style={{
                display: 'inline-block',
                padding: '8px 20px',
                borderRadius: 'var(--radius-pill)',
                border: '1.5px solid var(--brass)',
                color: 'var(--brass)',
                fontWeight: 600,
                fontSize: 'var(--text-sm)',
                letterSpacing: '0.01em',
                cursor: 'default',
              }}
            >
              Period ready to close →
            </span>
          )}
        </span>
      </div>
    );
  }

  const resolvedTitle =
    title ?? (variant === 'pick-one' ? 'Select an exception' : 'All clear');
  const resolvedBody =
    body ??
    (variant === 'pick-one'
      ? 'Choose an item from the list to see details.'
      : 'No exceptions to triage. The seas are clear.');

  return (
    <div
      className="card"
      style={{
        padding: 'var(--s-12)',
        textAlign: 'center',
        display: 'grid',
        placeItems: 'center',
        gap: 'var(--s-4)',
      }}
    >
      <Mascot pose="sailing" size={96} />
      <h2 style={{ margin: 0, fontSize: 'var(--text-2xl)' }}>{resolvedTitle}</h2>
      <p className="font-body" style={{ maxWidth: 460, color: 'var(--ink-soft)', margin: 0 }}>
        {resolvedBody}
      </p>
      {cta}
    </div>
  );
}
