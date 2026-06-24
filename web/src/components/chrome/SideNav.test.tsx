import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { WorkspaceProvider, useWorkspace } from '../../app/WorkspaceContext';
import { SideNav } from './SideNav';

// All real workspaces are now 'ready'. Inject a synthetic 'soon' workspace so
// the gating behavior tests remain live without depending on the live registry state.
vi.mock('../../app/workspaces', () => ({
  WORKSPACES: [
    { id: 'close',          label: 'Close',          icon: '⚓', status: 'ready' },
    { id: 'exceptions',     label: 'Exceptions',     icon: '⚠', status: 'ready' },
    { id: 'reconciliation', label: 'Reconciliation', icon: '⚖', status: 'ready' },
    { id: 'audit',          label: 'Audit',          icon: '🔍', status: 'ready' },
    { id: 'policy',         label: 'Policy',         icon: '📐', status: 'ready' },
    { id: 'export',         label: 'Export',         icon: '📤', status: 'ready' },
    { id: 'onboarding',     label: 'Onboarding',     icon: '🚢', status: 'ready' },
    { id: 'soon-test',      label: 'SoonTest',       icon: '🚧', status: 'soon' },
  ],
  isWorkspaceId: (v: string) =>
    ['close','exceptions','reconciliation','audit','policy','export','onboarding','soon-test'].includes(v),
}));

function probeWrap(ui: React.ReactNode) {
  let ctx!: ReturnType<typeof useWorkspace>;
  function Probe() { ctx = useWorkspace(); return null; }
  render(<WorkspaceProvider>{ui}<Probe /></WorkspaceProvider>);
  return () => ctx;
}

it('renders one nav item per workspace', () => {
  probeWrap(<SideNav />);
  expect(screen.getByRole('button', { name: /Close/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Reconciliation/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Onboarding/ })).toBeInTheDocument();
});

it('marks the active workspace with aria-current', () => {
  probeWrap(<SideNav />);
  expect(screen.getByRole('button', { name: /Close/ })).toHaveAttribute('aria-current', 'page');
});

it('clicking a soon workspace switches the active workspace', async () => {
  const get = probeWrap(<SideNav />);
  await userEvent.click(screen.getByRole('button', { name: /Policy/ }));
  expect(get().activeWorkspace).toBe('policy');
});

it('soon workspaces carry a non-color status marker (text), not color alone', () => {
  probeWrap(<SideNav />);
  // The test injects a synthetic 'soon-test' workspace; all real workspaces are now 'ready'.
  const soonBtn = screen.getByRole('button', { name: /SoonTest/ });
  expect(soonBtn).toHaveAttribute('data-status', 'soon');
  expect(soonBtn.textContent).toMatch(/soon/i);
});
