// web/src/workspaces/close/RevaluationCard.tsx — period-end revaluation cockpit card (Task 12,
// spec §6/§7). Preview is read-only trial math (never posts); Run is the write path and is
// gated on a successful preview with zero missing prices. All amounts are USD minor-unit
// strings rendered via the shared fmtMinor (fiat decimals = 2); lot quantities render at the
// asset registry's scale.
import { Fragment, useEffect, useState } from 'react';
import type { EntityAssetDTO, RevaluationRowDTO } from '../../api/types';
import { getAssets } from '../../api/endpoints';
import { ApiClientError } from '../../api/client';
import { useRevaluation } from '../../data/useRevaluation';
import { fmtMinor } from '../../lib/fmtMinor';
import { PriceEntryForm } from './PriceEntryForm';
import { PriceHistoryCard } from './PriceHistoryCard';
import '../policy/policy.css';
import './close.css';

const FIAT_DECIMALS = 2;

// Wire basis → operator-facing label. Unknown values fall through verbatim (fail loud, not blank).
const BASIS_LABEL: Record<RevaluationRowDTO['basis'], string> = {
  GAAP_FV: 'ASU 2023-08 FV',
  GAAP_COST: 'GAAP cost',
  IFRS_COST: 'IFRS cost',
};

// Positive delta = valuation gain (credit ink), negative = loss (debit ink), zero = plain.
function deltaCls(deltaMinor: string): string {
  if (deltaMinor.startsWith('-')) return ' policy-debit';
  if (/^0+$/.test(deltaMinor)) return '';
  return ' policy-credit';
}

