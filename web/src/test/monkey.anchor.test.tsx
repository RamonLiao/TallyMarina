/**
 * Wallet rejection monkey test — isolated to its own file so vi.mock hoisting
 * doesn't collide with monkey.test.tsx (which doesn't mock useWallet).
 *
 * WHY THIS MATTERS: A wallet rejection mid-anchor must be fail-closed —
 * confirmAnchor must NEVER be called if the user rejects the wallet signature.
 * If this protection were removed, the backend would write an ANCHORED record
 * without a valid on-chain transaction, corrupting the audit trail.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EntityProvider } from '../app/EntityContext';
import * as endpoints from '../api/endpoints';

const rejectSign = vi.fn().mockRejectedValue(new Error('user rejected'));
vi.mock('../wallet/useWallet', () => ({ useWallet: () => ({ address: '0xwallet', signAndExecute: rejectSign }) }));

it('wallet rejection mid-flow surfaces the error and never calls confirmAnchor', async () => {
  const { AnchorStep } = await import('../steps/AnchorStep');
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 1, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'prepareAnchor').mockResolvedValue({ txKind: 'IR', expectedSeq: 1, chainId: '0xC', capId: '0x266e' });
  const confirmSpy = vi.spyOn(endpoints, 'confirmAnchor');
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({ anchors: [], inclusionProof: null });
  vi.spyOn(endpoints, 'getJournal').mockResolvedValue([]);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><EntityProvider><AnchorStep /></EntityProvider></QueryClientProvider>);

  // Freeze snapshot first
  await userEvent.click(await screen.findByRole('button', { name: /freeze snapshot/i }));
  // Trigger anchor — wallet will reject
  await userEvent.click(await screen.findByRole('button', { name: /anchor on-chain/i }));

  // Error message must surface to the user
  await waitFor(() => expect(screen.getByText(/user rejected/i)).toBeInTheDocument());

  // fail-closed: confirmAnchor MUST NOT be called when wallet rejects
  expect(confirmSpy).not.toHaveBeenCalled();
});
