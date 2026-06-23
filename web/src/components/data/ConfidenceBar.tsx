// DATA ZONE (spec §8.4) — NEVER import Mascot here. §8.6 confidence "money shot".
import { useEffect, useState } from 'react';
import { CLASSIFY_THRESHOLD } from '../../lib/constants';

type Routing = 'AUTO' | 'NEEDS_REVIEW' | 'PENDING';

export function ConfidenceBar({
  confidence,
  threshold = CLASSIFY_THRESHOLD,
  compact = false,
}: {
  confidence: number | null;
  threshold?: number;
  compact?: boolean;
}) {
  const routing: Routing =
    confidence == null || Number.isNaN(confidence)
      ? 'PENDING'
      : confidence >= threshold
        ? 'AUTO'
        : 'NEEDS_REVIEW';

  // Respect prefers-reduced-motion: skip rAF animation, set final width immediately.
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Fill animates from 0 → confidence on mount (~600ms ease-out, §8.6).
  const finalW =
    confidence == null || Number.isNaN(confidence) ? 0 : Math.min(1, Math.max(0, confidence));
  const [w, setW] = useState(prefersReducedMotion ? finalW : 0);

  useEffect(() => {
    if (confidence == null || Number.isNaN(confidence)) { setW(0); return; }
    const target = Math.min(1, Math.max(0, confidence));
    if (prefersReducedMotion) {
      setW(target);
      return;
    }
    const id = requestAnimationFrame(() => setW(target));
    return () => cancelAnimationFrame(id);
  }, [confidence, prefersReducedMotion]);

  const fillColor =
    routing === 'AUTO' ? 'var(--credit)' : routing === 'NEEDS_REVIEW' ? 'var(--warn)' : 'var(--paper-line)';

  return (
    <div
      data-testid="confidence-bar"
      data-routing={routing}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', minWidth: compact ? 0 : 320 }}
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
            transition: prefersReducedMotion ? 'none' : 'width 600ms cubic-bezier(0.16,1,0.3,1), background-color 250ms ease',
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
      <span className="mono" style={{ fontSize: 15, minWidth: compact ? 0 : 92, textAlign: 'right' }}>
        {confidence == null || Number.isNaN(confidence) ? '—' : confidence.toFixed(2)}
        {routing === 'AUTO' && <span style={{ color: 'var(--credit)' }}> AUTO</span>}
        {routing === 'NEEDS_REVIEW' && <span style={{ color: 'var(--warn)' }}> REVIEW</span>}
      </span>
    </div>
  );
}
