import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../../api/client';
import './AssetRegistryPanel.css';

// Local mirror of services/api/src/assets/store.ts AssetRow. Kept local on purpose: the API
// service is a separate package and read-only from here. NOTE: there is no chainObjectVersion —
// the proto CoinMetadata carries no object version (see makeGrpcCoinInfoFetcher). The re-
// verification anchor is metadataCapState instead.
type MetadataCapState = 'UNKNOWN' | 'CLAIMED' | 'UNCLAIMED' | 'DELETED';
interface AssetRow {
  entityId: string; coinType: string; decimals: number;
  symbol: string; displayName: string; source: 'chain' | 'manual';
  chainObjectId: string | null; metadataCapState: MetadataCapState | null; fetchedAt: string | null;
  decidedBy: string | null; reason: string | null; createdAt: string;
}

// Exact copy — the last human-facing defence against V6. Keyed on the response envelope `code`.
const ERR: Record<string, string> = {
  INVALID_COIN_TYPE: 'Not a valid coin type. Expected 0x…::module::TYPE.',
  NAMED_PACKAGE_UNSUPPORTED: 'Named packages (app@org::…) aren’t supported. Use the resolved 0x… address.',
  MANUAL_DECIMALS_REQUIRED: 'No on-chain metadata found. Enter decimals, symbol and a reason to register manually.',
  CHAIN_DECIMALS_MISMATCH: 'On-chain metadata disagrees with your override. Chain wins — drop the override or fix it.',
  ASSET_DECIMALS_CONFLICT: 'Already registered at different decimals. Decimals can’t be changed — this needs a restatement.',
  ASSET_IN_USE: 'This asset already has entries posted. Correction requires a restatement.',
  CHAIN_UNREACHABLE: 'Couldn’t reach the Sui node. This is not the same as "no metadata" — retry before registering manually.',
  CHAIN_CLIENT_UNAVAILABLE: 'The server has no Sui client configured. Registration is unavailable.',
};
const EMPTY = 'No assets registered yet. Every asset your books touch must be registered before close.';
const IDEMPOTENT = 'Already registered — no change.';
// A timed-out probe is a slow node, never proof of absence. Same defence as CHAIN_UNREACHABLE.
const TIMEOUT_MSG =
  'The probe timed out before the Sui node answered. A slow node is not the same as "no metadata" — retry before registering manually.';

const PROBE_TIMEOUT_MS = 15_000;
const MIN_REASON_LENGTH = 12; // mirrors services/api MIN_REASON_LENGTH
// decimals is a bounded metadata integer (0-36), not a monetary quantity, so this is the one
// place a numeric parse is legitimate — the global BigInt/string rule guards amount arithmetic.
const DECIMALS_RE = /^([0-9]|[12][0-9]|3[0-6])$/;

function fallbackMsg(code: string): string {
  return `Registration failed (${code}).`;
}
function errMsg(code: string): string {
  return ERR[code] ?? fallbackMsg(code);
}

function envelopeCode(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const e = (body as { error?: { code?: unknown } }).error;
    if (e && typeof e.code === 'string') return e.code;
  }
  return undefined;
}

type PostResult =
  | { kind: 'ok'; status: number; row: AssetRow }
  | { kind: 'err'; code: string }
  | { kind: 'timeout' };

async function postAsset(entityId: string, body: Record<string, unknown>): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === 'AbortError' || name === 'TimeoutError') return { kind: 'timeout' };
    // A fetch rejection is the network refusing the connection — genuinely "couldn't reach the
    // node", and CRITICALLY not "no metadata". Route it through the same 503 copy, never manual.
    return { kind: 'err', code: 'CHAIN_UNREACHABLE' };
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
  if (res.ok) return { kind: 'ok', status: res.status, row: parsed as AssetRow };
  return { kind: 'err', code: envelopeCode(parsed) ?? 'HTTP_ERROR' };
}

function trunc(s: string): string {
  return s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s;
}

type Phase = 'idle' | 'probing' | 'chain-hit' | 'manual-required' | 'submitting' | 'error';

