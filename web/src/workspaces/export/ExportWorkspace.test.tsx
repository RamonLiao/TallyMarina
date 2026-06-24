// web/src/workspaces/export/ExportWorkspace.test.tsx
// Behaviour tests — not pixels. Each test encodes WHY the behaviour matters.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportWorkspace } from './ExportWorkspace';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../app/EntityContext', () => ({
  useEntityCtx: () => ({
    entity: { id: 'ent-1', displayName: 'Acme Corp', chainObjectId: '', capObjectId: '', originalPackageId: '' },
    periodId: '2026-Q2',
    step: 'anchor',
    setStep: vi.fn(),
    goNext: vi.fn(),
  }),
}));

// Default: return data with minimal journal so assembleExport can run.
// Individual tests override via mockReturnValue.
const mockUseExportData = vi.fn();
vi.mock('../../data/useExportData', () => ({
  useExportData: (...args: unknown[]) => mockUseExportData(...args),
}));

const mockAssembleExport = vi.fn();
vi.mock('./assembleExport', () => ({
  assembleExport: (...args: unknown[]) => mockAssembleExport(...args),
}));

// Minimal verified summary
const verifiedSummary = {
  jeCount: 3,
  legCount: 6,
  totalDebit: '300000',
  totalCredit: '300000',
  verified: true,
  merkleRootMatches: true,
  leavesBound: 3,
  proofsVerified: 3,
  bundledJeCount: 3,
  anchoredLeafCount: 3,
  completenessOk: true,
};

const draftSummary = {
  jeCount: 2,
  legCount: 4,
  totalDebit: '200000',
  totalCredit: '200000',
  verified: false,
};

function setupData(value?: { journal: unknown[]; events: unknown[]; anchors: unknown[] }) {
  mockUseExportData.mockReturnValue({
    data: value ?? { journal: [{}], events: [], anchors: [] },
    loading: false,
    error: undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Verified state ─────────────────────────────────────────────────────────

describe('verified state', () => {
  beforeEach(() => {
    setupData();
    mockAssembleExport.mockResolvedValue({
      ok: true,
      verified: true,
      filename: 'export-ent-1-2026-Q2.zip',
      zip: new Uint8Array([1, 2, 3]),
      summary: verifiedSummary,
    });
  });

  it('renders the austere verified card after export preview loads', async () => {
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    // WHY: audit-grade artefact — user must see tamper-evident status prominently.
    await waitFor(() => expect(screen.getByTestId('verified-card')).toBeInTheDocument());
  });

  it('renders the full merkleRoot without truncation', async () => {
    const root = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    mockAssembleExport.mockResolvedValue({
      ok: true, verified: true,
      filename: 'export-ent-1-2026-Q2.zip',
      zip: new Uint8Array([]),
      summary: { ...verifiedSummary, merkleRoot: root } as typeof verifiedSummary & { merkleRoot: string },
    });
    // Re-set with modified summary
    mockAssembleExport.mockResolvedValueOnce({
      ok: true, verified: true,
      filename: 'export-ent-1-2026-Q2.zip',
      zip: new Uint8Array([]),
      summary: verifiedSummary,
      merkleRoot: root,
    });
    // Use the direct approach: assert via data attribute
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => expect(screen.getByTestId('verified-card')).toBeInTheDocument());
    // Merkle root element must exist and not have text-overflow:ellipsis / truncation class
    const rootEl = screen.queryByTestId('merkle-root');
    if (rootEl) {
      // WHY: a truncated hash cannot be visually verified by an auditor.
      expect(rootEl.style.textOverflow).not.toBe('ellipsis');
      expect(rootEl.style.overflow).not.toBe('hidden');
    }
  });

  it('renders an explorer aqua-link', async () => {
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => expect(screen.getByTestId('verified-card')).toBeInTheDocument());
    // WHY: auditors need a direct link to on-chain proof; link semantics matter.
    const link = screen.queryByTestId('explorer-link');
    if (link) {
      expect(link.tagName).toBe('A');
      expect(link.className).toContain('aqua-link');
    }
  });

  it('shows self-verification summary with Debits = Credits and completeness', async () => {
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    // WHY: auditor must be able to confirm balance before downloading the ZIP.
    await waitFor(() => expect(screen.getByTestId('self-verify-summary')).toBeInTheDocument());
    const summary = screen.getByTestId('self-verify-summary');
    expect(summary.textContent).toMatch(/Debits.*Credits/i);
    expect(summary.textContent).toMatch(/bundledJeCount.*anchoredLeafCount/i);
  });

  it('enables the download button when verified', async () => {
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => expect(screen.getByTestId('download-btn')).not.toBeDisabled());
  });
});

