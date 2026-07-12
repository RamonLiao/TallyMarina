import { useEffect, useState } from 'react';
import type { PolicyDocDTO } from '../../api/types';
import './policy.css';

const ACCOUNTING_STANDARD: PolicyDocDTO['accountingStandard'][] = ['IFRS', 'US_GAAP'];
const COST_BASIS: PolicyDocDTO['costBasisMethod'][] = ['FIFO', 'WAC'];
const STABLECOIN: PolicyDocDTO['stablecoinTreatment'][] = ['FINANCIAL_ASSET_IFRS9', 'INTANGIBLE_ASSET', 'CASH_EQUIVALENT'];
const STAKING: PolicyDocDTO['stakingIncomePolicy'][] = ['OPERATING_REVENUE', 'OTHER_INCOME'];
const FEE_EXPENSE: PolicyDocDTO['feeExpensePolicy'][] = ['EXPENSE_IMMEDIATE', 'CAPITALIZE_TO_ASSET'];
const REVALUATION: PolicyDocDTO['revaluationPolicy'][] = ['cost', 'revaluation'];

interface Props {
  doc: PolicyDocDTO;
  onApply: (changes: Partial<PolicyDocDTO>, reason: string, actor: string) => Promise<void>;
}

function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="policy-defrow">
      <span className="policy-defrow-label">{label}</span>
      <span className="policy-defrow-value mono">{value}</span>
    </div>
  );
}

export function PolicyEditForm({ doc, onApply }: Props) {
  const [accountingStandard, setAccountingStandard] = useState(doc.accountingStandard);
  const [costBasisMethod, setCostBasisMethod] = useState(doc.costBasisMethod);
  const [stablecoinTreatment, setStablecoinTreatment] = useState(doc.stablecoinTreatment);
  const [stakingIncomePolicy, setStakingIncomePolicy] = useState(doc.stakingIncomePolicy);
  const [feeExpensePolicy, setFeeExpensePolicy] = useState(doc.feeExpensePolicy);
  const [revaluationPolicy, setRevaluationPolicy] = useState(doc.revaluationPolicy);
  const [reason, setReason] = useState('');
  const [actor, setActor] = useState('controller');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // Derive form state from props; reset whenever the workspace hands us a fresh doc
  // (e.g. after a successful apply refetch). No local duplication of doc beyond edits-in-progress.
  useEffect(() => {
    setAccountingStandard(doc.accountingStandard);
    setCostBasisMethod(doc.costBasisMethod);
    setStablecoinTreatment(doc.stablecoinTreatment);
    setStakingIncomePolicy(doc.stakingIncomePolicy);
    setFeeExpensePolicy(doc.feeExpensePolicy);
    setRevaluationPolicy(doc.revaluationPolicy);
    setReason('');
    setError(undefined);
  }, [doc]);

  const applyDisabled = submitting || !reason.trim();

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onApply(
        { accountingStandard, costBasisMethod, stablecoinTreatment, stakingIncomePolicy, feeExpensePolicy, revaluationPolicy },
        reason,
        actor,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card policy-edit">
      <h3 className="policy-card-title">Edit policy</h3>

      <div className="policy-cluster">
        <div className="policy-cluster-head">Accounting config</div>
        <label className="policy-field">
          <span className="policy-defrow-label">Accounting standard</span>
          <select aria-label="accounting standard" value={accountingStandard} onChange={(e) => setAccountingStandard(e.target.value as PolicyDocDTO['accountingStandard'])}>
            {ACCOUNTING_STANDARD.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="policy-field">
          <span className="policy-defrow-label">Cost basis method</span>
          <select aria-label="cost basis method" value={costBasisMethod} onChange={(e) => setCostBasisMethod(e.target.value as PolicyDocDTO['costBasisMethod'])}>
            {/* WAC is schema-reserved for P1; the API rejects it (400 NOT_EXECUTABLE_MVP), so an
                enabled option would be a guaranteed dead end — visible but unselectable. */}
            {COST_BASIS.map((v) => <option key={v} value={v} disabled={v !== 'FIFO'}>{v === 'FIFO' ? v : `${v} (P1)`}</option>)}
          </select>
        </label>
        <label className="policy-field">
          <span className="policy-defrow-label">Stablecoin treatment</span>
          <select aria-label="stablecoin treatment" value={stablecoinTreatment} onChange={(e) => setStablecoinTreatment(e.target.value as PolicyDocDTO['stablecoinTreatment'])}>
            {STABLECOIN.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="policy-field">
          <span className="policy-defrow-label">Staking income policy</span>
          <select aria-label="staking income policy" value={stakingIncomePolicy} onChange={(e) => setStakingIncomePolicy(e.target.value as PolicyDocDTO['stakingIncomePolicy'])}>
            {STAKING.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="policy-field">
          <span className="policy-defrow-label">Fee expense policy</span>
          <select aria-label="fee expense policy" value={feeExpensePolicy} onChange={(e) => setFeeExpensePolicy(e.target.value as PolicyDocDTO['feeExpensePolicy'])}>
            {FEE_EXPENSE.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="policy-field">
          <span className="policy-defrow-label">Revaluation policy</span>
          <select aria-label="revaluation policy" value={revaluationPolicy} onChange={(e) => setRevaluationPolicy(e.target.value as PolicyDocDTO['revaluationPolicy'])}>
            {REVALUATION.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      </div>

      <div className="policy-cluster">
        <div className="policy-cluster-head">Currency (locked)</div>
        <label className="policy-field">
          <span className="policy-defrow-label">Functional currency</span>
          <input
            className="policy-coa-input"
            aria-label="functional currency (locked)"
            value={doc.functionalCurrency}
            disabled
            title="USD-locked in MVP (spec §1.3)"
            readOnly
          />
        </label>
        <label className="policy-field">
          <span className="policy-defrow-label">Reporting currency</span>
          <input
            className="policy-coa-input"
            aria-label="reporting currency (locked)"
            value={doc.reportingCurrency}
            disabled
            title="USD-locked in MVP (spec §1.3)"
            readOnly
          />
        </label>
      </div>

      <div className="policy-cluster">
        <div className="policy-cluster-head">Version dims (read-only)</div>
        <VersionRow label="Policy set version" value={doc.policySetVersion} />
        <VersionRow label="Asset policy version" value={doc.assetPolicyVersion} />
        <VersionRow label="Event policy version" value={doc.eventPolicyVersion} />
        <VersionRow label="Rule version" value={doc.ruleVersion} />
        <VersionRow label="Parser version" value={doc.parserVersion} />
        <VersionRow label="Normalization version" value={doc.normalizationVersion} />
      </div>

      <div className="policy-apply-row">
        <input
          className="policy-coa-input"
          placeholder="Reason (required)"
          aria-label="policy change reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <input
          className="policy-coa-input"
          placeholder="Actor"
          aria-label="policy change actor"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        />
        <button
          className="export-retry-btn"
          disabled={applyDisabled}
          title={submitting ? 'Apply in progress…' : !reason.trim() ? 'Reason is required' : undefined}
          onClick={submit}
        >
          Apply policy changes
        </button>
      </div>
      {error && <p className="policy-bad">{error}</p>}
    </section>
  );
}
