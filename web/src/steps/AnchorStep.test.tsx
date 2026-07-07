import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EntityProvider } from '../app/EntityContext';
import * as endpoints from '../api/endpoints';

const signAndExecute = vi.fn();
vi.mock('../wallet/useWallet', () => ({ useWallet: () => ({ address: '0xwallet', signAndExecute }) }));

import { AnchorStep } from './AnchorStep';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><EntityProvider>{ui}</EntityProvider></QueryClientProvider>;
}

beforeEach(() => { signAndExecute.mockReset(); });

it('snapshot → prepare → wallet sign(txKind) → confirm(digest, expectedSeq) in order', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 3, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'prepareAnchor').mockResolvedValue({ txKind: 'IR_KIND', expectedSeq: 4, chainId: '0xC', capId: '0x266e' });
  vi.spyOn(endpoints, 'getJournal').mockResolvedValue([]);

  // Track call order for m3
  const callSequence: string[] = [];
  signAndExecute.mockImplementation(async () => { callSequence.push('signAndExecute'); return { digest: '0xDIGEST' }; });
  vi.spyOn(endpoints, 'confirmAnchor').mockImplementation(async () => { callSequence.push('confirm'); return { id: 'a1', snapshotId: 's1', seq: 4, link: '0xLINK', digest: '0xDIGEST', explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIGEST', anchoredAt: '2026-06-22T00:00:00Z', merkleRoot: null, periodId: '', leafCount: 0 }; });
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({ anchors: [], inclusionProof: null });

  render(wrap(<AnchorStep />));
  await userEvent.click(await screen.findByRole('button', { name: /freeze snapshot/i }));
  await userEvent.click(await screen.findByRole('button', { name: /anchor on-chain/i }));

  await waitFor(() => expect(signAndExecute).toHaveBeenCalledWith('IR_KIND'));
  await waitFor(() => expect(endpoints.confirmAnchor).toHaveBeenCalledWith('acme:pilot-001', { snapshotId: 's1', digest: '0xDIGEST', expectedSeq: 4 }));
  expect(await screen.findAllByText(/0xDIGEST/)).not.toHaveLength(0);

  // m3: signAndExecute must precede confirm
  expect(callSequence.indexOf('signAndExecute')).toBeLessThan(callSequence.indexOf('confirm'));
});

it('wallet rejection: confirm is NOT called, error is shown, no crash', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 3, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'prepareAnchor').mockResolvedValue({ txKind: 'IR_KIND', expectedSeq: 4, chainId: '0xC', capId: '0x266e' });
  vi.spyOn(endpoints, 'getJournal').mockResolvedValue([]);
  signAndExecute.mockRejectedValue(new Error('User rejected'));
  const confirmSpy = vi.spyOn(endpoints, 'confirmAnchor');
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({ anchors: [], inclusionProof: null });

  render(wrap(<AnchorStep />));
  await userEvent.click(await screen.findByRole('button', { name: /freeze snapshot/i }));
  await userEvent.click(await screen.findByRole('button', { name: /anchor on-chain/i }));

  await screen.findByText(/User rejected/);
  expect(confirmSpy).not.toHaveBeenCalled();
});

