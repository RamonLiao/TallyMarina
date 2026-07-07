import { Link } from 'react-router-dom';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Mascot } from './Mascot';
import { EntitySwitcher } from './EntitySwitcher';
import { PeriodPill } from './PeriodPill';

export function TopBar() {
  // Layout (display/flex/order/width) lives in base.css .topbar-* so the mobile
  // reflow is a clean media query rather than an !important fight with inline styles.
  // Purely-visual props (font, color) stay inline.
  return (
    <header className="topbar" style={{ background: 'var(--ink)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="topbar-inner">
        <Link className="topbar-brand" to="/" style={{ textDecoration: 'none' }}>
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
        <div className="topbar-context">
          <EntitySwitcher />
          <PeriodPill />
        </div>
        <div className="wallet-slot topbar-wallet">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
