// §8.4 SINGLE MOST IMPORTANT BOUNDARY — this view must look like an austere block
// explorer (mono digests, aqua links, navy). NEVER import Mascot here.
import type { AnchorDTO, InclusionProof } from '../../api/types';

const EXPLORER_BASE = import.meta.env.VITE_EXPLORER_BASE as string | undefined;

function short(h: string) { return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h; }

function explorerHref(a: AnchorDTO) {
  return EXPLORER_BASE ? `${EXPLORER_BASE}/tx/${a.digest}` : (a.explorerUrl ?? '#');
}

export function HashChain({ anchors, inclusionProof }: { anchors: AnchorDTO[]; inclusionProof: InclusionProof | null }) {
  const sorted = [...anchors].sort((a, b) => a.seq - b.seq);
  return (
    <div className="austere" style={{ padding: 'var(--s-6)' }}>
      <h3 className="mono" style={{ margin: '0 0 var(--s-4)', color: 'var(--austere-mono)', fontSize: 'var(--text-lg)' }}>On-chain anchor chain</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
        {sorted.length === 0 && <span className="mono" style={{ color: 'var(--austere-dim)' }}>No anchors yet.</span>}
        {sorted.map((a, i) => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
            <div
              style={{
                border: '1px solid var(--austere-border)', borderRadius: 'var(--r-sm)', padding: 'var(--s-3)',
                minWidth: 180, animation: i === sorted.length - 1 ? 'block-in 800ms ease-out' : undefined,
              }}
            >
              <div className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--austere-dim)' }}>seq #{a.seq}</div>
              <div className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--austere-mono)' }}>{short(a.link)}</div>
              <a className="aqua-link mono" style={{ fontSize: 'var(--text-sm)' }} href={explorerHref(a)} target="_blank" rel="noreferrer">
                {short(a.digest)} ↗
              </a>
            </div>
            {i < sorted.length - 1 && <span aria-hidden className="mono" style={{ color: 'var(--aqua-bright)' }}>→</span>}
          </div>
        ))}
      </div>

      {inclusionProof && (
        <p className="mono" style={{ marginTop: 'var(--s-4)', fontSize: 'var(--text-sm)', color: 'var(--austere-dim)' }}>
          Inclusion proof · leaf #{inclusionProof.leafIndex} · {inclusionProof.siblings.length} siblings · root {short(inclusionProof.merkleRoot)}
        </p>
      )}
      <style>{`@keyframes block-in { from { opacity:0; transform: translateX(16px);} to { opacity:1; transform:none;} }`}</style>
    </div>
  );
}
