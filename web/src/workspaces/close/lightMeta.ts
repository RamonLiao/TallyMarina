import type { CockpitLight, LightStatus } from '../../api/types';
import type { WorkspaceId } from '../../app/workspaces';
import type { StepId } from '../../app/steps';

export const LIGHT_META: Record<LightStatus, { glyph: string; word: string; cls: string }> = {
  green:   { glyph: '✓', word: 'Ready',          cls: 'light--green' },
  red:     { glyph: '!', word: 'Blocking',       cls: 'light--red' },
  stale:   { glyph: '⟳', word: 'Stale — rerun',  cls: 'light--stale' },
  derived: { glyph: '≈', word: 'Derived',        cls: 'light--derived' },
  mock:    { glyph: '◌', word: 'Not wired',       cls: 'light--mock' },
};

// WHY: backend never sends status:'derived'. A completeness light arrives as
// {status:'green', real:false}. The honesty rule requires we render it with the
// derived glyph (≈) not the verified green (✓), so callers must use this helper
// rather than reading light.status directly.
export function effectiveStatus(light: CockpitLight): LightStatus {
  return (light.status === 'green' && !light.real) ? 'derived' : light.status;
}

const RANK: Record<LightStatus, number> = { red: 0, stale: 1, derived: 2, mock: 3, green: 4 };

export function severityRank(s: LightStatus): number { return RANK[s]; }

// 'stale' (Task 7/11, spec D12/D13) blocks close exactly like 'red' — a revaluation run
// that no longer reflects current prices/lots is a blocking fact, not a soft warning.
// Single source of truth for LockPanel's blockers and CloseCockpit's verdict count.
export function isBlocking(s: LightStatus): boolean { return s === 'red' || s === 'stale'; }

export function sortLights(lights: CockpitLight[]): CockpitLight[] {
  return [...lights].sort((a, b) => RANK[effectiveStatus(a)] - RANK[effectiveStatus(b)]);
}

// Where a non-green real light sends the user. Returns a workspace id or a close-flow step id.
export function dispatchTarget(key: string): WorkspaceId | StepId | null {
  switch (key) {
    case 'recon':          return 'reconciliation';
    case 'registry':       return 'onboarding';
    case 'classification': return 'review';
    case 'je':             return 'journal';
    case 'completeness':   return 'ingest';
    // In-page target: CloseCockpit intercepts this key and scrolls to the revaluation card
    // (same workspace). The 'close' value only marks the light as actionable/dispatchable.
    case 'revaluation':    return 'close';
    default:               return null; // pricing/export are mock — nowhere to go yet
  }
}
