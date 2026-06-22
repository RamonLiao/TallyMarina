import { render, screen } from '@testing-library/react';
import App from './App';

it('renders the app shell', () => {
  render(<App />);
  expect(screen.getByLabelText('TallyMarina')).toBeInTheDocument();
});
