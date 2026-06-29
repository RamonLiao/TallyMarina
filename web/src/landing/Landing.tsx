import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Mascot } from '../components/chrome/Mascot';
import { JournalArtifact } from './JournalArtifact';
import {
  ProblemSection,
  ServicesSection,
  HowItWorksSection,
  GovernanceSection,
  CtaSection,
} from './sections';
import './landing.css';

export default function Landing() {
  const navigate = useNavigate();
  const launch = () => navigate('/app');
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav__brand">
          <Mascot pose="sailing" size={28} />
          <span className="landing-nav__wordmark">TallyMarina</span>
        </div>
        <Button variant="primary" onClick={launch}>Launch App</Button>
      </header>

      <main>
      <section className="landing-hero">
        <div className="landing-hero__copy">
          <p className="landing-hero__eyebrow">Digital-asset subledger</p>
          <h1 className="landing-hero__headline">Turn on-chain chaos into an audit-ready close.</h1>
          <p className="landing-hero__sub">
            Sui, exchange and protocol activity → reconciled, policy-driven journal entries with
            full source-to-JE lineage — reviewed by your team, exported to your ERP.
          </p>
          <div className="landing-hero__cta">
            <Button variant="primary" onClick={launch}>Launch App</Button>
            <Button variant="ghost" onClick={launch}>See the close flow</Button>
          </div>
          <code className="landing-hero__chip">⛓ Built on Sui</code>
        </div>
        <div className="landing-hero__art">
          <JournalArtifact />
        </div>
      </section>

      <ProblemSection />
      <ServicesSection />
      <HowItWorksSection />
      <GovernanceSection />
      <CtaSection onLaunch={launch} />
      </main>
    </div>
  );
}
