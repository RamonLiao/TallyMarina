// Pure selection→mode derivation (Rule 5: deterministic, code not model).
export type AuditMode = 'pick' | 'lineage' | 'compare';

export function deriveMode(sel: { selectedId: string | null; compareIds: string[] }): AuditMode {
  if (sel.compareIds.length >= 2) return 'compare';
  if (sel.compareIds.length === 1) return 'lineage';
  if (sel.selectedId) return 'lineage';
  return 'pick';
}

/** The single event a lineage view should render, given the selection. */
export function lineageTarget(sel: { selectedId: string | null; compareIds: string[] }): string | null {
  if (sel.compareIds.length === 1) return sel.compareIds[0]!;
  return sel.selectedId;
}
