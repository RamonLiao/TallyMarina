import { render, screen } from '@testing-library/react';
import { StepRail } from './StepRail';

// ── StepRail: active-step marking + sailing otter ──────────────────────────

it('marks the active step and renders the sailing otter marker', () => {
  render(<StepRail current="classify" />);
  expect(screen.getByText('Classify').closest('[data-active="true"]')).not.toBeNull();
  expect(screen.getByTestId('rail-otter')).toBeInTheDocument();
});

it('does not render rail-otter on inactive steps', () => {
  render(<StepRail current="ingest" />);
  // Only one otter shown for the active step
  expect(screen.getAllByTestId('rail-otter')).toHaveLength(1);
});

it('renders all 5 step labels', () => {
  render(<StepRail current="ingest" />);
  for (const label of ['Ingest', 'Classify', 'Review', 'Journal', 'Anchor']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

it('marks exactly one step as active', () => {
  render(<StepRail current="review" />);
  const activeCells = document.querySelectorAll('[data-active="true"]');
  expect(activeCells).toHaveLength(1);
});
