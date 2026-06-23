// web/src/workspaces/recon/ReconDetail.tsx
import { useState } from 'react';
import type { ReconRowDTO } from '../../api/types';
import { fmtMinor } from './ReconTable';
import { computeBreak, RECON_REASON_CODES, encodeReconBreakId, type ReconReasonCode } from '../../lib/reconBreak';
import { useChainBalance } from '../../data/useChainBalance';
import { API_BASE } from '../../api/client';

export function ReconDetail({
  row,
  realWallet,
  anchored,
  onDisposed,
  clientMovements = {},
}: {
  row: ReconRowDTO;
  realWallet: string | null;
  anchored: boolean;
  onDisposed: () => void;
  clientMovements?: Record<string, bigint>;
}) {
  const key = `${row.wallet}|${row.coinType}`;
  const clientMovement = clientMovements[key] ?? 0n;
  const clientComputed = BigInt(row.openingMinor) + clientMovement;
  const dtoMovement = BigInt(row.movementMinor);
  const hasDrift = clientMovement !== dtoMovement;

  const b = computeBreak(clientComputed.toString(), row.statementMinor, row.thresholdMinor);
  const clientBreak = clientComputed - BigInt(row.statementMinor);
  const chain = useChainBalance(row.coinType === '0x2::sui::SUI' ? realWallet : null, row.coinType);
  const [reasonCode, setReasonCode] = useState<ReconReasonCode>('error');
  const [reasonNote, setReasonNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function dispose(state: 'resolved' | 'dismissed' | 'deferred') {
    setBusy(true); setErr(undefined);
    try {
      const breakId = encodeURIComponent(encodeReconBreakId(row.wallet, row.coinType));
      const res = await fetch(`${API_BASE}/recon-breaks/${breakId}/disposition`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, reasonCode, reasonNote: reasonNote || null }),
      });
      if (!res.ok) throw new Error((await res.json())?.error?.message ?? `disposition ${res.status}`);
      onDisposed();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const d = (m: string) => fmtMinor(m, row.decimals);
  const dBig = (v: bigint) => fmtMinor(v.toString(), row.decimals);
  return (
    <section className="recon-detail">
      {anchored && <div className="recon-anchored-ribbon">Period anchored — reconciliation read-only ⚓</div>}
      {hasDrift && (
        <div className="drift-warn drift-warn--banner" role="alert" aria-label="evidence drift">
          ⚠ evidence drift — browser recomputed {clientMovement.toString()} ≠ backend {row.movementMinor}
        </div>
      )}
      <h3>{row.coinType} · {row.wallet}</h3>
      <table className="recon-eq td--mono">
        <tbody>
          <tr><td>Opening balance (book)</td><td>{d(row.openingMinor)}<sup>B</sup></td></tr>
          <tr>
            <td>+ Movements (Σ {row.control.legs} legs)</td>
            <td>
              {dBig(clientMovement)}
              {hasDrift && (
                <span className="drift-warn" aria-label="evidence drift">
                  {' '}⚠ browser≠backend
                </span>
              )}
            </td>
          </tr>
          <tr className="recon-eq-rule"><td>= Computed ending (book)</td><td>{dBig(clientComputed)}<sup>B</sup></td></tr>
          <tr><td>Statement ending (mock)</td><td>{d(row.statementMinor)}<sup>M</sup></td></tr>
          <tr className="recon-eq-rule"><td>Break (computed − statement)</td><td>{dBig(clientBreak)} {b.material ? '⛔' : b.direction === 'balanced' ? '✓' : '⚠'}</td></tr>
          <tr><td colSpan={2} className="recon-eq-note">threshold ±{d(row.thresholdMinor)} · {b.material ? '|break| ≥ threshold → blocking' : 'within tolerance'}</td></tr>
          <tr><td colSpan={2} className="recon-eq-note">control: Σdebit {d(row.control.debitMinor)} · Σcredit {d(row.control.creditMinor)} · leg count: {row.control.legs}</td></tr>
          <tr>
            <td>Chain ending (live)</td>
            <td>
              {chain.state === 'live'
                ? <span className="prov--live">{d(chain.balanceMinor ?? '0')}<sup>L</sup></span>
                : chain.state === 'unavailable'
                  ? <span className="prov--unavail">unavailable ↻</span>
                  : 'n/a'}
            </td>
          </tr>
        </tbody>
      </table>

      {!anchored && b.material && (
        <div className="recon-disp">
          <label>Classification:&nbsp;
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as ReconReasonCode)}>
              {RECON_REASON_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {reasonCode === 'OTHER' && (
            <input placeholder="note (required)" value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
          )}
          <div className="recon-disp-actions">
            <button disabled={busy || (reasonCode === 'OTHER' && !reasonNote)} onClick={() => dispose('resolved')}>Resolve</button>
            <button disabled={busy} onClick={() => dispose('deferred')}>Defer</button>
            <button disabled={busy || (reasonCode === 'OTHER' && !reasonNote)} onClick={() => dispose('dismissed')}>Dismiss</button>
          </div>
          {err && <p className="recon-err" role="alert">{err}</p>}
        </div>
      )}
    </section>
  );
}
