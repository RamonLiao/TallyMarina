import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Mascot } from './Mascot';

export function Header() {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-3) var(--space-6)',
        marginBottom: 'var(--space-6)',
        background: 'var(--ink)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
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
      <ConnectButton />
    </header>
  );
}
