import { Link } from 'react-router-dom';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Mascot } from './Mascot';
import { EntitySwitcher } from './EntitySwitcher';
import { PeriodPill } from './PeriodPill';

export function TopBar() {
  return (
    <header
      style={{
        background: 'var(--ink)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
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
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', textDecoration: 'none' }}>
          <Mascot pose="sailing" size={32} />
          <span
            style={{
              fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', color: 'var(--paper)',
              fontWeight: 560, letterSpacing: '-0.02em', lineHeight: 'var(--leading-tight)',
            }}
          >
            TallyMarina
          </span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <EntitySwitcher />
          <PeriodPill />
          <div className="wallet-slot">
            <ConnectButton />
          </div>
        </div>
      </div>
    </header>
  );
}
