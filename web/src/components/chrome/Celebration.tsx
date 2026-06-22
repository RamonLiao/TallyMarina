// CHROME ZONE — the single earned celebration AFTER anchor confirms (§8.4).
import { Mascot } from './Mascot';

export function Celebration({ digest, explorerUrl }: { digest: string; explorerUrl: string }) {
  return (
    <div className="card" style={{ padding: 'var(--s-8)', textAlign: 'center', display: 'grid', placeItems: 'center', gap: 'var(--s-3)' }}>
      <Mascot pose="celebrate" size={88} />
      <h2 style={{ margin: 0 }}>Anchored on-chain ⚓</h2>
      <p className="font-body" style={{ color: 'var(--ink-soft)', margin: 0 }}>The period is closed and notarized on Sui testnet.</p>
      <a className="aqua-link mono" style={{ fontSize: 15 }} href={explorerUrl} target="_blank" rel="noreferrer">
        {digest.length > 20 ? `${digest.slice(0, 12)}…${digest.slice(-8)}` : digest} ↗
      </a>
    </div>
  );
}
