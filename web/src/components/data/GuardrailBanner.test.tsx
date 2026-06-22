import { render, screen } from '@testing-library/react';
import { GuardrailBanner } from './GuardrailBanner';

it('renders the guardrail message', () => {
  render(<GuardrailBanner />);
  expect(screen.getByText('AI suggestions only — no posting authority')).toBeInTheDocument();
});

it('has a note role', () => {
  render(<GuardrailBanner />);
  expect(screen.getByRole('note')).toBeInTheDocument();
});

it('does NOT contain a mascot (data zone)', () => {
  const { container } = render(<GuardrailBanner />);
  // No img with alt text or role=img that describes an otter
  const imgs = container.querySelectorAll('[role="img"]');
  expect(imgs).toHaveLength(0);
});
