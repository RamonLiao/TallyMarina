import './recon.css';
import type { ReconRowDTO } from '../../api/types';
import { computeBreak } from '../../lib/reconBreak';

const SYMBOLS: Record<string, string> = {
  '0x2::sui::SUI': 'SUI', '0xusdc::usdc::USDC': 'USDC', '0xweth::weth::WETH': 'WETH', '0xusdt::usdt::USDT': 'USDT',
};
function symbol(coinType: string): string { return SYMBOLS[coinType] ?? coinType.split('::').pop() ?? coinType; }
function shortAddr(a: string): string { return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a; }

export function fmtMinor(minor: string, decimals: number): string {
  const neg = minor.startsWith('-');
  const digits = (neg ? minor.slice(1) : minor).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals) || '0';
  const frac = decimals > 0 ? '.' + digits.slice(digits.length - decimals) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${grouped}${frac}`;
}

export function fmtBreak(minor: string, decimals: number): string {
  const zero = minor === '0' || minor === '-0' || /^-?0+$/.test(minor);
  const formatted = fmtMinor(minor, decimals);
  if (zero) return formatted;
  return minor.startsWith('-') ? formatted : `+${formatted}`;
}
const DIR_LABEL = { 'book-over': 'book over statement', 'statement-over': 'statement over book', balanced: 'balanced' } as const;

export function ReconTable({ rows, selectedKey, onSelect }: { rows: ReconRowDTO[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  return (
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
          const b = computeBreak(r.computedMinor, r.statementMinor, r.thresholdMinor);
          const cls = b.material ? 'recon-row recon-row--material' : 'recon-row';
          return (
            <tr key={key} className={`${cls}${selectedKey === key ? ' is-selected' : ''}`} onClick={() => onSelect(key)}>
              <td data-label="Wallet · Asset"><span title={r.wallet}>{shortAddr(r.wallet)}</span> · <strong title={r.coinType}>{symbol(r.coinType)}</strong></td>
              <td data-label="Opening" className="td--mono">{fmtMinor(r.openingMinor, r.decimals)}<sup>B</sup></td>
              <td data-label="+ Movements" className="td--mono">{fmtMinor(r.movementMinor, r.decimals)}</td>
              <td data-label="= Computed" className="td--mono">{fmtMinor(r.computedMinor, r.decimals)}<sup>B</sup></td>
              <td data-label="Statement" className="td--mono">{fmtMinor(r.statementMinor, r.decimals)}<sup>M</sup></td>
              <td data-label="Break" className="td--mono">
                {b.direction === 'balanced'
                  ? <span className="brk brk--ok" aria-label="balanced">{fmtBreak(r.breakMinor, r.decimals)} ✓</span>
                  : <><span className={`brk ${b.material ? 'brk--material' : 'brk--immaterial'}`} aria-label={b.material ? 'material break' : 'immaterial break'}>
                      {fmtBreak(r.breakMinor, r.decimals)} {b.material ? '⛔' : '⚠'}
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
  );
}
