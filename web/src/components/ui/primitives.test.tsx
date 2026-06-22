/**
 * Primitive component tests — encodes WHY each behavior matters,
 * not just what it does.
 *
 * Key contract: Badge status→semantic-color class mapping is a VISUAL
 * CONTRACT for the routing UI (AUTO=credit/green, NEEDS_REVIEW=warn/amber).
 * If someone breaks this mapping, the routing UI silently shows wrong colors.
 * These tests guard that boundary.
 */
import { render, screen } from '@testing-library/react';
import { Button, Badge, Card, Table } from './index';
import type { BadgeStatus, Column } from './index';

// ── Button ─────────────────────────────────────────────────────────────────

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('defaults to primary variant class', () => {
    const { container } = render(<Button>Go</Button>);
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('btn--primary');
  });

  it('applies variant class correctly for each variant', () => {
    const variants = ['primary', 'ghost', 'danger', 'anchor'] as const;
    variants.forEach((variant) => {
      const { container } = render(<Button variant={variant}>x</Button>);
      const btn = container.querySelector('button');
      expect(btn?.className).toContain(`btn--${variant}`);
    });
  });

  it('is disabled when disabled prop set', () => {
    render(<Button disabled>Nope</Button>);
    expect(screen.getByRole('button', { name: 'Nope' })).toBeDisabled();
  });

  it('passes through aria-label', () => {
    render(<Button aria-label="Submit form">Submit</Button>);
    expect(screen.getByRole('button', { name: 'Submit form' })).toBeInTheDocument();
  });
});

// ── Card ────────────────────────────────────────────────────────────────────

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies default card class (CSS module hashed name contains "card")', () => {
    const { container } = render(<Card>x</Card>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toMatch(/card/);
  });

  it('applies austere class for austere surface', () => {
    const { container } = render(<Card surface="austere">x</Card>);
    const el = container.firstChild as HTMLElement;
    // CSS module hashes the name; confirm "austere" token present in class
    expect(el.className).toMatch(/austere/);
  });

  it('default surface does NOT apply austere class (data surface cleanliness)', () => {
    const { container } = render(<Card>x</Card>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).not.toMatch(/austere/);
  });
});

// ── Badge ── VISUAL CONTRACT for routing UI ──────────────────────────────────

describe('Badge — semantic-color routing contract', () => {
  /**
   * WHY: The routing UI uses Badge status to convey trust/routing decisions.
   * AUTO must render credit-green (high confidence, no review needed).
   * NEEDS_REVIEW must render warn-amber (human attention required).
   * Breaking these mappings makes the routing UI misleading without any
   * visible error — hence explicit assertions on the CSS class, not just render.
   */

  it('AUTO maps to credit (green) class — routing confidence signal', () => {
    const { container } = render(<Badge status="AUTO" />);
    const el = container.querySelector('[data-status="AUTO"]');
    expect(el).toBeTruthy();
    expect(el?.className).toContain('badge--auto');
    // data-status attribute confirms identity for downstream selectors
    expect(el?.getAttribute('data-status')).toBe('AUTO');
  });

  it('NEEDS_REVIEW maps to warn (amber) class — human review required', () => {
    const { container } = render(<Badge status="NEEDS_REVIEW" />);
    const el = container.querySelector('[data-status="NEEDS_REVIEW"]');
    expect(el?.className).toContain('badge--needs-review');
  });

  it('ANCHORED maps to aqua class — on-chain semantic (§8.1)', () => {
    const { container } = render(<Badge status="ANCHORED" />);
    const el = container.querySelector('[data-status="ANCHORED"]');
    expect(el?.className).toContain('badge--anchored');
  });

  it('REJECTED maps to debit (red) class', () => {
    const { container } = render(<Badge status="REJECTED" />);
    const el = container.querySelector('[data-status="REJECTED"]');
    expect(el?.className).toContain('badge--rejected');
  });

  it('DRAFT maps to ink-soft (neutral) class', () => {
    const { container } = render(<Badge status="DRAFT" />);
    const el = container.querySelector('[data-status="DRAFT"]');
    expect(el?.className).toContain('badge--draft');
  });

  it('renders default label for each status', () => {
    const cases: Array<[BadgeStatus, string]> = [
      ['AUTO', 'Auto'],
      ['NEEDS_REVIEW', 'Needs Review'],
      ['ANCHORED', 'Anchored'],
      ['REJECTED', 'Rejected'],
      ['DRAFT', 'Draft'],
    ];
    cases.forEach(([status, expectedLabel]) => {
      const { getByText } = render(<Badge status={status} />);
      expect(getByText(expectedLabel)).toBeInTheDocument();
    });
  });

  it('renders custom label over default', () => {
    render(<Badge status="AUTO" label="AI Processed" />);
    expect(screen.getByText('AI Processed')).toBeInTheDocument();
  });
});

// ── Table ───────────────────────────────────────────────────────────────────

describe('Table', () => {
  type Row = { id: string; amount: string; status: string };
  const columns: Column<Row>[] = [
    { key: 'id', header: 'ID', render: (r) => r.id, type: 'mono' },
    { key: 'amount', header: 'Amount', render: (r) => r.amount, type: 'mono' },
    { key: 'status', header: 'Status', render: (r) => r.status },
  ];
  const rows: Row[] = [
    { id: '0xabc1', amount: '100.00', status: 'AUTO' },
    { id: '0xabc2', amount: '250.50', status: 'NEEDS_REVIEW' },
  ];

  it('renders all row data', () => {
    render(
      <Table
        columns={columns}
        rows={rows}
        getKey={(r) => r.id}
        label="Transactions"
      />
    );
    expect(screen.getByText('0xabc1')).toBeInTheDocument();
    expect(screen.getByText('0xabc2')).toBeInTheDocument();
    expect(screen.getByText('100.00')).toBeInTheDocument();
    expect(screen.getByText('250.50')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    render(
      <Table columns={columns} rows={rows} getKey={(r) => r.id} label="Tx" />
    );
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('applies mono class to mono-typed cells (tabular-nums contract)', () => {
    const { container } = render(
      <Table columns={columns} rows={rows} getKey={(r) => r.id} label="Tx" />
    );
    // all td cells for mono columns should have td--mono class
    const monoCells = container.querySelectorAll('[class*="td--mono"]');
    // 2 rows × 2 mono columns = 4
    expect(monoCells.length).toBe(4);
  });

  it('renders empty table without error', () => {
    render(
      <Table columns={columns} rows={[]} getKey={(r) => r.id} label="Empty" />
    );
    expect(screen.getByRole('table', { name: 'Empty' })).toBeInTheDocument();
  });

  it('uses aria-label for accessibility', () => {
    render(
      <Table columns={columns} rows={rows} getKey={(r) => r.id} label="Journal entries" />
    );
    expect(screen.getByRole('table', { name: 'Journal entries' })).toBeInTheDocument();
  });
});
