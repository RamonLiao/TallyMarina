import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../AppRoutes';

// Stub the heavy app shell — this test verifies ROUTING, not the dashboard.
vi.mock('../../App', () => ({ default: () => <div>DASHBOARD_MARKER</div> }));

describe('landing → app routing', () => {
  it('renders the Landing at "/" and not the dashboard', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.queryByText('DASHBOARD_MARKER')).toBeNull();
    expect(screen.getByRole('button', { name: /launch app/i })).toBeInTheDocument();
  });

  it('navigates to the dashboard when Launch App is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /launch app/i }));
    expect(screen.getByText('DASHBOARD_MARKER')).toBeInTheDocument();
  });

  it('renders the dashboard directly on a /app deep-link', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByText('DASHBOARD_MARKER')).toBeInTheDocument();
  });
});
