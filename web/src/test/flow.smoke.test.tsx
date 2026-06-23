/**
 * 5-step smoke test — encodes spec §4 vertical slice end-to-end.
 * All external deps (wallet, API endpoints, dapp-kit) are mocked so the
 * test runs in jsdom with no real backend or chain extension.
 *
 * WHY THIS MATTERS: If the step machine or any step's advance button breaks,
 * this test fails — proving the full Ingest→Classify→Review→Journal→Anchor
 * path is wired correctly before any real on-chain or backend call.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import * as endpoints from '../api/endpoints';

const signAndExecute = vi.fn().mockResolvedValue({ digest: '0xDIGEST' });
vi.mock('../wallet/useWallet', () => ({ useWallet: () => ({ address: '0xwallet', signAndExecute }) }));
// Stub dapp-kit to inert nodes — jsdom has no real wallet extension
vi.mock('@mysten/dapp-kit-react/ui', () => ({ ConnectButton: () => <button>Connect</button> }));
// AppProviders wraps with DAppKitProvider — stub it to a pass-through so no real gRPC client
vi.mock('@mysten/dapp-kit-react', () => ({ DAppKitProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const entity = { id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' };

// Fresh QueryClient per test to avoid singleton state bleed from appQueryClient
function freshQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([entity]);
  vi.spyOn(endpoints, 'ingest').mockResolvedValue({ ingested: 2, events: [] });
  vi.spyOn(endpoints, 'listEvents').mockResolvedValue([
    { id: 'e1', entityId: entity.id, status: 'AUTO', normalized: {}, ai: { eventType: 'X', purpose: 'Y', counterparty: null, confidence: 0.92, reasoning: 'ok' }, final: null, routing: 'AUTO' },
  ]);
  vi.spyOn(endpoints, 'reviewQueue').mockResolvedValue([]);
  vi.spyOn(endpoints, 'runRules').mockResolvedValue({ posted: 1, skipped: 0, journal: [] });
  vi.spyOn(endpoints, 'getJournal').mockResolvedValue([
    { id: 'j1', eventId: 'e1', idempotencyKey: 'k1', leafHash: '0xabc1234567', je: { idempotencyKey: 'k1', lineageHash: '0xL', reversalOf: null, lines: [{ account: 'A', side: 'DEBIT', amountMinor: '10', origCoinType: null, origQtyMinor: null, priceRef: null, fxRef: null, leg: null }] } },
  ]);
  vi.spyOn(endpoints, 'snapshot').mockResolvedValue({ id: 's1', periodId: '2026-Q2', manifestHash: '0xMH', merkleRoot: '0xMR', leafCount: 1, supersedesSeq: null, status: 'FROZEN' });
  vi.spyOn(endpoints, 'prepareAnchor').mockResolvedValue({ txKind: 'IR', expectedSeq: 1, chainId: '0xC', capId: '0x266e' });
  vi.spyOn(endpoints, 'confirmAnchor').mockResolvedValue({ id: 'a1', snapshotId: 's1', seq: 1, link: '0xLINK', digest: '0xDIGEST', explorerUrl: 'https://suiscan.xyz/testnet/tx/0xDIGEST', anchoredAt: 't', merkleRoot: null });
  vi.spyOn(endpoints, 'getAnchors').mockResolvedValue({ anchors: [], inclusionProof: null });
  // Reset mock fn state (restoreAllMocks only restores spies)
  signAndExecute.mockClear();
  signAndExecute.mockResolvedValue({ digest: '0xDIGEST' });
});

it('drives ingest → classify → review → journal → anchor end-to-end', async () => {
  const qc = freshQC();
  render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  );
  // Step 1→2: Ingest fixture
  await userEvent.click(await screen.findByRole('button', { name: /ingest fixture/i }));
  // Step 2→3: All events are AUTO so "Go to review" appears after classify
  await userEvent.click(await screen.findByRole('button', { name: /go to review/i }));
  // Step 3→4: Queue is empty → "Post the journal" button is immediate
  await userEvent.click(await screen.findByRole('button', { name: /post the journal/i }));
  // Step 4→5: getJournal mock already has data so "Snapshot & anchor" appears directly
  // (Run rules button only shows when journal is empty — with mock data it's pre-populated)
  await userEvent.click(await screen.findByRole('button', { name: /snapshot & anchor/i }));
  // Anchor step: freeze snapshot
  await userEvent.click(await screen.findByRole('button', { name: /freeze snapshot/i }));
  // Anchor on-chain
  await userEvent.click(await screen.findByRole('button', { name: /anchor on-chain/i }));
  // Wallet must have been called with the txKind from prepareAnchor
  await waitFor(() => expect(signAndExecute).toHaveBeenCalledWith('IR'));
  // Celebration screen confirms successful anchor
  await screen.findByText(/Anchored on-chain/i);
});