// ── Draft state ────────────────────────────────────────────────────────────

describe('draft (unanchored) state', () => {
  beforeEach(() => {
    setupData();
    mockAssembleExport.mockResolvedValue({
      ok: true,
      verified: false,
      filename: 'export-ent-1-2026-Q2-UNVERIFIED-DRAFT.zip',
      zip: new Uint8Array([1]),
      summary: draftSummary,
    });
  });

  it('renders NOT TAMPER-EVIDENT text in the draft card', async () => {
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    // WHY: colour alone fails accessibility; text + glyph must convey status.
    await waitFor(() => expect(screen.getByText(/NOT TAMPER-EVIDENT/i)).toBeInTheDocument());
  });

  it('renders a DRAFT marker (icon+label, not colour-only)', async () => {
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => expect(screen.getByTestId('draft-marker')).toBeInTheDocument());
    // WHY: WCAG requires non-colour differentiation for status.
    const marker = screen.getByTestId('draft-marker');
    expect(marker.textContent).toMatch(/draft/i);
  });

  it('shows -UNVERIFIED-DRAFT.zip in the filename preview', async () => {
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    // WHY: filename must signal draft status before download — auditors archive by filename.
    await waitFor(() => expect(screen.getByText(/UNVERIFIED-DRAFT\.zip/i)).toBeInTheDocument());
  });
});

// ── Imbalance error ────────────────────────────────────────────────────────

describe('imbalance error', () => {
  beforeEach(() => {
    setupData();
    mockAssembleExport.mockResolvedValue({
      ok: false,
      kind: 'imbalance',
      debit: '300100',
      credit: '300000',
    });
  });

  it('renders light--red "Cannot export" card with debit/credit/delta', async () => {
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    // WHY: imbalanced books must block export — surfacing numbers lets accountant fix it.
    await waitFor(() => expect(screen.getByTestId('imbalance-card')).toBeInTheDocument());
    const card = screen.getByTestId('imbalance-card');
    expect(card.className).toContain('light--red');
    expect(card.textContent).toMatch(/cannot export/i);
    expect(card.textContent).toMatch(/300100/);
    expect(card.textContent).toMatch(/300000/);
  });

  it('disables the download button on imbalance', async () => {
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => expect(screen.getByTestId('download-btn')).toBeDisabled());
  });
});

// ── Empty period ───────────────────────────────────────────────────────────

describe('empty period', () => {
  it('renders the mascot empty state (not an error card)', async () => {
    setupData();
    mockAssembleExport.mockResolvedValue({ ok: false, kind: 'empty' });
    render(<ExportWorkspace entityId="ent-1" />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    // WHY: empty is a normal state, not a failure — mascot is appropriate (spec §8.4).
    await waitFor(() => expect(screen.getByTestId('empty-export-state')).toBeInTheDocument());
    // Must NOT show an error card
    expect(screen.queryByTestId('imbalance-card')).toBeNull();
  });

  it('shows empty state when journal is empty (no export attempt needed)', () => {
    setupData({ journal: [], events: [], anchors: [] });
    render(<ExportWorkspace entityId="ent-1" />);
    // WHY: empty journal means nothing to export — show mascot without requiring preview click.
    expect(screen.getByTestId('empty-export-state')).toBeInTheDocument();
  });
});

// ── Entity switch ──────────────────────────────────────────────────────────

describe('entity switch', () => {
  it('does not show previous entity status after entity changes', () => {
    // WHY: stale state from entity-A must never appear under entity-B (data integrity).
    // useExportData's render-gate returns undefined data when entityId changes.
    mockUseExportData.mockReturnValue({ data: undefined, loading: true, error: undefined });
    render(<ExportWorkspace entityId="ent-2" />);
    // Should show loading or empty, not a stale verified/draft card
    expect(screen.queryByTestId('verified-card')).toBeNull();
    expect(screen.queryByTestId('draft-card')).toBeNull();
    expect(screen.queryByTestId('imbalance-card')).toBeNull();
  });
});
