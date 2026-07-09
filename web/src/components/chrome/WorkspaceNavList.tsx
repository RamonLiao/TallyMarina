import { WORKSPACES } from '../../app/workspaces';
import { useWorkspace } from '../../app/WorkspaceContext';
import { WorkspaceIcon } from './WorkspaceIcon';

// Layout/visual live in base.css (.ws-nav*). No inline styles: the mobile
// drawer restyles these via plain selectors, and inline styles would force
// an !important fight (the exact debt this component was extracted to repay).
export function WorkspaceNavList({ onNavigate }: { onNavigate?: () => void }) {
  const { activeWorkspace, setWorkspace } = useWorkspace();
  return (
    <ul className="ws-nav">
      {WORKSPACES.map((w) => {
        const active = w.id === activeWorkspace;
        return (
          <li key={w.id}>
            <button
              type="button"
              className="ws-nav-item"
              onClick={() => { setWorkspace(w.id); onNavigate?.(); }}
              aria-current={active ? 'page' : undefined}
              data-status={w.status}
            >
              <WorkspaceIcon id={w.id} />
              <span className="ws-nav-label">{w.label}</span>
              {w.status === 'soon' && <span className="ws-nav-soon">soon</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
