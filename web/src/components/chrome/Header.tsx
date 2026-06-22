import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Mascot } from './Mascot';

export function Header() {
  return (
    <header
      style={{
        // Full-bleed navy bar; inner row is centered to the 1200 content column.
        background: 'var(--ink)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        marginBottom: 'var(--space-6)',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: 'var(--space-3) clamp(16px, 4vw, 48px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Mascot pose="sailing" size={32} />
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              color: 'var(--paper)',
              fontWeight: 560,
              letterSpacing: '-0.02em',
            }}
          >
            TallyMarina
          </span>
        </div>
        <div className="wallet-slot">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
