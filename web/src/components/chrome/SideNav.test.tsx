import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceProvider, useWorkspace } from '../../app/WorkspaceContext';
import { SideNav } from './SideNav';

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
  // Policy is still 'soon'; Reconciliation graduated to 'ready' in Phase 1 A-3.
  const policy = screen.getByRole('button', { name: /Policy/ });
  expect(policy).toHaveAttribute('data-status', 'soon');
  expect(policy.textContent).toMatch(/soon/i);
});
