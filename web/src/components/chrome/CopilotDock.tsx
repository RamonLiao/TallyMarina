// §8.5 — mascot-as-AI-copilot, executed as an *agent* (docked, not Clippy).
// The otter avatar is the SPEAKER LABEL (chrome). The substance below is plain
// structured DATA (red flags / suggested entry carry NO mascot).
import type { CopilotAdvice } from '../../api/types';
import { Mascot, type MascotPose } from './Mascot';

export function CopilotDock({
  advice, loading, pose,
}: { advice: CopilotAdvice | null; loading: boolean; pose: MascotPose }) {
  return (
    <aside
      aria-label="AI Copilot dock"
      className="card copilot-dock"
      style={{ padding: 'var(--s-4)', position: 'sticky', top: 'var(--s-4)', width: 360, alignSelf: 'flex-start' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', marginBottom: 'var(--s-3)' }}>
        <Mascot pose={loading ? 'thinking' : pose} size={40} />
        <strong className="font-display" style={{ fontSize: 'var(--text-lg)' }}>Copilot</strong>
      </div>

      {loading && <p className="font-body" style={{ color: 'var(--ink-soft)', marginTop: 'var(--s-3)' }}>Reading the transaction…</p>}

      {!advice && !loading && (
        <p className="font-body" style={{ color: 'var(--ink-soft)', marginTop: 'var(--s-3)', fontSize: 'var(--text-sm)' }}>
          Select an event and click "Ask copilot" to get AI analysis.
        </p>
      )}

      {advice && !loading && (
        <div style={{ display: 'grid', gap: 'var(--s-4)', marginTop: 'var(--s-3)' }}>
          <section>
            <h3 style={{ margin: '0 0 var(--s-1)', fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-soft)' }}>Explanation</h3>
            <p className="font-body" style={{ margin: 0, fontSize: 'var(--text-base)' }}>{advice.explanation}</p>
          </section>
          {advice.redFlags.length > 0 && (
            <section>
              <h3 style={{ margin: '0 0 var(--s-1)', fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--debit)' }}>Red Flags</h3>
              {/* DATA — no mascot */}
              <ul style={{ margin: 0, paddingLeft: 'var(--s-4)' }}>
                {advice.redFlags.map((f, i) => <li key={i} className="font-body" style={{ fontSize: 'var(--text-base)', color: 'var(--debit)' }}>{f}</li>)}
              </ul>
            </section>
          )}
          {advice.suggestedEntry && (
            <section>
              <h3 style={{ margin: '0 0 var(--s-1)', fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-soft)' }}>Suggested Entry (draft)</h3>
              <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                <tbody>
                  {advice.suggestedEntry.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: '2px 0' }}>{l.account}</td>
                      <td style={{ color: l.side === 'DEBIT' ? 'var(--debit)' : 'var(--credit)' }}>{l.side}</td>
                      <td style={{ textAlign: 'right' }}>{l.amountMinor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {advice.citations.length > 0 && (
            <section>
              <h3 style={{ margin: '0 0 var(--s-1)', fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-soft)' }}>Citations</h3>
              <ul style={{ margin: 0, paddingLeft: 'var(--s-4)' }}>
                {advice.citations.map((c, i) => <li key={i} className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)' }}>{c}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
