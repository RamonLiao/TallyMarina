import { render, screen, fireEvent } from '@testing-library/react';
import { StepRail } from './StepRail';
import { EntityProvider, useEntityCtx } from '../../app/EntityContext';

// ── StepRail: active-step marking + sailing otter + back-navigation ────────
// StepRail reads setStep from EntityContext, so every render must be wrapped.

function renderRail(current: Parameters<typeof StepRail>[0]['current']) {
  return render(
    <EntityProvider>
      <StepRail current={current} />
    </EntityProvider>,
  );
}

it('marks the active step and renders the sailing otter marker', () => {
  renderRail('classify');
  expect(screen.getByText('Classify').closest('[data-active="true"]')).not.toBeNull();
  expect(screen.getByTestId('rail-otter')).toBeInTheDocument();
});

it('does not render rail-otter on inactive steps', () => {
  renderRail('ingest');
  // Only one otter shown for the active step
  expect(screen.getAllByTestId('rail-otter')).toHaveLength(1);
});

it('renders all 5 step labels', () => {
  renderRail('ingest');
  for (const label of ['Ingest', 'Classify', 'Review', 'Journal', 'Anchor']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

it('marks exactly one step as active', () => {
  renderRail('review');
  const activeCells = document.querySelectorAll('[data-active="true"]');
  expect(activeCells).toHaveLength(1);
});

// ── Back-navigation: why it matters — users must be able to revisit completed
// steps to re-check data, but must NOT jump forward past the goNext() gating. ──

it('exposes completed steps as keyboard-reachable buttons, but not future steps', () => {
  renderRail('review'); // n=3: ingest+classify done, review active, journal+anchor locked
  const cell = (label: string) => screen.getByText(label).closest('div')!;
  // completed steps are buttons
  expect(cell('Ingest').getAttribute('role')).toBe('button');
  expect(cell('Classify').getAttribute('role')).toBe('button');
  // active step is NOT navigable (no self-nav)
  expect(cell('Review').getAttribute('role')).toBeNull();
  // future steps are locked — clicking them must do nothing
  expect(cell('Journal').getAttribute('role')).toBeNull();
  expect(cell('Anchor').getAttribute('role')).toBeNull();
});

function navProbe(current: Parameters<typeof StepRail>[0]['current']) {
  const ref = { step: '' as string };
  function Probe() {
    ref.step = useEntityCtx().step;
    return null;
  }
  render(
    <EntityProvider>
      <StepRail current={current} />
      <Probe />
    </EntityProvider>,
  );
  return ref;
}

it('clicking a completed step navigates back to it', () => {
  const ref = navProbe('journal');
  fireEvent.click(screen.getByText('Classify').closest('div')!);
  expect(ref.step).toBe('classify');
});

it('Enter activates keyboard navigation on a completed step', () => {
  const ref = navProbe('journal');
  fireEvent.keyDown(screen.getByText('Review').closest('div')!, { key: 'Enter' });
  expect(ref.step).toBe('review');
});

it('Space activates keyboard navigation on a completed step', () => {
  const ref = navProbe('journal');
  fireEvent.keyDown(screen.getByText('Ingest').closest('div')!, { key: ' ' });
  expect(ref.step).toBe('ingest');
});

it('a non-activating key does NOT navigate to the focused step', () => {
  const ref = navProbe('journal');
  fireEvent.keyDown(screen.getByText('Review').closest('div')!, { key: 'Tab' });
  expect(ref.step).not.toBe('review'); // wrong key → no navigation
});

it('keydown on a locked future step is a no-op', () => {
  const ref = navProbe('classify'); // classify active, review+ locked
  fireEvent.keyDown(screen.getByText('Anchor').closest('div')!, { key: 'Enter' });
  expect(ref.step).not.toBe('anchor'); // locked step has no handler
});
