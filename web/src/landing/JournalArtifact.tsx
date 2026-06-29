import { sampleEntry, totals } from './sampleEntry';

const fmt = (n: number) =>
  n === 0 ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const truncate = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export function JournalArtifact() {
  const { debit, credit } = totals(sampleEntry.lines);
  return (
    <figure className="landing-journal" aria-label="Example journal entry generated from a Sui transaction">
      <div className="landing-journal__src">
        <span className="landing-journal__label">Sui tx</span>
        <code className="landing-journal__hash">{truncate(sampleEntry.txDigest)}</code>
      </div>
      <div className="landing-journal__memo">{sampleEntry.memo}</div>
      <table className="landing-journal__table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col" className="num">Debit</th>
            <th scope="col" className="num">Credit</th>
          </tr>
        </thead>
        <tbody>
          {sampleEntry.lines.map((l) => (
            <tr key={l.account}>
              <td>{l.account}</td>
              <td className="num dr">{fmt(l.debit)}</td>
              <td className="num cr">{fmt(l.credit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Balanced</td>
            <td className="num dr">{fmt(debit)}</td>
            <td className="num cr">{fmt(credit)}</td>
          </tr>
        </tfoot>
      </table>
    </figure>
  );
}