export function RevaluationCard({
  entityId,
  periodId,
  periodStatus,
  onCockpitRefetch,
}: {
  entityId: string;
  periodId: string;
  periodStatus: 'OPEN' | 'LOCKED';
  onCockpitRefetch: () => void;
}) {
  const { preview, previewLoading, error, recompute, run, runPending } = useRevaluation(entityId, periodId);
  const [assets, setAssets] = useState<EntityAssetDTO[]>([]);
  const [assetsError, setAssetsError] = useState<string>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [runNotice, setRunNotice] = useState<string>();
  const [runError, setRunError] = useState<string>();
  const [priceRefreshKey, setPriceRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setAssets([]);
    setAssetsError(undefined);
    getAssets(entityId)
      .then((a) => { if (!cancelled) setAssets(a); })
      .catch((e) => { if (!cancelled) setAssetsError((e as Error).message); });
    return () => { cancelled = true; };
  }, [entityId]);

  // Preview rows carry the SHORT address form (0x2::sui::SUI) while the registry stores the
  // canonical long form — normalize the address part (lowercase, strip leading zeros) so the
  // two representations of the same coin match. Exact-string lookup missed live (Playwright
  // gate) and silently fell back to raw minor units for the lot quantity.
  const coinKey = (coinType: string): string => {
    const [addr = '', ...rest] = coinType.split('::');
    return [addr.toLowerCase().replace(/^0x0+(?=[0-9a-f])/, '0x'), ...rest].join('::');
  };
  const assetOf = (coinType: string): EntityAssetDTO | undefined =>
    assets.find((a) => coinKey(a.coinType) === coinKey(coinType));
  const symbolOf = (coinType: string): string =>
    assetOf(coinType)?.symbol ?? coinType.split('::').pop() ?? coinType;
  const qtyOf = (qtyMinor: string, coinType: string): string => {
    const dec = assetOf(coinType)?.decimals;
    // Registry unavailable / unknown asset → raw minor units, never a defaulted scale (spec D6).
    return dec === undefined ? qtyMinor : fmtMinor(qtyMinor, dec);
  };

  const missing = preview?.priceMissing ?? [];
  const runDisabledReason =
    periodStatus === 'LOCKED' ? 'Period is LOCKED — reopen it before running revaluation'
    : runPending ? 'Run in progress…'
    : previewLoading ? 'Preview in progress — wait for it to finish'
    : !preview ? 'Recompute a preview first'
    : missing.length > 0
      ? `${missing.length} asset${missing.length === 1 ? '' : 's'} missing price — enter period-end prices first`
      : undefined;

  const doRun = async () => {
    setRunNotice(undefined);
    setRunError(undefined);
    try {
      await run();
      setRunNotice('Revaluation posted');
      onCockpitRefetch(); // revaluation light flips green immediately
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'REVAL_ALREADY_CURRENT') {
        // Neutral outcome, not an error: the books already reflect current prices.
        setRunNotice('Already current — no changes');
        onCockpitRefetch();
      } else {
        setRunError((e as Error).message);
      }
    }
  };

  const onPriceSaved = () => {
    setPriceRefreshKey((k) => k + 1); // price history refreshes
    setRunNotice(undefined);          // stale outcome badge must not outlive the new price
    onCockpitRefetch();               // staleness light reflects the new price immediately
    void recompute();                 // trial table follows; Run stays disabled while it reloads
  };

  return (
    <>
      <section className="card" id="revaluation-card" aria-label="Period-end revaluation">
        <h3 className="policy-card-title">Period-end revaluation</h3>

        {missing.length > 0 && (
          <p role="status" className="lock-blockers">
            <span aria-hidden="true" className="lock-blockers__icon">⚠</span>
            {missing.length} asset{missing.length === 1 ? '' : 's'} missing price
          </p>
        )}

        {error && <p className="policy-bad">preview failed: {error}</p>}
        {!error && !preview && <p>{previewLoading ? 'Computing preview…' : 'No preview yet.'}</p>}

        {preview && preview.rows.length === 0 && <p>No revaluable positions in {periodId}.</p>}
        {preview && preview.rows.length > 0 && (
          <div className="policy-coa-scroll">
            <table className="policy-coa-table">
              <thead>
                <tr>
                  <th aria-label="expand" />
                  <th>Asset</th>
                  <th>Basis</th>
                  <th className="num">Prior carrying</th>
                  <th className="num">Current value</th>
                  <th className="num">Δ</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <Fragment key={r.coinType}>
                    <tr className={r.missingPrice ? 'reval-row--missing' : undefined}>
                      <td>
                        <button
                          type="button"
                          className="reval-expand"
                          aria-expanded={!!expanded[r.coinType]}
                          aria-label={`toggle lots for ${symbolOf(r.coinType)}`}
                          onClick={() => setExpanded((x) => ({ ...x, [r.coinType]: !x[r.coinType] }))}
                        >
                          {expanded[r.coinType] ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="mono" title={r.coinType}>
                        {symbolOf(r.coinType)}
                        {r.missingPrice && <span className="reval-missing-flag"> ⛔ missing price</span>}
                      </td>
                      <td><span className="policy-chip-deferred">{BASIS_LABEL[r.basis] ?? r.basis}</span></td>
                      <td className="mono num">{fmtMinor(r.priorCarryingMinor, FIAT_DECIMALS)}</td>
                      {/* A missing-price row carries no honest current value/delta — dash, not 0.00. */}
                      <td className="mono num">{r.missingPrice ? '—' : fmtMinor(r.currentValueMinor, FIAT_DECIMALS)}</td>
                      <td className={`mono num${r.missingPrice ? '' : deltaCls(r.deltaMinor)}`}>
                        {r.missingPrice ? '—' : fmtMinor(r.deltaMinor, FIAT_DECIMALS)}
                      </td>
                    </tr>
                    {expanded[r.coinType] && r.lots.map((l) => (
                      <tr key={l.lotId} className="reval-lot-row">
                        <td />
                        <td className="mono">{l.lotId} · qty {qtyOf(l.qtyMinor, r.coinType)}</td>
                        <td />
                        <td className="mono num">{fmtMinor(l.priorCarryingMinor, FIAT_DECIMALS)}</td>
                        <td className="mono num">{fmtMinor(l.currentValueMinor, FIAT_DECIMALS)}</td>
                        <td className={`mono num${deltaCls(l.deltaMinor)}`}>{fmtMinor(l.deltaMinor, FIAT_DECIMALS)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="reval-actions">
          <button
            type="button"
            className="export-retry-btn"
            disabled={previewLoading || runPending}
            title={previewLoading ? 'Preview in progress…' : runPending ? 'Run in progress…' : undefined}
            onClick={() => { setRunNotice(undefined); setRunError(undefined); void recompute(); }}
          >
            Preview revaluation
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={runDisabledReason !== undefined}
            title={runDisabledReason}
            onClick={doRun}
          >
            Run revaluation
          </button>
        </div>
        {runError && <p className="policy-bad">{runError}</p>}
        {runNotice && <div className="policy-applied-badge">{runNotice}</div>}

        <PriceEntryForm
          entityId={entityId}
          periodId={periodId}
          assets={assets}
          assetsError={assetsError}
          onSaved={onPriceSaved}
        />
      </section>
      <PriceHistoryCard entityId={entityId} refreshKey={priceRefreshKey} />
    </>
  );
}
