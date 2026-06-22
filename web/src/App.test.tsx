import { render, screen } from '@testing-library/react';
import { Providers } from './Providers';
import App from './App';

it('renders the app shell inside the provider tree without throwing', () => {
  render(
    <Providers>
      <App />
    </Providers>
  );
  expect(screen.getByLabelText('TallyMarina')).toBeInTheDocument();
});
