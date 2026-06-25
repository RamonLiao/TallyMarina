import type { CoaRuleDTO } from '../../api/types';
import './policy.css';

interface Props {
  rules: CoaRuleDTO[];
  defaultAccount: string;
  title: string;
  editable?: boolean;
  onChange?: (rules: CoaRuleDTO[]) => void;
}

export function CoaMappingTable({ rules, defaultAccount, title, editable, onChange }: Props) {
  const setAccount = (idx: number, account: string) => {
    if (!onChange) return;
    onChange(rules.map((r, i) => (i === idx ? { ...r, account } : r)));
  };
  return (
    <section className="card policy-coa">
      <h3 className="policy-card-title">{title}</h3>
      <div className="policy-coa-scroll">
      <table className="policy-coa-table">
        <thead>
          <tr>
            <th>Event type</th>
            <th>Leg</th>
            <th>Account</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={`${r.eventType}/${r.leg}`}>
              <td className="mono">{r.eventType}</td>
              <td className="mono">{r.leg}</td>
              <td className="mono">
                {editable
                  ? <input
                      className="policy-coa-input"
                      value={r.account}
                      onChange={(e) => setAccount(i, e.target.value)}
                      aria-label={`account for ${r.eventType} ${r.leg}`}
                    />
                  : r.account}
              </td>
            </tr>
          ))}
          <tr className="policy-coa-default">
            <td className="mono">— default —</td>
            <td className="mono">*</td>
            <td className="mono">{defaultAccount}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </section>
  );
}
