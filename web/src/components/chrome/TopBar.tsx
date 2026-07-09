import { Link } from 'react-router-dom';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Mascot } from './Mascot';
import { EntitySwitcher } from './EntitySwitcher';
import { PeriodPill } from './PeriodPill';
import { NavDrawer } from './NavDrawer';

// All layout, colour and type live in base.css .topbar* so the mobile reflow
// is a clean media query rather than an !important fight with inline styles.
export function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <NavDrawer />
        <Link className="topbar-brand" to="/" style={{ textDecoration: 'none' }}>
          <Mascot pose="sailing" size={32} />
          <span className="topbar-brand-name">TallyMarina</span>
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
