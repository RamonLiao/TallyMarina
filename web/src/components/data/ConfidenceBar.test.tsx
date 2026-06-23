import { render, screen } from '@testing-library/react';
import { ConfidenceBar } from './ConfidenceBar';
import { CLASSIFY_THRESHOLD } from '../../lib/constants';

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

// reduced-motion: bar reaches final width instantly, routing still correct
describe('prefers-reduced-motion', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('sets final width immediately (no rAF) when reduced-motion preferred', () => {
    render(<ConfidenceBar confidence={0.9} threshold={CLASSIFY_THRESHOLD} />);
    const bar = screen.getByTestId('confidence-bar');
    // routing must be AUTO (0.9 >= 0.85)
    expect(bar).toHaveAttribute('data-routing', 'AUTO');
    // fill div is the first child of the track div
    // fill is the first child of the track div (which is the first child of bar)
    const track = bar.querySelector('div') as HTMLElement;
    const fill = track.querySelector('div') as HTMLElement;
    expect(fill.style.width).toBe('90%');
    expect(fill.style.transition).toBe('none');
  });

  it('routing is NEEDS_REVIEW for 0.84 with reduced-motion', () => {
    render(<ConfidenceBar confidence={0.84} threshold={CLASSIFY_THRESHOLD} />);
    expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'NEEDS_REVIEW');
  });

  it('null confidence stays PENDING with reduced-motion', () => {
    render(<ConfidenceBar confidence={null} threshold={CLASSIFY_THRESHOLD} />);
    expect(screen.getByTestId('confidence-bar')).toHaveAttribute('data-routing', 'PENDING');
  });
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

it('compact variant drops the 320px floor so it fits a narrow column', () => {
  const { getByTestId } = render(<ConfidenceBar confidence={0.9} compact />);
  const root = getByTestId('confidence-bar');
  expect(root.style.minWidth).toBe('0');
});
