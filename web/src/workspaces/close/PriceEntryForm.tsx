// web/src/workspaces/close/PriceEntryForm.tsx — manual period-end price entry (Task 12, spec §7).
// The coin dropdown is LIMITED to the asset registry (an unregistered coin 400s at the API —
// ASSET_NOT_REGISTERED — so offering it would be a guaranteed dead end, same rationale as
// PolicyEditForm's disabled WAC option). Price is a fiat DECIMAL string: the client validates
// shape and sends the string untouched; the server owns decimal→minor conversion (no float ever).
import { useEffect, useState } from 'react';
import type { EntityAssetDTO } from '../../api/types';
import { postPrice } from '../../api/endpoints';
import '../policy/policy.css';
import './close.css';

// Mirror of services/api PERIOD_CUTOFFS / periodStart (spec §5) — MVP knows one period.
// The date input is bounded to [start, cut-off]; the server re-validates (periodOfDate).
const PERIOD_BOUNDS: Readonly<Record<string, { start: string; cutoff: string }>> = {
  '2026-Q2': { start: '2026-04-01', cutoff: '2026-06-30' },
};

// Mirror of the server's PRICE_RE: plain decimal, at most 2 decimal places, no sign/exponent.
const PRICE_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

export function PriceEntryForm({
  entityId,
  periodId,
  assets,
  assetsError,
  onSaved,
}: {
  entityId: string;
  periodId: string;
  assets: EntityAssetDTO[];
  assetsError?: string;
  onSaved: () => void;
}) {
  const bounds = PERIOD_BOUNDS[periodId];
  const [coinType, setCoinType] = useState('');
  const [asOf, setAsOf] = useState(bounds?.cutoff ?? '');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Default the dropdown to the first registered asset once the registry arrives.
  useEffect(() => {
    if (!coinType && assets.length > 0) setCoinType(assets[0]!.coinType);
  }, [assets, coinType]);

  const submit = async () => {
    setSaved(false);
    setError(undefined);
    if (!coinType) { setError('Pick a registered asset — unregistered coins cannot be priced.'); return; }
    if (!asOf) { setError('As-of date is required.'); return; }
    const m = PRICE_RE.exec(price);
    if (!m) { setError('Price must be a plain decimal with at most 2 decimal places, e.g. 3.25'); return; }
    if (BigInt(m[1]!) === 0n && BigInt((m[2] ?? '').padEnd(2, '0') || '0') === 0n) {
      setError('Price must be greater than zero.'); return;
    }
    setSaving(true);
    try {
      // Send the decimal STRING as typed — the server converts to minor units (never a float here).
      await postPrice(entityId, { coinType, asOf, price });
      setSaved(true);
      setPrice('');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="reval-price-form policy-edit">
      <div className="policy-cluster-head">
        Enter period-end price{' '}
        <span className="policy-chip-deferred" title="Manual entry — fair-value hierarchy Level 2 (spec §5)">LEVEL_2 · manual</span>
      </div>
      {assetsError && <p className="policy-bad">asset registry unavailable: {assetsError}</p>}
      <label className="policy-field">
        <span className="policy-defrow-label">Asset</span>
        <select aria-label="price asset" value={coinType} onChange={(e) => setCoinType(e.target.value)}>
          {assets.map((a) => (
            <option key={a.coinType} value={a.coinType}>{a.symbol} — {a.coinType}</option>
          ))}
        </select>
      </label>
      <label className="policy-field">
        <span className="policy-defrow-label">As of (period cut-off)</span>
        <input
          type="date"
          aria-label="price as-of date"
          value={asOf}
          min={bounds?.start}
          max={bounds?.cutoff}
          onChange={(e) => setAsOf(e.target.value)}
        />
      </label>
      <label className="policy-field">
        <span className="policy-defrow-label">Price (USD)</span>
        <input
          className="policy-coa-input"
          aria-label="price (USD)"
          inputMode="decimal"
          placeholder="e.g. 3.25"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
      <div className="policy-apply-row">
        <button
          type="button"
          className="export-retry-btn"
          disabled={saving}
          title={saving ? 'Save in progress…' : undefined}
          onClick={submit}
        >
          Save price
        </button>
      </div>
      {error && <p className="policy-bad">{error}</p>}
      {saved && <div className="policy-applied-badge">Price saved</div>}
    </div>
  );
}
