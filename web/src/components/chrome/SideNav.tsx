import { WorkspaceNavList } from './WorkspaceNavList';

// Desktop rail only. Hidden below 768px, where NavDrawer takes over.
export function SideNav() {
  return (
    <nav aria-label="Workspaces" className="sidenav">
      <WorkspaceNavList />
    </nav>
  );
}
