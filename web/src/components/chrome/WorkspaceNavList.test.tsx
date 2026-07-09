import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { WorkspaceProvider, useWorkspace } from '../../app/WorkspaceContext';
import { WorkspaceNavList } from './WorkspaceNavList';

function probeWrap(ui: React.ReactNode) {
  let ctx!: ReturnType<typeof useWorkspace>;
  function Probe() { ctx = useWorkspace(); return null; }
  render(<WorkspaceProvider>{ui}<Probe /></WorkspaceProvider>);
  return () => ctx;
}

it('switches workspace and notifies the host that navigation happened', async () => {
  // WHY onNavigate matters: the drawer must close itself after a choice.
  // Without this callback the user picks a workspace and stares at the drawer.
  const onNavigate = vi.fn();
  const get = probeWrap(<WorkspaceNavList onNavigate={onNavigate} />);
  await userEvent.click(screen.getByRole('button', { name: /Policy/ }));
  expect(get().activeWorkspace).toBe('policy');
  expect(onNavigate).toHaveBeenCalledTimes(1);
});

it('works without onNavigate (desktop SideNav passes none)', async () => {
  const get = probeWrap(<WorkspaceNavList />);
  await userEvent.click(screen.getByRole('button', { name: /Audit/ }));
  expect(get().activeWorkspace).toBe('audit');
});

it('marks the active workspace with aria-current', () => {
  probeWrap(<WorkspaceNavList />);
  expect(screen.getByRole('button', { name: /Close/ })).toHaveAttribute('aria-current', 'page');
});
