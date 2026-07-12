// web/src/workspaces/close/PriceHistoryCard.tsx — manual price-point history (Task 12, spec §7).
// Mirrors PolicyHistoryCard's props/layout ({entityId, refreshKey} + .policy-history-* shell):
// append-only store, newest on top, superseded rows flagged instead of hidden.
import { useEffect, useState } from 'react';
import type { PricePointDTO } from '../../api/types';
import { getPrices } from '../../api/endpoints';
import { fmtMinor } from '../../lib/fmtMinor';
import '../policy/policy.css';
import './close.css';

const FIAT_DECIMALS = 2; // priceMinor is USD minor units (spec §1.3 USD-locked)

export function PriceHistoryCard({ entityId, refreshKey }: { entityId: string; refreshKey?: number | string }) {
  const [prices, setPrices] = useState<PricePointDTO[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setPrices(undefined);
    setError(undefined);
    getPrices(entityId)
      .then((p) => { if (!cancelled) setPrices(p); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [entityId, refreshKey]);

  // Newest entry on top: createdAt desc, id tiebreak for same-timestamp rows.
  const sorted = prices
    ? [...prices].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    : undefined;

  return (
    <section className="card policy-history reval-price-history">
      <h3 className="policy-card-title">Price history</h3>
      {error && <p className="policy-bad">price history unavailable: {error}</p>}
      {!error && !sorted && <p>Loading price history…</p>}
      {sorted && sorted.length === 0 && <p>No prices entered yet.</p>}
      {sorted && sorted.length > 0 && (
        <ul className="policy-history-list">
          {sorted.map((p) => (
            <li key={p.id} className="policy-history-row">
              <div className="mono">
                {p.coinType} · as of {p.asOf} · {fmtMinor(p.priceMinor, FIAT_DECIMALS)} {p.quoteCurrency}
                {' · '}{p.source} · {p.level} · entered {p.createdAt}
                {p.superseded && <span className="policy-chip-deferred reval-superseded-chip">superseded</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
