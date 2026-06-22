import { render, screen } from '@testing-library/react';
import { AppProviders } from './providers/AppProviders';
import App from './App';

it('renders the app shell inside the provider tree without throwing', () => {
  render(
    <AppProviders>
      <App />
    </AppProviders>
  );
  expect(screen.getByLabelText('TallyMarina')).toBeInTheDocument();
});
