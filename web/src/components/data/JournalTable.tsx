// DATA ZONE (spec §8.4) — NEVER import Mascot. Mono tabular figures do the
// "trustworthy finance" work; columns align, hashes read as hashes.
// amountMinor is a BigInt string — never parsed to float.
import type { JournalDTO } from '../../api/types';

function short(hash: string) {
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

/** Returns true iff sum of DEBIT amountMinor === sum of CREDIT amountMinor (BigInt). */
function isBalanced(lines: JournalDTO['je']['lines']): boolean {
  let debit = 0n;
  let credit = 0n;
  for (const l of lines) {
    const amt = BigInt(l.amountMinor);
    if (l.side === 'DEBIT') debit += amt;
    else credit += amt;
  }
  return debit === credit;
}

export function JournalTable({ journal }: { journal: JournalDTO[] }) {
  return (
    <div
      style={{
        border: '1px solid var(--paper-line)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
      }}
    >
      <table
        className="mono"
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}
      >
        <thead>
          <tr style={{ background: 'var(--navy-deep)', color: 'var(--austere-ink)' }}>
            <th style={{ textAlign: 'left', padding: 'var(--s-3)', fontWeight: 600 }}>JE</th>
            <th style={{ textAlign: 'left', padding: 'var(--s-3)', fontWeight: 600 }}>Account</th>
            <th style={{ textAlign: 'left', padding: 'var(--s-3)', fontWeight: 600 }}>Side</th>
            <th style={{ textAlign: 'right', padding: 'var(--s-3)', fontWeight: 600 }}>Amount (minor)</th>
            <th style={{ textAlign: 'left', padding: 'var(--s-3)', fontWeight: 600 }}>Coin</th>
            <th style={{ textAlign: 'left', padding: 'var(--s-3)', fontWeight: 600 }}>Leaf hash</th>
            <th style={{ textAlign: 'center', padding: 'var(--s-3)', fontWeight: 600 }}>Bal</th>
          </tr>
        </thead>
        <tbody>
          {journal.flatMap((j) => {
            const balanced = isBalanced(j.je.lines);
            return j.je.lines.map((l, li) => (
              <tr
                key={`${j.id}-${li}`}
                style={{ borderTop: '1px solid var(--paper-line)', height: 46, background: 'var(--paper-card)' }}
              >
                <td style={{ padding: 'var(--s-3)', color: 'var(--ink-soft)' }}>{li === 0 ? j.id : ''}</td>
                <td style={{ padding: 'var(--s-3)', color: 'var(--ink)' }}>{l.account}</td>
                <td
                  style={{
                    padding: 'var(--s-3)',
                    color: l.side === 'DEBIT' ? 'var(--debit)' : 'var(--credit)',
                    fontWeight: 600,
                  }}
                >
                  {l.side}
                </td>
                {/* Render amountMinor as a raw string — never parsed to number */}
                <td style={{ padding: 'var(--s-3)', textAlign: 'right', color: 'var(--ink)' }}>
                  {l.amountMinor}
                </td>
                <td style={{ padding: 'var(--s-3)', color: 'var(--ink-soft)' }}>
                  {l.origCoinType ? short(l.origCoinType) : '—'}
                </td>
                <td style={{ padding: 'var(--s-3)', color: 'var(--aqua)' }}>
                  {li === 0 ? short(j.leafHash) : ''}
                </td>
                <td style={{ padding: 'var(--s-3)', textAlign: 'center' }}>
                  {li === 0 ? (
                    balanced ? (
                      <span
                        title="balanced"
                        aria-label="balanced"
                        style={{ color: 'var(--credit)', fontSize: 16 }}
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        title="unbalanced"
                        aria-label="unbalanced"
                        style={{ color: 'var(--debit)', fontSize: 16 }}
                      >
                        ✗
                      </span>
                    )
                  ) : null}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
