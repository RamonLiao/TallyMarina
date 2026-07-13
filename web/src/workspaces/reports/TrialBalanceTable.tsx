// DATA ZONE — trial balance evidence view. Mascot-free (§8.4). Amounts always fmtMinor(…,2)
// (functional currency is fiat-scaled), right-aligned, tabular-nums. closingMinor is fail-closed
// (spec D5): an unknown account class sends null on the wire, never a computed 0 — this view
// must render that as an explicit "— ?" and never coerce it into a number.
import { Table, type Column } from '../../components/ui/Table';
import type { TbRowDTO, TbTieOutDTO } from '../../api/types';
import { fmtMinor } from '../../lib/fmtMinor';

const FIAT_DECIMALS = 2;

function Amount({ minor }: { minor: string | null }) {
  if (minor === null) {
    return (
      <span
        style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', display: 'block' }}
        title="unknown account class — closing balance unknown (fail-closed)"
      >
        —<sup aria-hidden="true">?</sup>
      </span>
    );
  }
  return (
    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', display: 'block' }}>
      {fmtMinor(minor, FIAT_DECIMALS)}
    </span>
  );
}

export function TieOutBanner({ tieOut }: { tieOut: TbTieOutDTO }) {
  if (tieOut.balanced) {
    return (
      <div className="reports-banner reports-banner--pass" role="status">
        <strong>✓ PASS</strong> — ΣDr = ΣCr and Σclosing = 0.
      </div>
    );
  }
  return (
    <div className="reports-banner reports-banner--fail" role="alert">
      <strong>✗ FAIL</strong> — trial balance does not tie out:
      <ul>
        {tieOut.failures.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  );
}

export function TrialBalanceTable({ rows }: { rows: TbRowDTO[] }) {
  const columns: Column<TbRowDTO>[] = [
    { key: 'account', header: 'Account', render: (r) => r.account },
    { key: 'class', header: 'Class', render: (r) => r.accountClass ?? <span title="unknown class">unknown</span> },
    { key: 'opening', header: 'Opening', type: 'mono', render: (r) => <Amount minor={r.openingMinor} /> },
    { key: 'debit', header: 'Debit', type: 'mono', render: (r) => <Amount minor={r.debitMinor} /> },
    { key: 'credit', header: 'Credit', type: 'mono', render: (r) => <Amount minor={r.creditMinor} /> },
    { key: 'closing', header: 'Closing', type: 'mono', render: (r) => <Amount minor={r.closingMinor} /> },
  ];
  return (
    <Table columns={columns} rows={rows} getKey={(r) => r.account} label="Trial balance" />
  );
}
