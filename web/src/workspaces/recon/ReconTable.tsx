import './recon.css';
import type { ReconRowDTO, BreakPrecision } from '../../api/types';
import { computeBreak } from '../../lib/reconBreak';

const SYMBOLS: Record<string, string> = {
  '0x2::sui::SUI': 'SUI', '0xbeef::usdc::USDC': 'USDC', '0xcafe::weth::WETH': 'WETH', '0xdead::usdt::USDT': 'USDT',
};
function symbol(coinType: string): string { return SYMBOLS[coinType] ?? coinType.split('::').pop() ?? coinType; }
function shortAddr(a: string): string { return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a; }

export function fmtMinor(minor: string, decimals: number): string {
  // The scale is NOT allowed to default. null/undefined/float coerces via `null + 1 === 1` into a
  // wrong scale for free — 5000000000 prints "5,000,000,000" instead of "5,000.000000", off by 1e6,
  // with no `??` anywhere. The wire type is decimals:number|null; a source-scan guard cannot see the
  // coercion, only this runtime check can. Callers holding a null scale must render raw minor units.
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`fmtMinor: scale must be a non-negative integer, got ${String(decimals)}`);
  }
  const neg = minor.startsWith('-');
  const digits = (neg ? minor.slice(1) : minor).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals) || '0';
  const frac = decimals > 0 ? '.' + digits.slice(digits.length - decimals) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${grouped}${frac}`;
}

// An amount whose asset has no registered scale: render RAW minor units, never fmtMinor. The sup "?"
// and the title flag that the displayed integer is minor units, not a whole-unit reading.
function Amount({ minor, decimals, sup }: { minor: string; decimals: number | null; sup?: string }) {
  if (decimals === null) {
    return (
      <span className="mono amt--unscaled" title="scale unknown — asset not registered">
        {minor}<sup aria-hidden="true">?</sup>
      </span>
    );
  }
  return <>{fmtMinor(minor, decimals)}{sup ? <sup>{sup}</sup> : null}</>;
}

// Accessible description of where the break stops being zero. Information, not verdict (spec D9).
function profileLabel(p: BreakPrecision): string {
  if (p.exactlyZero) return 'exactly flat';
  if (p.flatToDecimal === null) return 'whole-unit break — not rounding';
  return `flat to decimal ${p.flatToDecimal}; unflat from decimal ${p.firstSignificantDecimal}`;
}

// The break value with its precision profile: the flat (leading-zero) run dimmed, the significant
// run at full ink + bold. Weight and ink ONLY — never semantic colour. The verdict (material/
// immaterial/balanced) lives on the sibling marker, so the two never double-signal (spec §7.2).
function BreakProfileNumber({ text, precision }: { text: string; precision: BreakPrecision | null }) {
  if (precision === null) return <span className="brk-profile">{text}</span>;
  const dot = text.indexOf('.');
  const cut = dot < 0 || precision.flatToDecimal === null ? text.length : dot + 1 + precision.flatToDecimal;
  return (
    <span className="brk-profile">
      <span className="brk-profile__flat">{text.slice(0, cut)}</span>
      <span className="brk-profile__sig">{text.slice(cut)}</span>
    </span>
  );
}

export function fmtBreak(minor: string, decimals: number): string {
  const zero = minor === '0' || minor === '-0' || /^-?0+$/.test(minor);
  const formatted = fmtMinor(minor, decimals);
  if (zero) return formatted;
  return minor.startsWith('-') ? formatted : `+${formatted}`;
}
const DIR_LABEL = { 'book-over': 'book over statement', 'statement-over': 'statement over book', balanced: 'balanced' } as const;

export function ReconTable({
  rows,
  selectedKey,
  onSelect,
  clientMovements = {},
}: {
  rows: ReconRowDTO[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  clientMovements?: Record<string, bigint>;
}) {
  return (
    <div className="recon-tablewrap">
    <table className="recon-table">
      <thead>
        <tr>
          <th>Wallet · Asset</th><th>Opening</th><th>+ Movements</th><th>= Computed</th>
          <th>Statement</th><th>Break</th><th>Chain</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const key = `${r.wallet}|${r.coinType}`;
          const clientMovement = clientMovements[key] ?? 0n;
          const clientComputed = BigInt(r.openingMinor) + clientMovement;
          const dtoMovement = BigInt(r.movementMinor);
          const hasDrift = clientMovement !== dtoMovement;
          const b = computeBreak(clientComputed.toString(), r.statementMinor, r.thresholdMinor);
          const clientBreak = (clientComputed - BigInt(r.statementMinor)).toString();
          const descId = `brkprof-${key}`;
          // Unregistered assets carry the same red left rail as material breaks: an unknown scale
          // blocks close (backend unregisteredAssetBlockers), so the row must read as actionable.
          const cls = (b.material || r.unregisteredAsset) ? 'recon-row recon-row--material' : 'recon-row';
          return (
            <tr key={key} className={`${cls}${selectedKey === key ? ' is-selected' : ''}`} onClick={() => onSelect(key)}>
              <td data-label="Wallet · Asset">
                <span title={r.wallet}>{shortAddr(r.wallet)}</span> · <strong title={r.coinType}>{symbol(r.coinType)}</strong>
                {r.unregisteredAsset && (
                  <> <span className="recon-pill--unregistered">⛔ Unregistered</span> <span className="amt--unscaled">scale unknown</span></>
                )}
              </td>
              <td data-label="Opening" className="td--mono"><Amount minor={r.openingMinor} decimals={r.decimals} sup="B" /></td>
              <td data-label="+ Movements" className="td--mono">
                <Amount minor={clientMovement.toString()} decimals={r.decimals} />
                {hasDrift && (
                  <span className="drift-warn" role="alert" aria-label="evidence drift">
                    {' '}⚠ evidence drift — browser recomputed {clientMovement.toString()} ≠ backend {r.movementMinor}
                  </span>
                )}
              </td>
              <td data-label="= Computed" className="td--mono"><Amount minor={clientComputed.toString()} decimals={r.decimals} sup="B" /></td>
              <td data-label="Statement" className="td--mono"><Amount minor={r.statementMinor} decimals={r.decimals} sup="M" /></td>
              <td data-label="Break" className="td--mono">
                {r.decimals === null
                  ? <Amount minor={clientBreak} decimals={null} />
                  : b.direction === 'balanced'
                  ? <span className="brk brk--ok" aria-label="balanced" aria-describedby={descId}>
                      {/* precision describes r.breakMinor (server-computed), not clientBreak. On drift,
                          those two numbers differ, so precision would dim the wrong digits of the
                          client's number — same class of bug as `?? 9` reading asset A's scale onto
                          asset B's amount. We don't have a precision profile for the client number, and
                          web must not re-derive breakPrecision (that's a second implementation of
                          server logic — see reconMovements.ts OPENING_LOT incident). Not knowing beats
                          guessing: fall back to plain text, sighted and SR alike, until drift clears. */}
                      <BreakProfileNumber text={fmtBreak(clientBreak, r.decimals)} precision={hasDrift ? null : r.precision} />{' '}<span aria-hidden="true">✓</span>
                      <span id={descId} className="recon-sr-only">{!hasDrift && r.precision ? profileLabel(r.precision) : ''}</span>
                    </span>
                  : <><span className="brk brk--verdict" aria-label={b.material ? 'material break' : 'immaterial break'} aria-describedby={descId}>
                      {/* Same drift guard as the balanced branch above — see comment there. */}
                      <BreakProfileNumber text={fmtBreak(clientBreak, r.decimals)} precision={hasDrift ? null : r.precision} />{' '}
                      <span className={b.material ? 'brk--material' : 'brk--immaterial'} aria-hidden="true">{b.material ? '⛔' : '⚠'}</span>
                      {/* KNOWN GAP (Task 12): this span sits inside a wrapper with its own aria-label.
                          Some screen readers may re-announce this text on top of the wrapper label —
                          unverified without a real SR (VoiceOver/NVDA) walkthrough in a real browser. */}
                      <span id={descId} className="recon-sr-only">{!hasDrift && r.precision ? profileLabel(r.precision) : ''}</span>
                    </span>{' '}<em className="brk-dir">({DIR_LABEL[b.direction]})</em></>}
              </td>
              <td data-label="Chain" className="td--mono recon-chain">
                {r.provenance.chain === 'live'
                  ? <span className="prov--live">live<sup>↗</sup></span>
                  : r.provenance.chain === 'n/a'
                  ? <span className="prov--na">—</span>
                  : <span className="prov--unavailable">↻ unavailable</span>}
              </td>
              <td data-label="Status">{r.disposition ? r.disposition.state : (b.material ? 'open' : '—')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
