export type WorkspaceId =
  | 'close' | 'exceptions' | 'reconciliation'
  | 'audit' | 'policy' | 'export' | 'onboarding';

export const WORKSPACES: {
  id: WorkspaceId; label: string; icon: string; status: 'ready' | 'soon';
}[] = [
  { id: 'close',          label: 'Close',          icon: '⚓', status: 'ready' },
  { id: 'exceptions',     label: 'Exceptions',     icon: '⚠', status: 'ready' },
  { id: 'reconciliation', label: 'Reconciliation', icon: '⚖', status: 'ready' },
  { id: 'audit',          label: 'Audit',          icon: '🔍', status: 'ready' },
  { id: 'policy',         label: 'Policy',         icon: '📐', status: 'ready' },
  { id: 'export',         label: 'Export',         icon: '📤', status: 'ready' },
  { id: 'onboarding',     label: 'Onboarding',     icon: '🚢', status: 'ready' },
];

const IDS = new Set(WORKSPACES.map((w) => w.id));
export function isWorkspaceId(v: string): v is WorkspaceId {
  return IDS.has(v as WorkspaceId);
}
