const PROBLEMS = [
  'Balances live in silos — wallets, CEXs, custodians, ERPs — and never tie out.',
  'On-chain events carry no business context: a transfer isn\'t a "vendor payment".',
  'Month-end close is manual, spreadsheet-driven, and slips every period.',
  'Auditors ask "show me the source" and there\'s no clean trail from JE to chain.',
];

const SERVICES: { title: string; body: string; featured?: boolean; onchain?: boolean }[] = [
  { title: 'Sui-native normalization', body: 'Parses the Sui object model and DeepBook protocol events into typed economic activity.', featured: true, onchain: true },
  { title: 'Immutable, hash-anchored snapshots', body: 'Every close produces a tamper-evident snapshot with full source-to-JE lineage. Optional Walrus notarization.', featured: true, onchain: true },
  { title: 'AI-assisted classification', body: 'AI suggests treatments — it never posts. Every suggestion carries a confidence score and a human approves.' },
  { title: 'Policy-driven accounting', body: 'Treatments templated to IFRS / US GAAP, versioned and human-approved. Policy-driven cost basis (FIFO today; WAC / specific-ID on the roadmap).' },
  { title: 'Double-entry + reconciliation', body: 'Balanced journals with quantity & valuation roll-forward and maker-checker (segregation-of-duties) controls.' },
  { title: 'Period close & lock', body: 'Close checklist, roll-forward, realized/unrealized gain-loss schedules, and controlled reopen-with-reason.' },
  { title: 'ERP-ready export', body: 'COA-mapped, dimension-tagged, balanced, dedup-protected output — your ERP stays the system of record.' },
];

const STAGES = ['Ingest', 'AI suggest', 'Human approve', 'Journal', 'Anchor on-chain'];

export function ProblemSection() {
  return (
    <section className="landing-section landing-problem" aria-labelledby="problem-h">
      <h2 id="problem-h" className="landing-section__title">Crypto activity isn't accounting — yet.</h2>
      <ul className="landing-ledger">
        {PROBLEMS.map((p, i) => (
          <li key={i} className="landing-ledger__row">
            <span className="landing-ledger__mark" aria-hidden="true" />
            <span className="landing-ledger__text">{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ServicesSection() {
  return (
    <section className="landing-section landing-services" aria-labelledby="services-h">
      <h2 id="services-h" className="landing-section__title">One platform, source to ledger.</h2>
      <div className="landing-bento">
        {SERVICES.map((s) => (
          <article
            key={s.title}
            className={`landing-tile${s.featured ? ' landing-tile--featured' : ''}${s.onchain ? ' landing-tile--onchain' : ''}`}
          >
            <h3 className="landing-tile__title">{s.title}</h3>
            <p className="landing-tile__body">{s.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function HowItWorksSection() {
  return (
    <section className="landing-section landing-how" aria-labelledby="how-h">
      <h2 id="how-h" className="landing-section__title">How a close happens.</h2>
      <ol className="landing-pipeline">
        {STAGES.map((stage, i) => (
          <li key={stage} className={`landing-pipeline__node${i === STAGES.length - 1 ? ' landing-pipeline__node--anchor' : ''}`}>
            <span className="landing-pipeline__idx">{String(i + 1).padStart(2, '0')}</span>
            <span className="landing-pipeline__label">{stage}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function GovernanceSection() {
  return (
    <section className="landing-section landing-gov" aria-labelledby="gov-h">
      <p id="gov-h" className="landing-gov__line">
        <strong>AI suggests, humans approve — no autonomous posting.</strong> Read-only access,
        no private keys, segregation of duties, and every number drills down to its on-chain source.
      </p>
    </section>
  );
}

export function CtaSection({ onLaunch }: { onLaunch: () => void }) {
  return (
    <section className="landing-section landing-cta" aria-labelledby="cta-h">
      <hr className="landing-rule" />
      <h2 id="cta-h" className="landing-section__title">Close the books on on-chain chaos.</h2>
      <button className="btn btn--primary btn--lg" onClick={onLaunch}>Launch App</button>
      <p className="landing-foot">Read-only access · no private keys · single-entity today</p>
    </section>
  );
}
