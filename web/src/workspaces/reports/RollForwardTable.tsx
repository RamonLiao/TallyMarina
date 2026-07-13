// DATA ZONE — ASU 2023-08 roll-forward evidence view. Mascot-free (§8.4). Two identities are
// evidence, not decoration: ① per-coin (openingFV + additions − disposals + gains − losses ==
// closingFV) and ② TB tie (Σ per-coin closingFV == DigitalAssets GL balance). Both render as
// explicit PASS/FAIL rows — never colour-only (spec §15 rule: status must carry a non-colour
// cue too).
import { Table, type Column } from '../../components/ui/Table';
import type { RollForwardResponseDTO, RollForwardRowDTO } from '../../api/types';
import { fmtMinor } from '../../lib/fmtMinor';

const FIAT_DECIMALS = 2;

function Amount({ minor }: { minor: string }) {
  return (
    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', display: 'block' }}>
      {fmtMinor(minor, FIAT_DECIMALS)}
    </span>
  );
}

function IdentityBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`reports-banner ${ok ? 'reports-banner--pass' : 'reports-banner--fail'}`} role={ok ? 'status' : 'alert'}>
      <strong>{ok ? '✓ PASS' : '✗ FAIL'}</strong> — {label}
    </div>
  );
}

export function RollForwardTable({ data }: { data: RollForwardResponseDTO }) {
  if (data.notApplicable) {
    return (
      <div className="reports-banner reports-banner--na" role="status">
        <strong>ℹ N/A</strong> — roll-forward does not apply under {data.reason ?? 'this accounting standard'}.
      </div>
    );
  }

  const columns: Column<RollForwardRowDTO>[] = [
    { key: 'coinType', header: 'Coin', render: (r) => r.coinType },
    { key: 'opening', header: 'Opening FV', type: 'mono', render: (r) => <Amount minor={r.openingFvMinor} /> },
    { key: 'additions', header: 'Additions', type: 'mono', render: (r) => <Amount minor={r.additionsMinor} /> },
    { key: 'disposals', header: 'Disposals', type: 'mono', render: (r) => <Amount minor={r.disposalsMinor} /> },
    { key: 'gains', header: 'Gains', type: 'mono', render: (r) => <Amount minor={r.gainsMinor} /> },
    { key: 'losses', header: 'Losses', type: 'mono', render: (r) => <Amount minor={r.lossesMinor} /> },
    { key: 'closing', header: 'Closing FV', type: 'mono', render: (r) => <Amount minor={r.closingFvMinor} /> },
    {
      key: 'identity',
      header: 'Identity ①',
      render: (r) => (
        <span>{r.identityOk ? '✓ PASS' : '✗ FAIL'}</span>
      ),
    },
  ];

  return (
    <div className="reports-rollforward">
      <Table columns={columns} rows={data.rows} getKey={(r) => r.coinType} label="Roll-forward" />
      {data.tbTie && (
        <IdentityBadge
          ok={data.tbTie.ok}
          label={`Identity ② — TB tie: Σ closing FV (${fmtMinor(data.tbTie.closingFvTotalMinor, FIAT_DECIMALS)}) vs DigitalAssets GL (${fmtMinor(data.tbTie.digitalAssetsClosingMinor, FIAT_DECIMALS)})`}
        />
      )}
    </div>
  );
}