it('hash-chain renders seq blocks from useAnchors', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 3, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'getJournal').mockResolvedValue([]);
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({
    anchors: [
      { id: 'a0', snapshotId: 's0', seq: 1, link: '0xLINK1', digest: '0xDIG1', explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIG1', anchoredAt: '2026-06-01T00:00:00Z', merkleRoot: null, periodId: '', leafCount: 0 },
      { id: 'a1', snapshotId: 's1', seq: 2, link: '0xLINK2', digest: '0xDIG2', explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIG2', anchoredAt: '2026-06-02T00:00:00Z', merkleRoot: null, periodId: '', leafCount: 0 },
    ],
    inclusionProof: null,
  });

  render(wrap(<AnchorStep />));
  await screen.findByText(/seq #1/i);
  await screen.findByText(/seq #2/i);
});

it('HashChain panel has no Mascot', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 3, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'getJournal').mockResolvedValue([]);
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({
    anchors: [{ id: 'a0', snapshotId: 's0', seq: 1, link: '0xLINK1', digest: '0xDIG1', explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIG1', anchoredAt: '2026-06-01T00:00:00Z', merkleRoot: null, periodId: '', leafCount: 0 }],
    inclusionProof: null,
  });

  const { container } = render(wrap(<AnchorStep />));
  await screen.findByText(/seq #1/i);
  // austere panel: no mascot SVG/img in the hash-chain section
  const austere = container.querySelector('.austere');
  expect(austere?.querySelector('img, svg[data-mascot]')).toBeNull();
});

// C2: inclusion proof renders when useAnchors returns non-null inclusionProof,
// and useAnchors is called with journal[0].idempotencyKey (not undefined)
it('renders inclusion proof block when useAnchors returns non-null proof (C2)', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 3, supersedesSeq: null, status: 'FROZEN' });

  const journalSpy = vi.spyOn(endpoints, 'getJournal').mockResolvedValue([
    { id: 'je1', eventId: 'ev1', idempotencyKey: 'ikey-abc', leafHash: '0xLH', je: { idempotencyKey: 'ikey-abc', lineageHash: '0xLIN', reversalOf: null, lines: [] } },
  ]);
  const anchorsSpy = vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({
    anchors: [{ id: 'a0', snapshotId: 's0', seq: 1, link: '0xLINK1', digest: '0xDIG1', explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIG1', anchoredAt: '2026-06-01T00:00:00Z', merkleRoot: null, periodId: '', leafCount: 0 }],
    inclusionProof: {
      idempotencyKey: 'ikey-abc',
      leafIndex: 2,
      siblings: [{ hash: '0xSIB1', position: 'L' }, { hash: '0xSIB2', position: 'R' }],
      merkleRoot: '0xROOT1234567890AB',
    },
  });

  render(wrap(<AnchorStep />));

  // Wait for inclusion proof text to appear
  await screen.findByText(/Inclusion proof/i);
  expect(screen.getByText(/leaf #2/i)).toBeTruthy();
  expect(screen.getByText(/2 siblings/i)).toBeTruthy();
  expect(screen.getByText(/0xROOT/i)).toBeTruthy();

  // useAnchors must have been called with the journal[0].idempotencyKey, not undefined
  await waitFor(() => {
    expect(anchorsSpy).toHaveBeenCalledWith('acme:pilot-001', 'ikey-abc');
  });
  expect(journalSpy).toHaveBeenCalledWith('acme:pilot-001');
});

it('useAnchors called with undefined key (no crash) when journal is empty (C2 guard)', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 3, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'getJournal').mockResolvedValue([]);
  const anchorsSpy = vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({ anchors: [], inclusionProof: null });

  render(wrap(<AnchorStep />));
  await screen.findByText(/No anchors yet/i);

  // When journal is empty, idempotencyKey is undefined — getAnchors called without key
  await waitFor(() => {
    expect(anchorsSpy).toHaveBeenCalledWith('acme:pilot-001', undefined);
  });
});

// W-F2: stale Freeze CTA must read the NEXT version = latestSnapshotSeq + 1.
// Distinct anchoredSeq (2) vs latestSnapshotSeq (5) so the assertion pins the field
// CHOICE, not just the +1: reading anchoredSeq would render v3, this expects v6.
it('stale Freeze CTA reads "Freeze restatement (v{latestSnapshotSeq+1})", using latestSnapshotSeq not anchoredSeq', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 3, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'getJournal').mockResolvedValue([]);
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({ anchors: [], inclusionProof: null });

  render(wrap(<AnchorStep anchorStaleness={{ stale: true, anchoredSeq: 2, anchoredRoot: '0xAR', currentRoot: '0xCR', latestSnapshotSeq: 5 }} />));
  expect(await screen.findByRole('button', { name: /freeze restatement \(v6\)/i })).toBeTruthy();
});
