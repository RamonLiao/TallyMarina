import { render } from '@testing-library/react';
import { WorkspaceIcon } from './WorkspaceIcon';
import { WORKSPACES } from '../../app/workspaces';

it('renders one currentColor svg per real workspace', () => {
  for (const w of WORKSPACES) {
    const { container, unmount } = render(<WorkspaceIcon id={w.id} />);
    const svg = container.querySelector('svg');
    expect(svg, `no svg for ${w.id}`).not.toBeNull();
    // WHY currentColor: the active nav item is tinted --brass via `color`.
    // A hard-coded stroke would leave the icon un-tinted and break the
    // single-signal active state.
    expect(svg!.getAttribute('stroke')).toBe('currentColor');
    // WHY aria-hidden: the button already has a visible text label; an
    // exposed icon would double the accessible name.
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    unmount();
  }
});

it('returns null for an unknown id instead of throwing', () => {
  // SideNav.test.tsx injects a synthetic 'soon-test' workspace.
  const { container } = render(<WorkspaceIcon id="soon-test" />);
  expect(container.firstChild).toBeNull();
});
