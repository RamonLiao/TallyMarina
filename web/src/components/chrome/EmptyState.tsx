// CHROME ZONE — empty/onboarding is an explicit §8.4 mascot-allowed zone.
import { Mascot } from './Mascot';

export function EmptyState({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 'var(--s-12)', textAlign: 'center', display: 'grid', placeItems: 'center', gap: 'var(--s-4)' }}>
      <Mascot pose="sailing" size={96} />
      <h2 style={{ margin: 0, fontSize: 28 }}>{title}</h2>
      <p className="font-body" style={{ maxWidth: 460, color: 'var(--ink-soft)', margin: 0 }}>{body}</p>
      {cta}
    </div>
  );
}
