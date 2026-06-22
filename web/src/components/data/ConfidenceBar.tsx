// DATA ZONE (spec §8.4) — NEVER import Mascot here. §8.6 confidence "money shot".
import { useEffect, useState } from 'react';

type Routing = 'AUTO' | 'NEEDS_REVIEW' | 'PENDING';

export function ConfidenceBar({
  confidence,
  threshold = 0.85,
}: {
  confidence: number | null;
  threshold?: number;
}) {
  const routing: Routing =
    confidence == null || Number.isNaN(confidence)
      ? 'PENDING'
      : confidence >= threshold
        ? 'AUTO'
        : 'NEEDS_REVIEW';

  // Fill animates from 0 → confidence on mount (~600ms ease-out, §8.6).
  const [w, setW] = useState(0);
  useEffect(() => {
    if (confidence == null || Number.isNaN(confidence)) { setW(0); return; }
    const id = requestAnimationFrame(() => setW(Math.min(1, Math.max(0, confidence))));
    return () => cancelAnimationFrame(id);
  }, [confidence]);

  const fillColor =
    routing === 'AUTO' ? 'var(--credit)' : routing === 'NEEDS_REVIEW' ? 'var(--warn)' : 'var(--paper-line)';

  return (
    <div
      data-testid="confidence-bar"
      data-routing={routing}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', minWidth: 320 }}
    >
      <div
        style={{
          position: 'relative', flex: 1, height: 18, borderRadius: 9,
          background: 'var(--paper)', border: '1px solid var(--paper-line)', overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%', width: `${w * 100}%`, background: fillColor,
            transition: 'width 600ms cubic-bezier(0.16,1,0.3,1), background-color 250ms ease',
          }}
        />
        {/* brass threshold tick (§8.6) */}
        <div
          aria-hidden
          style={{
            position: 'absolute', top: -2, bottom: -2, left: `${threshold * 100}%`,
            width: 2, background: 'var(--brass)',
          }}
        />
      </div>
      <span className="mono" style={{ fontSize: 15, minWidth: 92, textAlign: 'right' }}>
        {confidence == null || Number.isNaN(confidence) ? '—' : confidence.toFixed(2)}
        {routing === 'AUTO' && <span style={{ color: 'var(--credit)' }}> AUTO</span>}
        {routing === 'NEEDS_REVIEW' && <span style={{ color: 'var(--warn)' }}> REVIEW</span>}
      </span>
    </div>
  );
}