export function AssetRegistryPanel({ entityId }: { entityId: string }): JSX.Element {
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [coinType, setCoinType] = useState('');
  const [chainRow, setChainRow] = useState<AssetRow | null>(null);
  const [chainStatus, setChainStatus] = useState<number>(201);
  const [decimals, setDecimals] = useState('');
  const [symbol, setSymbol] = useState('');
  const [reason, setReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/assets`);
      if (!res.ok) { setListError('Could not load the asset registry.'); return; }
      const body = JSON.parse(await res.text()) as { assets: AssetRow[] };
      setAssets(body.assets);
      setListError(null);
    } catch {
      setListError('Could not load the asset registry.');
    }
  }, [entityId]);

  useEffect(() => { void loadList(); }, [loadList]);

  function reset(): void {
    setPhase('idle');
    setCoinType('');
    setChainRow(null);
    setDecimals('');
    setSymbol('');
    setReason('');
    setErrorMsg(null);
  }

  function applyResult(r: PostResult): void {
    if (r.kind === 'timeout') { setErrorMsg(TIMEOUT_MSG); setPhase('error'); return; }
    if (r.kind === 'err') {
      // The one and only door to the manual branch: a genuine "chain has no metadata" 400.
      // Everything else — including every 503 and every transport failure — stays in error.
      if (r.code === 'MANUAL_DECIMALS_REQUIRED') { setPhase('manual-required'); return; }
      setErrorMsg(errMsg(r.code));
      setPhase('error');
      return;
    }
    setChainRow(r.row);
    setChainStatus(r.status);
    setPhase('chain-hit');
  }

  async function onProbe(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!coinType.trim()) return;
    setErrorMsg(null);
    setPhase('probing');
    applyResult(await postAsset(entityId, { coinType: coinType.trim() }));
  }

  async function onConfirmChain(): Promise<void> {
    if (chainStatus === 201) await loadList();
    else await loadList(); // 200 idempotent — list already has it, refresh anyway
    reset();
  }

  const manualValid =
    DECIMALS_RE.test(decimals) && symbol.trim().length > 0 && reason.trim().length >= MIN_REASON_LENGTH;

  async function onSubmitManual(): Promise<void> {
    if (!manualValid) return;
    setPhase('submitting');
    const r = await postAsset(entityId, {
      coinType: coinType.trim(),
      // Legitimate numeric parse: decimals is validated 0-36 above, not a monetary amount.
      decimals: Number(decimals),
      symbol: symbol.trim(),
      reason: reason.trim(),
    });
    if (r.kind === 'ok') { await loadList(); reset(); return; }
    applyResult(r);
  }

  return (
    <section className="ar-panel">
      <h3 className="ob-card-title">Asset registry</h3>
      <p className="ob-card-note">
        Every coin your books touch is registered here with its decimal scale — sourced from
        on-chain CoinMetadata, or disclosed as a human claim when the chain carries none.
      </p>

      {listError && <p className="ar-err">{listError}</p>}

      {assets !== null && assets.length === 0 && <p className="ob-card-note">{EMPTY}</p>}

      {assets !== null && assets.length > 0 && (
        <table className="ar-table">
          <thead>
            <tr><th>Asset</th><th>Decimals</th><th>Provenance</th></tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.coinType}>
                <td data-label="Asset">
                  <span className="ar-sym">{a.symbol}</span>{' '}
                  <span className="td--mono ar-coin" title={a.coinType}>{trunc(a.coinType)}</span>
                </td>
                <td data-label="Decimals">{a.decimals}</td>
                <td data-label="Provenance">
                  {a.source === 'chain' ? (
                    <span
                      className="ar-pill ar-pill--chain"
                      title={`CoinMetadata ${a.chainObjectId} · cap ${a.metadataCapState} · fetched ${a.fetchedAt}`}
                    >
                      ↗ chain-verified
                    </span>
                  ) : (
                    <span
                      className="ar-pill ar-pill--manual"
                      title={`declared by ${a.decidedBy} · ${a.reason}`}
                    >
                      ✎ manual · unverified
                    </span>
                  )}
                  {a.source === 'chain' &&
                    (a.metadataCapState === 'CLAIMED' || a.metadataCapState === 'UNCLAIMED') && (
                      <span
                        className="ar-reserved"
                        title="metadata cap not burned — a holder can still change this coin's metadata, so the chain-verified scale is time-sensitive"
                      >
                        {' · revocable'}
                      </span>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(phase === 'idle' || phase === 'probing') && (
        <form className="ar-form" onSubmit={(e) => { void onProbe(e); }}>
          <label className="ar-label" htmlFor="ar-cointype">Coin type</label>
          <input
            id="ar-cointype"
            className="ar-input td--mono"
            placeholder="0x…::module::TYPE"
            value={coinType}
            disabled={phase === 'probing'}
            onChange={(e) => setCoinType(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={phase === 'probing' || !coinType.trim()}>
            Probe
          </button>
          {phase === 'probing' && (
            <p className="ar-status" role="status">
              <span className="ar-spinner" aria-hidden="true" /> Fetching CoinMetadata on-chain…
            </p>
          )}
        </form>
      )}

      {phase === 'chain-hit' && chainRow && (
        <div className="ar-result" data-testid="ar-chain-hit">
          <p className="ar-result-head">On-chain metadata found for <span className="td--mono">{trunc(chainRow.coinType)}</span>.</p>
          <div className="ar-defrow">
            <span className="ar-label">Decimals</span>
            <output className="ar-readonly">{chainRow.decimals}</output>
            <span className="ar-pill ar-pill--chain">↗ chain-verified</span>
          </div>
          <div className="ar-defrow">
            <span className="ar-label">CoinMetadata</span>
            <span className="td--mono">{chainRow.chainObjectId}</span>
          </div>
          {chainStatus === 200 && <p className="ob-card-note">{IDEMPOTENT}</p>}
          <div className="ar-actions">
            <button className="btn-primary" onClick={() => { void onConfirmChain(); }}>Confirm</button>
            <button className="btn-ghost" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {(phase === 'manual-required' || phase === 'submitting') && (
        <div className="ar-manual">
          <p className="ob-card-note">
            {ERR.MANUAL_DECIMALS_REQUIRED} You are registering{' '}
            <span className="td--mono">{trunc(coinType.trim())}</span> as a{' '}
            <span className="ar-pill ar-pill--manual">✎ manual · unverified</span> asset.
          </p>
          <div className="ar-field">
            <label className="ar-label" htmlFor="ar-decimals">Decimals</label>
            <input
              id="ar-decimals" className="ar-input" inputMode="numeric" value={decimals}
              disabled={phase === 'submitting'} onChange={(e) => setDecimals(e.target.value)}
            />
            {decimals.length > 0 && !DECIMALS_RE.test(decimals) && (
              <span className="ar-hint">Whole number, 0–36.</span>
            )}
          </div>
          <div className="ar-field">
            <label className="ar-label" htmlFor="ar-symbol">Symbol</label>
            <input
              id="ar-symbol" className="ar-input" value={symbol}
              disabled={phase === 'submitting'} onChange={(e) => setSymbol(e.target.value)}
            />
          </div>
          <div className="ar-field">
            <label className="ar-label" htmlFor="ar-reason">Reason</label>
            <textarea
              id="ar-reason" className="ar-input" rows={2} value={reason}
              disabled={phase === 'submitting'} onChange={(e) => setReason(e.target.value)}
            />
            <span className="ar-hint">
              Why this scale is trustworthy without the chain ({reason.trim().length}/{MIN_REASON_LENGTH} min).
            </span>
          </div>
          <div className="ar-actions">
            <button
              className="btn-primary"
              disabled={phase === 'submitting' || !manualValid}
              onClick={() => { void onSubmitManual(); }}
            >
              {phase === 'submitting' ? 'Registering…' : 'Confirm'}
            </button>
            <button className="btn-ghost" disabled={phase === 'submitting'} onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="ar-errbox">
          <p className="ar-err">{errorMsg}</p>
          <button className="btn-ghost" onClick={reset}>Try another coin type</button>
        </div>
      )}
    </section>
  );
}
