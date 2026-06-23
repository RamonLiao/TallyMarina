/**
 * Anchor dedupe regression — isolated file (vi.mock hoisting, see monkey.anchor).
 *
 * WHY THIS MATTERS: after confirm, AnchorStep renders the freshly-confirmed anchor
 * immediately while useAnchors refetches. Once the refetch lands, that same anchor
 * (same id) is also in the fetched list — naively concatenating them produces TWO
 * React children with the same key, which React may drop/duplicate silently. The
 * chain view must show each on-chain anchor exactly once.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EntityProvider } from '../app/EntityContext';
import * as endpoints from '../api/endpoints';

vi.mock('../wallet/useWallet', () => ({
  useWallet: () => ({ address: '0xwallet', signAndExecute: vi.fn().mockResolvedValue({ digest: '0xDIGEST' }) }),
}));

it('renders a confirmed anchor exactly once even after the refetch returns the same id', async () => {
  const { AnchorStep } = await import('../steps/AnchorStep');
  const anchor = {
    id: 'anchor-acme:pilot-001-6', snapshotId: 's1', seq: 6,
    link: 'bba6b582146c1afc', digest: '0xDIGEST',
    explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIGEST', anchoredAt: '2026-06-22T00:00:00Z',
    merkleRoot: null,
  };
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 1, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'prepareAnchor').mockResolvedValue({ txKind: 'IR', expectedSeq: 6, chainId: '0xC', capId: '0x266e' });
  vi.spyOn(endpoints, 'confirmAnchor').mockResolvedValue(anchor);
  // The refetch returns the SAME anchor the confirm produced — the collision case.
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({ anchors: [anchor], inclusionProof: null });
  vi.spyOn(endpoints, 'getJournal').mockResolvedValue([]);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><EntityProvider><AnchorStep /></EntityProvider></QueryClientProvider>);

  await userEvent.click(await screen.findByRole('button', { name: /freeze snapshot/i }));
  await userEvent.click(await screen.findByRole('button', { name: /anchor on-chain/i }));

  // The celebration confirms the flow completed.
  await waitFor(() => expect(screen.getAllByText(/seq #6/i).length).toBe(1));
});
