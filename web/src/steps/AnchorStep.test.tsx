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

it('snapshot → prepare → wallet sign(txKind) → confirm(digest, expectedSeq)', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 3, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'prepareAnchor').mockResolvedValue({ txKind: 'IR_KIND', expectedSeq: 4, chainId: '0xC', capId: '0x266e' });
  signAndExecute.mockResolvedValue({ digest: '0xDIGEST' });
  vi.spyOn(endpoints, 'confirmAnchor').mockResolvedValue({ id: 'a1', snapshotId: 's1', seq: 4, link: '0xLINK', digest: '0xDIGEST', explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIGEST', anchoredAt: '2026-06-22T00:00:00Z' });
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({ anchors: [], inclusionProof: null });

  render(wrap(<AnchorStep />));
  await userEvent.click(await screen.findByRole('button', { name: /freeze snapshot/i }));
  await userEvent.click(await screen.findByRole('button', { name: /anchor on-chain/i }));

  await waitFor(() => expect(signAndExecute).toHaveBeenCalledWith('IR_KIND'));
  await waitFor(() => expect(endpoints.confirmAnchor).toHaveBeenCalledWith('acme:pilot-001', { snapshotId: 's1', digest: '0xDIGEST', expectedSeq: 4 }));
  expect(await screen.findAllByText(/0xDIGEST/)).not.toHaveLength(0);
});

it('wallet rejection: confirm is NOT called, error is shown, no crash', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 3, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'prepareAnchor').mockResolvedValue({ txKind: 'IR_KIND', expectedSeq: 4, chainId: '0xC', capId: '0x266e' });
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
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({
    anchors: [
      { id: 'a0', snapshotId: 's0', seq: 1, link: '0xLINK1', digest: '0xDIG1', explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIG1', anchoredAt: '2026-06-01T00:00:00Z' },
      { id: 'a1', snapshotId: 's1', seq: 2, link: '0xLINK2', digest: '0xDIG2', explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIG2', anchoredAt: '2026-06-02T00:00:00Z' },
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
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({
    anchors: [{ id: 'a0', snapshotId: 's0', seq: 1, link: '0xLINK1', digest: '0xDIG1', explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIG1', anchoredAt: '2026-06-01T00:00:00Z' }],
    inclusionProof: null,
  });

  const { container } = render(wrap(<AnchorStep />));
  await screen.findByText(/seq #1/i);
  // austere panel: no mascot SVG/img in the hash-chain section
  const austere = container.querySelector('.austere');
  expect(austere?.querySelector('img, svg[data-mascot]')).toBeNull();
});
