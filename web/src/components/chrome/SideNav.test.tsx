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
  // Onboarding is still 'soon'; Policy graduated to 'ready' in Task 9.
  const onboarding = screen.getByRole('button', { name: /Onboarding/ });
  expect(onboarding).toHaveAttribute('data-status', 'soon');
  expect(onboarding.textContent).toMatch(/soon/i);
});
