import { WORKSPACES } from '../../app/workspaces';
import { useWorkspace } from '../../app/WorkspaceContext';

// The one persistent "where am I" signal once the nav collapses into a drawer.
// No icon: the drawer already carries iconography; repeating it here is the
// accessory to leave at home.
export function WorkspaceHeader() {
  const { activeWorkspace } = useWorkspace();
  const meta = WORKSPACES.find((w) => w.id === activeWorkspace);
  if (!meta) return null;
  return <h1 className="workspace-title">{meta.label}</h1>;
}
