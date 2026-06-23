import type { CockpitLight, LightStatus } from '../../api/types';
import type { WorkspaceId } from '../../app/workspaces';
import type { StepId } from '../../app/steps';

export const LIGHT_META: Record<LightStatus, { glyph: string; word: string; cls: string }> = {
  green:   { glyph: '✓', word: 'Ready',     cls: 'light--green' },
  red:     { glyph: '!', word: 'Blocking',  cls: 'light--red' },
  derived: { glyph: '≈', word: 'Derived',   cls: 'light--derived' },
  mock:    { glyph: '◌', word: '未接真訊號', cls: 'light--mock' },
};

// WHY: backend never sends status:'derived'. A completeness light arrives as
// {status:'green', real:false}. The honesty rule requires we render it with the
// derived glyph (≈) not the verified green (✓), so callers must use this helper
// rather than reading light.status directly.
export function effectiveStatus(light: CockpitLight): LightStatus {
  return (light.status === 'green' && !light.real) ? 'derived' : light.status;
}

const RANK: Record<LightStatus, number> = { red: 0, derived: 1, mock: 2, green: 3 };

export function severityRank(s: LightStatus): number { return RANK[s]; }

export function sortLights(lights: CockpitLight[]): CockpitLight[] {
  return [...lights].sort((a, b) => RANK[effectiveStatus(a)] - RANK[effectiveStatus(b)]);
}

// Where a non-green real light sends the user. Returns a workspace id or a close-flow step id.
export function dispatchTarget(key: string): WorkspaceId | StepId | null {
  switch (key) {
    case 'recon':          return 'reconciliation';
    case 'classification': return 'review';
    case 'je':             return 'journal';
    case 'completeness':   return 'ingest';
    default:               return null; // pricing/export are mock — nowhere to go yet
  }
}
