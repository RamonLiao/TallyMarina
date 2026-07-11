import { useEffect, useMemo, useState } from 'react';
import type { PolicyActiveDTO, JournalDTO, EventDTO, CoaRuleDTO } from '../../api/types';
import { previewCoaRemap } from '../../lib/policyPreview';
import type { PreviewResult, LineDiff } from '../../lib/policyPreview';
import { CoaMappingTable } from './CoaMappingTable';
import './policy.css';

export function PreviewPanel({ policy, journal, events, onApply }: { policy: PolicyActiveDTO; journal: JournalDTO[]; events: EventDTO[]; onApply: (rules: CoaRuleDTO[], reason: string, actor: string) => Promise<void> }) {
  const baseRules = policy.coaMapping.rules;
  // null = fail-closed backend (no default account); '' routes unmapped legs into the
  // existing EMPTY_ACCOUNT warning path so the preview surfaces them instead of hiding them.
  const baseDefault = policy.coaMapping.defaultAccount ?? '';
  const [draft, setDraft] = useState<CoaRuleDTO[]>(() => baseRules.map((r) => ({ ...r })));
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [reason, setReason] = useState('');
  const [actor, setActor] = useState('controller');
  const [applyError, setApplyError] = useState<string>();
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Resync the draft to the server-confirmed mapping whenever it advances (e.g. after a
  // successful apply triggers usePolicyData's refetch). Keyed on the version number, not the
  // rules array reference, since baseRules is a fresh array every render.
  useEffect(() => {
    setDraft(baseRules.map((r) => ({ ...r })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.coaMapping.version]);

  const knownAccounts = useMemo(() => {
    const s = new Set<string>(baseDefault ? [baseDefault] : []);
    baseRules.forEach((r) => s.add(r.account));
    journal.forEach((j) => j.je.lines.forEach((l) => s.add(l.account)));
    return [...s];
  }, [baseRules, baseDefault, journal]);

  const recompute = () => {
    setApplied(false);
    setApplyError(undefined);
    setResult(previewCoaRemap({ journal, events, baseRules, baseDefault, nextRules: draft, nextDefault: baseDefault, knownAccounts }));
  };

  const hasBlockingWarning = (result?.warnings ?? []).some((w) => w.kind === 'UNKNOWN_ACCOUNT' || w.kind === 'EMPTY_ACCOUNT');
  const applyDisabled = !result || !reason.trim() || result.conservation.balanced === false || hasBlockingWarning || applying;
  const applyDisabledReason = applying
    ? 'Apply in progress…'
    : !result
      ? 'Recompute a preview first'
      : !reason.trim()
        ? 'Reason is required'
        : result.conservation.balanced === false
          ? 'Conservation broken — fix mapping before applying'
          : hasBlockingWarning
            ? 'Resolve UNKNOWN_ACCOUNT/EMPTY_ACCOUNT warnings before applying'
            : undefined;

  const apply = async () => {
    setApplying(true);
    setApplyError(undefined);
    try {
      await onApply(draft, reason, actor);
      setApplied(true);
      setResult(null);
    } catch (e) {
      setApplyError((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="card policy-preview export-draft-card">
      <div className="policy-preview-head">
        <h3 className="policy-card-title">What-if: COA remap preview</h3>
        <span className="export-status-badge--draft policy-preview-badge">PREVIEW — NOT APPLIED</span>
      </div>

      <CoaMappingTable rules={draft} defaultAccount={baseDefault} title="Draft mapping (edit to preview)" editable onChange={setDraft} />
      <button className="export-retry-btn policy-recompute" onClick={recompute} disabled={applying} title={applying ? 'Apply in progress — wait for it to finish' : undefined}>Recompute preview</button>

      {result && (
        <>
          <div className="policy-preview-meta">
            <span>Changed lines: <strong>{result.changed.length}</strong></span>
            <span>Coverage: {result.coverage.explicit} explicit · {result.coverage.defaulted} defaulted</span>
            <span className={result.conservation.balanced ? 'policy-ok' : 'policy-bad'}>
              {result.conservation.balanced ? 'Grand totals conserved ✓' : 'CONSERVATION BROKEN'}
            </span>
          </div>

          {result.warnings.length > 0 && (
            <ul className="policy-warnings">
              {result.warnings.map((w, i) => <li key={i} className="lock-blockers">{w.kind}: {w.detail}</li>)}
            </ul>
          )}

          <table className="policy-coa-table policy-diff">
            <thead><tr><th>JE</th><th>Event type</th><th>Leg</th><th className="num">Amount (minor)</th><th>From → To</th></tr></thead>
            <tbody>
              {result.changed.map((d: LineDiff, i) => (
                <tr key={i} className="policy-diff-changed">
                  <td className="mono">{d.jeId}</td><td className="mono">{d.eventType}</td><td className="mono">{d.leg}</td>
                  <td className="mono num">{d.amountMinor}</td>
                  <td className="mono">{d.fromAccount} <span className="policy-delta">Δ</span> {d.toAccount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="policy-tb-split">
            {(['beforeActivity', 'afterActivity'] as const).map((key) => (
              <div className="policy-tb-col" key={key}>
                <div className="policy-cluster-head">{key === 'beforeActivity' ? 'Before' : 'After'}</div>
                <table className="policy-coa-table">
                  <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
                  <tbody>
                    {result[key].map((a) => (
                      <tr key={a.account}><td className="mono">{a.account}</td>
                        <td className="mono num policy-debit">{a.debitMinor}</td>
                        <td className="mono num policy-credit">{a.creditMinor}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="policy-apply-row">
            <input
              className="policy-coa-input"
              placeholder="Reason (required)"
              aria-label="remap reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <input
              className="policy-coa-input"
              placeholder="Actor"
              aria-label="remap actor"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            />
            <button
              className="export-retry-btn"
              disabled={applyDisabled}
              title={applyDisabledReason}
              onClick={apply}
            >
              Apply to live mapping
            </button>
          </div>
          {applyError && <p className="policy-bad">{applyError}</p>}
        </>
      )}

      {applied && (
        <div className="policy-applied-badge">
          Applied — mapping v{policy.coaMapping.version} (rule {policy.coaMapping.ruleVersion})
        </div>
      )}
    </section>
  );
}
