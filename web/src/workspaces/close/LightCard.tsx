import type { CockpitLight } from '../../api/types';
import { LIGHT_META, effectiveStatus, dispatchTarget } from './lightMeta';
import './close.css';

export function LightCard({
  light,
  onDispatch,
}: {
  light: CockpitLight;
  onDispatch: (key: string) => void;
}) {
  const status = effectiveStatus(light);
  const meta = LIGHT_META[status];
  // 'stale' blocks close like 'red' (spec D12/D13), so it must be just as dispatchable —
  // the revaluation light's fix (rerun) lives behind the same Resolve → path.
  const actionable = (status === 'red' || status === 'stale') && dispatchTarget(light.key) !== null;

  return (
    <div
      className={`light-card ${meta.cls}`}
      role="group"
      aria-label={`${light.label}: ${meta.word}`}
    >
      <div className="light-card__head">
        <span className="light-card__glyph" aria-hidden="true">
          {meta.glyph}
        </span>
        <span className="light-card__word">{meta.word}</span>
      </div>
      <div className="light-card__label">{light.label}</div>
      {actionable && (
        <button
          type="button"
          className="light-card__cta"
          onClick={() => onDispatch(light.key)}
        >
          Resolve →
        </button>
      )}
    </div>
  );
}
