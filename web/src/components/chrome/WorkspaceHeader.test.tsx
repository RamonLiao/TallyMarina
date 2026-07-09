import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceProvider } from '../../app/WorkspaceContext';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceNavList } from './WorkspaceNavList';

it('names the active workspace as the page h1', () => {
  render(<WorkspaceProvider><WorkspaceHeader /></WorkspaceProvider>);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Close');
});

it('follows the active workspace', async () => {
  // WHY: with the nav collapsed into a drawer, this h1 is the ONLY persistent
  // "where am I" signal. If it went stale the user would be lost.
  render(
    <WorkspaceProvider><WorkspaceHeader /><WorkspaceNavList /></WorkspaceProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: /Policy/ }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Policy');
});
