// web/src/workspaces/reports/ReportsWorkspace.tsx — Task 8: TB + roll-forward evidence views
// (spec §5). DATA ZONE — no mascot (§8.4). Read-only: consumes GET /entities/:id/trial-balance
// and /roll-forward (Task 6), never posts.
import { useTrialBalance, useRollForward } from '../../api/hooks';
import { TrialBalanceTable, TieOutBanner } from './TrialBalanceTable';
import { RollForwardTable } from './RollForwardTable';
import './reports.css';

export function ReportsWorkspace({ entityId, periodId }: { entityId: string; periodId: string }) {
  const { data: tb, isLoading: tbLoading } = useTrialBalance(entityId, periodId);
  const { data: rf, isLoading: rfLoading } = useRollForward(entityId, periodId);

  if (tbLoading || rfLoading) return <p>Loading reports…</p>;
  if (!tb || !rf) return <p>No report data.</p>;

  const empty = tb.rows.length === 0;

  return (
    <div className="reports-workspace">
      <div className="reports-meta" role="note">
        <span>Standard: <strong>{tb.meta.accountingStandard}</strong></span>
        <span>Policy set: <strong>{tb.meta.policySetVersion}</strong></span>
        <span>Period status: <strong>{tb.meta.periodStatus}</strong></span>
      </div>

      {tb.drift && (
        <div className="reports-banner reports-banner--drift" role="alert">
          <strong>⚠ Drift</strong> — recomputed reports disagree with the frozen LOCKED-period
          snapshot:{' '}
          {tb.drift.dimensions.map((d) => (
            `${d.light} (frozen ${d.frozenStatus}, recomputed green: ${String(d.recomputedGreen)})`
          )).join('; ')}.
        </div>
      )}

      {empty ? (
        <div className="reports-empty">
          <p>No data for this period.</p>
        </div>
      ) : (
        <>
          <section>
            <h3>Trial Balance</h3>
            <TieOutBanner tieOut={tb.tieOut} />
            <TrialBalanceTable rows={tb.rows} />
          </section>
          <section>
            <h3>Roll-Forward (ASU 2023-08)</h3>
            <RollForwardTable data={rf} />
          </section>
        </>
      )}
    </div>
  );
}
