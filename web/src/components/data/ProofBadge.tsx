// DATA ZONE (spec §8.4) — NEVER import Mascot here. §6 client-side proof verification.
import { useEffect, useState } from 'react';
import { useAnchors } from '../../api/hooks';
import { resolveProofState, type ProofState } from '../../lib/proofVerify';

function shortHex(h: string) { return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h; }

export function ProofBadge({ leafHash, idempotencyKey, lineageHash, entityId }: {
  leafHash: string; idempotencyKey: string; lineageHash: string; entityId: string;
}) {
  const { data } = useAnchors(entityId, idempotencyKey);
  const [state, setState] = useState<ProofState | null>(null);

  useEffect(() => {
    let alive = true;
    if (!data) { setState(null); return; }
    resolveProofState({ leafHash, proof: data.inclusionProof, anchors: data.anchors })
      .then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, [data, leafHash]);

  return (
    <div className="mono" style={{ fontSize: 13, color: 'var(--austere-mono)', marginTop: 'var(--s-3)' }}>
      <div style={{ color: 'var(--austere-dim)' }}>lineageHash {shortHex(lineageHash)}</div>
      <div style={{ color: 'var(--austere-dim)' }}>leafHash {shortHex(leafHash)}</div>
      {state === null && <div style={{ color: 'var(--austere-dim)' }}>verifying proof in browser…</div>}
      {state?.kind === 'verified-onchain' && (
        <div style={{ color: 'var(--aqua-bright)' }}>
          ✓ proof recomputed in browser · matches on-chain root · anchor seq #{state.anchor.seq}
        </div>
      )}
      {state?.kind === 'verified-pending' && (
        <div style={{ color: 'var(--warn)' }}>✓ proof recomputed · ◌ not yet anchored on-chain</div>
      )}
      {state?.kind === 'not-in-journal' && (
        <div style={{ color: 'var(--austere-dim)' }}>— not in current journal (reversed or superseded)</div>
      )}
      {state?.kind === 'mismatch' && (
        <div style={{ color: 'var(--debit)' }}>✗ PROOF MISMATCH — recomputed root ≠ claimed root</div>
      )}
    </div>
  );
}
