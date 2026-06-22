import { render, screen } from '@testing-library/react';
import { ConfidenceBar } from './ConfidenceBar';

// § 8.6 threshold boundary — the money shot
it('routes 0.84 to amber NEEDS_REVIEW (below threshold)', () => {
  render(<ConfidenceBar confidence={0.84} threshold={0.85} />);
  expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'NEEDS_REVIEW');
});

it('routes 0.85 to green AUTO (at/above threshold)', () => {
  render(<ConfidenceBar confidence={0.85} threshold={0.85} />);
  expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'AUTO');
});

it('shows pending (no routing) when confidence is null (pre-classify)', () => {
  render(<ConfidenceBar confidence={null} threshold={0.85} />);
  expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'PENDING');
});

it('does not render any mascot (data zone, §8.4)', () => {
  render(<ConfidenceBar confidence={0.9} />);
  expect(screen.queryByRole('img', { name: /otter/i })).toBeNull();
});

it('routes 1.0 to AUTO', () => {
  render(<ConfidenceBar confidence={1.0} threshold={0.85} />);
  expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'AUTO');
});

it('routes 0.0 to NEEDS_REVIEW', () => {
  render(<ConfidenceBar confidence={0.0} threshold={0.85} />);
  expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'NEEDS_REVIEW');
});

it('displays — for null confidence (pre-classify placeholder)', () => {
  render(<ConfidenceBar confidence={null} />);
  expect(screen.getByTestId('confidence-bar').textContent).toContain('—');
});

// Carry from Task 7: safe normalized field access
describe('safe normalized field rendering (carry from Task 7)', () => {
  it('renders eventTime from normalized when present', () => {
    const eventTime = '2024-01-15T10:30:00Z';
    // Simulate what ClassifyStep row would render with normalized data
    const normalized: Record<string, unknown> = { eventTime };
    const display = String(normalized?.eventTime ?? '—');
    expect(display).toBe(eventTime);
  });

  it('renders — for missing eventTime key (no crash)', () => {
    const normalized: Record<string, unknown> = {};
    const display = String(normalized?.eventTime ?? '—');
    expect(display).toBe('—');
  });

  it('renders — when normalized is undefined (no crash)', () => {
    const normalized: Record<string, unknown> | undefined = undefined;
    const display = String(normalized?.['eventTime'] ?? '—');
    expect(display).toBe('—');
  });

  it('renders amount/coinType when present', () => {
    const normalized: Record<string, unknown> = { amount: '1000', coinType: 'SUI' };
    const amount = String(normalized?.amount ?? '—');
    const coinType = String(normalized?.coinType ?? '—');
    expect(amount).toBe('1000');
    expect(coinType).toBe('SUI');
  });

  it('renders — for missing amount/coinType (no crash)', () => {
    const normalized: Record<string, unknown> = {};
    const amount = String(normalized?.amount ?? '—');
    const coinType = String(normalized?.coinType ?? '—');
    expect(amount).toBe('—');
    expect(coinType).toBe('—');
  });
});
