import type { PolicyActiveDTO } from '../../api/types';
import './policy.css';

function Row({ label, value, chip }: { label: string; value: string; chip?: string }) {
  return (
    <div className="policy-defrow">
      <span className="policy-defrow-label">{label}</span>
      <span className="policy-defrow-value mono">{value}</span>
      {chip && <span className="policy-chip-deferred">{chip}</span>}
    </div>
  );
}

export function PolicySummaryCard({ policy }: { policy: PolicyActiveDTO }) {
  const p = policy.policySet;
  return (
    <section className="card policy-card">
      <h3 className="policy-card-title">Active Policy</h3>
      <div className="policy-cluster">
        <div className="policy-cluster-head">Governance</div>
        <div className="policy-chips">
          <span className="status-chip policy-chip-version">{p.policySetVersion}</span>
          <span className={`status-chip ${p.periodOpen ? 'policy-chip-open' : 'policy-chip-locked'}`}>
            {p.periodOpen ? 'PERIOD OPEN' : 'PERIOD LOCKED'}
          </span>
          <span className="status-chip policy-chip-period">{policy.periodId}</span>
        </div>
      </div>
      <div className="policy-cluster">
        <div className="policy-cluster-head">Accounting config</div>
        <Row label="Cost basis" value={p.costBasisMethod} chip="method locked — preview not supported" />
        <Row label="Functional currency" value={`${p.functionalCurrency} · fixed system assumption`} chip="method locked — preview not supported" />
        <Row label="Rounding threshold (minor)" value={p.roundingThresholdMinor} chip="what-if deferred" />
        <Row label="Rule version" value={p.ruleVersion} />
        <Row label="Parser / Normalization" value={`${p.parserVersion} / ${p.normalizationVersion}`} />
      </div>
    </section>
  );
}
