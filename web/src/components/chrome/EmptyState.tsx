// CHROME ZONE — empty/onboarding is an explicit §8.4 mascot-allowed zone.
import { Mascot } from './Mascot';

// variant 'clear-seas' = no exceptions, celebratory (default);
// variant 'pick-one' = prompt user to select an item from the list.
// Both fall back to the sailing mascot; Task 6 may add richer variants.
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
  const resolvedTitle =
    title ??
    (variant === 'pick-one' ? 'Select an exception' : 'All clear');
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
      <h2 style={{ margin: 0, fontSize: 28 }}>{resolvedTitle}</h2>
      <p className="font-body" style={{ maxWidth: 460, color: 'var(--ink-soft)', margin: 0 }}>
        {resolvedBody}
      </p>
      {cta}
    </div>
  );
}
