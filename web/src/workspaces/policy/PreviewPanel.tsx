import { useMemo, useState } from 'react';
import type { PolicyActiveDTO, JournalDTO, EventDTO, CoaRuleDTO } from '../../api/types';
import { previewCoaRemap } from '../../lib/policyPreview';
import type { PreviewResult, LineDiff } from '../../lib/policyPreview';
import { CoaMappingTable } from './CoaMappingTable';
import './policy.css';

export function PreviewPanel({ policy, journal, events }: { policy: PolicyActiveDTO; journal: JournalDTO[]; events: EventDTO[] }) {
  const baseRules = policy.coaMapping.rules;
  const baseDefault = policy.coaMapping.defaultAccount;
  const [draft, setDraft] = useState<CoaRuleDTO[]>(() => baseRules.map((r) => ({ ...r })));
  const [result, setResult] = useState<PreviewResult | null>(null);

  const knownAccounts = useMemo(() => {
    const s = new Set<string>([baseDefault]);
    baseRules.forEach((r) => s.add(r.account));
    journal.forEach((j) => j.je.lines.forEach((l) => s.add(l.account)));
    return [...s];
  }, [baseRules, baseDefault, journal]);

  const recompute = () => setResult(previewCoaRemap({ journal, events, baseRules, baseDefault, nextRules: draft, nextDefault: baseDefault, knownAccounts }));

  return (
    <section className="card policy-preview export-draft-card">
      <div className="policy-preview-head">
        <h3 className="policy-card-title">What-if: COA remap preview</h3>
        <span className="export-status-badge--draft policy-preview-badge">PREVIEW — NOT APPLIED</span>
      </div>

      <CoaMappingTable rules={draft} defaultAccount={baseDefault} title="Draft mapping (edit to preview)" editable onChange={setDraft} />
      <button className="export-retry-btn policy-recompute" onClick={recompute}>Recompute preview</button>

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
        </>
      )}
    </section>
  );
}
