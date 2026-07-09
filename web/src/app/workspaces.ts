export type WorkspaceId =
  | 'close' | 'exceptions' | 'reconciliation'
  | 'audit' | 'policy' | 'export' | 'onboarding';

export const WORKSPACES: {
  id: WorkspaceId; label: string; status: 'ready' | 'soon';
}[] = [
  { id: 'close',          label: 'Close',          status: 'ready' },
  { id: 'exceptions',     label: 'Exceptions',     status: 'ready' },
  { id: 'reconciliation', label: 'Reconciliation', status: 'ready' },
  { id: 'audit',          label: 'Audit',          status: 'ready' },
  { id: 'policy',         label: 'Policy',         status: 'ready' },
  { id: 'export',         label: 'Export',         status: 'ready' },
  { id: 'onboarding',     label: 'Onboarding',     status: 'ready' },
];

const IDS = new Set(WORKSPACES.map((w) => w.id));
export function isWorkspaceId(v: string): v is WorkspaceId {
  return IDS.has(v as WorkspaceId);
}
