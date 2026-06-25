// DATA ZONE (spec §8.4) — NEVER import Mascot here. Control-consistency matrix (§5).
import type { EventDTO, JournalDTO } from '../../api/types';
import { buildMatrix } from '../../lib/compareDims';

export function EventCompare({ events, journal, onOpenLineage }: {
  events: EventDTO[];
  journal: JournalDTO[];
  onOpenLineage?: (id: string) => void;
}) {
  const m = buildMatrix(events, journal);

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', marginBottom: 'var(--s-3)' }}>
        Comparing {m.shown.length}{m.truncated > 0 ? ` of ${m.shown.length + m.truncated}` : ''} selected
        {m.truncated > 0 && (
          <span style={{ marginLeft: 'var(--s-2)', padding: '1px 7px', borderRadius: 'var(--r-pill)', background: 'var(--brass-fill)' }}>
            +{m.truncated} more not shown
          </span>
        )}
      </div>
      <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 'var(--s-2)', color: 'var(--ink-soft)' }}>Dimension</th>
            {m.shown.map((e) => (
              <th key={e.id} style={{ textAlign: 'left', padding: 'var(--s-2)' }}>
                <button
                  aria-label={`Open lineage for ${e.id}`}
                  onClick={() => onOpenLineage?.(e.id)}
                  style={{ border: 'none', background: 'none', color: 'var(--brass)', fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
                >
                  {e.id} ↗
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.dimensions.map((d) => (
            <tr key={d.key} style={{ borderTop: '1px solid var(--paper-line)' }}>
              <td style={{ padding: 'var(--s-2)', color: 'var(--ink-soft)' }}>{d.label}</td>
              {d.cells.map((c, i) => {
                const cellDiffers = d.differs;
                return (
                  <td
                    key={i}
                    style={{
                      padding: 'var(--s-2)',
                      borderLeft: cellDiffers ? '1.5px solid var(--brass)' : '1.5px solid transparent',
                      fontWeight: cellDiffers ? 600 : 400,
                      color: 'var(--ink)',
                    }}
                  >
                    {cellDiffers && <span aria-hidden style={{ color: 'var(--brass)' }}>Δ </span>}
                    {cellDiffers && <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>differs</span>}
                    {c}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
