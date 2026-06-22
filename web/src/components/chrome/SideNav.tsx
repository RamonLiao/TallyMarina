import { WORKSPACES } from '../../app/workspaces';
import { useWorkspace } from '../../app/WorkspaceContext';

export function SideNav() {
  const { activeWorkspace, setWorkspace } = useWorkspace();
  return (
    <nav
      aria-label="Workspaces"
      style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
        padding: 'var(--space-3)', minWidth: 200,
      }}
    >
      {WORKSPACES.map((w) => {
        const active = w.id === activeWorkspace;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => setWorkspace(w.id)}
            aria-current={active ? 'page' : undefined}
            data-status={w.status}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid transparent',
              background: active ? 'var(--brass-fill)' : 'transparent',
              color: 'var(--ink)',
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              fontWeight: active ? 600 : 400,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span aria-hidden style={{ fontSize: 16 }}>{w.icon}</span>
            <span style={{ flex: 1 }}>{w.label}</span>
            {w.status === 'soon' && (
              <span
                style={{
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)',
                }}
              >
                soon
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
