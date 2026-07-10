import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetRegistryPanel } from './AssetRegistryPanel';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

// The real backend wire shape (services/api/src/http/errors.ts → toEnvelope, mirrored by
// web/src/api/client.ts isEnvelope): errors are the NESTED envelope { error: { code, message } },
// never a flat { code }. The panel must read `body.error.code`; a test that mocked the flat shape
// would pass against a panel that never parses real API errors.
const okList = (assets: unknown[]) =>
  ({ ok: true, status: 200, text: async () => JSON.stringify({ assets }) });
const okRow = (row: unknown, status = 201) =>
  ({ ok: true, status, text: async () => JSON.stringify(row) });
const err = (status: number, code: string) =>
  ({ ok: false, status, text: async () => JSON.stringify({ error: { code, message: code } }) });

// A promise we resolve by hand — lets a test observe a pending phase (probing / submitting).
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const CHAIN_ROW = {
  entityId: 'e1', coinType: '0x2::sui::SUI', decimals: 9, symbol: 'SUI', displayName: 'Sui',
  source: 'chain', chainObjectId: '0xmeta', metadataCapState: 'DELETED', fetchedAt: '2026-07-10T00:00:00Z',
  decidedBy: null, reason: null, createdAt: '2026-07-10T00:00:00Z',
};

describe('AssetRegistryPanel — list', () => {
  it('shows the empty state (why: every asset must be registered before close)', async () => {
    fetchMock.mockResolvedValueOnce(okList([]));
    render(<AssetRegistryPanel entityId="e1" />);
    expect(await screen.findByText(/every asset your books touch must be registered/i)).toBeInTheDocument();
  });

  it('grades a chain-verified asset differently from a manual one, same pill weight', async () => {
    fetchMock.mockResolvedValueOnce(okList([
      { ...CHAIN_ROW, coinType: '0x2::sui::SUI', metadataCapState: 'DELETED' },
      { entityId: 'e1', coinType: '0xacme::a::A', decimals: 8, symbol: 'ACME', displayName: 'ACME',
        source: 'manual', chainObjectId: null, metadataCapState: null, fetchedAt: null,
        decidedBy: 'demo-controller', reason: 'private treasury coin, no chain metadata', createdAt: 'x' },
    ]));
    render(<AssetRegistryPanel entityId="e1" />);

    const chainPill = await screen.findByText(/chain-verified/i);
    const manualPill = screen.getByText(/manual · unverified/i);
    // WHY: manual is a disclosure, not a defect. It must NOT carry the debit/error class, or an
    // operator reads it as "I did something wrong" and is tempted to fabricate a chain value.
    expect(manualPill).toHaveClass('ar-pill--manual');
    expect(manualPill).not.toHaveClass('ar-err');
    expect(manualPill.className).not.toMatch(/debit/);
    expect(chainPill).toHaveClass('ar-pill--chain');

    // Hover titles carry the audit re-verification anchors (no chainObjectVersion — proto has none).
    expect(chainPill).toHaveAttribute('title', 'CoinMetadata 0xmeta · cap DELETED · fetched 2026-07-10T00:00:00Z');
    expect(manualPill).toHaveAttribute('title', 'declared by demo-controller · private treasury coin, no chain metadata');
  });

  it('flags a CLAIMED chain asset as revocable, but a DELETED one as frozen', async () => {
    fetchMock.mockResolvedValueOnce(okList([
      { ...CHAIN_ROW, coinType: '0xa::c::C', symbol: 'CCC', metadataCapState: 'CLAIMED' },
      { ...CHAIN_ROW, coinType: '0xb::d::D', symbol: 'DDD', metadataCapState: 'DELETED' },
    ]));
    render(<AssetRegistryPanel entityId="e1" />);
    // CLAIMED/UNCLAIMED: someone can still mutate metadata → chain-verified is time-sensitive.
    expect(await screen.findByText(/revocable/i)).toBeInTheDocument();
    // Exactly one revocable marker: DELETED is permanently frozen, no marker.
    expect(screen.getAllByText(/revocable/i)).toHaveLength(1);
  });
});

describe('AssetRegistryPanel — probe flow', () => {
  async function seedEmpty() {
    fetchMock.mockResolvedValueOnce(okList([]));
    render(<AssetRegistryPanel entityId="e1" />);
    await screen.findByText(/every asset/i);
  }

  it('probing: shows the on-chain fetch status and disables the input', async () => {
    await seedEmpty();
    const d = deferred<typeof CHAIN_ROW>();
    fetchMock.mockReturnValueOnce({ ok: true, status: 201, text: async () => JSON.stringify(await d.promise) });
    await userEvent.type(screen.getByLabelText(/coin type/i), '0x2::sui::SUI');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    expect(await screen.findByText(/Fetching CoinMetadata on-chain/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/coin type/i)).toBeDisabled();
    d.resolve(CHAIN_ROW);
  });

  it('chain-hit: a chain probe registers and previews read-only decimals + object id', async () => {
    await seedEmpty();
    fetchMock.mockResolvedValueOnce(okRow(CHAIN_ROW, 201));
    await userEvent.type(screen.getByLabelText(/coin type/i), '0x2::sui::SUI');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));

    const result = await screen.findByTestId('ar-chain-hit');
    expect(within(result).getByText('9')).toBeInTheDocument();          // decimals, read-only
    expect(within(result).getByText(/chain-verified/i)).toBeInTheDocument();
    expect(within(result).getByText(/0xmeta/)).toBeInTheDocument();     // chainObjectId
    // No manual decimals INPUT anywhere — chain decimals are not human-editable.
    expect(screen.queryByLabelText(/^decimals$/i)).toBeNull();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
  });

  it('MUTATION-GUARD #1: a 503 node outage stays in error and NEVER reveals manual fields', async () => {
    // WHY (V6): @mysten/sui getCoinMetadata cannot distinguish a transport error from "no
    // metadata". If an operator reads 503 as "no metadata" and hand-types a scale, D7 makes that
    // permanent — one network blip permanently downgrades a chain-verifiable asset to a claim.
    await seedEmpty();
    fetchMock.mockResolvedValueOnce(err(503, 'CHAIN_UNREACHABLE'));
    await userEvent.type(screen.getByLabelText(/coin type/i), '0x2::sui::SUI');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    // Settle on a branch-independent anchor: the Probe form is gone in BOTH the (correct) error
    // branch and the (mutated) manual branch, so the decimals assertion below is the one under test.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^probe$/i })).toBeNull());
    // MUTATION-GUARD #1 (primary): a 503 must NOT surface manual fields. If the 503 branch is
    // rerouted into manual-required, this decimals input appears and this line goes red.
    expect(screen.queryByLabelText(/^decimals$/i)).toBeNull();
    expect(screen.queryByLabelText(/reason/i)).toBeNull();
    // MUTATION-GUARD #2: the copy must draw the transport-vs-absence line explicitly.
    expect(screen.getByText(/not the same as "no metadata"/i)).toBeInTheDocument();
  });

  it('503 CHAIN_CLIENT_UNAVAILABLE reports the server has no Sui client, still no manual fields', async () => {
    await seedEmpty();
    fetchMock.mockResolvedValueOnce(err(503, 'CHAIN_CLIENT_UNAVAILABLE'));
    await userEvent.type(screen.getByLabelText(/coin type/i), '0x2::sui::SUI');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    expect(await screen.findByText(/no Sui client configured/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^decimals$/i)).toBeNull();
  });

  it('manual-required: only a genuine "no metadata" 400 reveals decimals/symbol/reason', async () => {
    await seedEmpty();
    fetchMock.mockResolvedValueOnce(err(400, 'MANUAL_DECIMALS_REQUIRED'));
    await userEvent.type(screen.getByLabelText(/coin type/i), '0xacme::a::A');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    expect(await screen.findByLabelText(/^decimals$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/symbol/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
    // The manual preview badge is present and in brass (never red).
    const badge = screen.getByText(/manual · unverified/i);
    expect(badge).toHaveClass('ar-pill--manual');
  });

  it('manual: Confirm stays disabled until reason reaches the 12-char substance floor', async () => {
    await seedEmpty();
    fetchMock.mockResolvedValueOnce(err(400, 'MANUAL_DECIMALS_REQUIRED'));
    await userEvent.type(screen.getByLabelText(/coin type/i), '0xacme::a::A');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    await screen.findByLabelText(/^decimals$/i);

    await userEvent.type(screen.getByLabelText(/^decimals$/i), '8');
    await userEvent.type(screen.getByLabelText(/symbol/i), 'ACME');
    await userEvent.type(screen.getByLabelText(/reason/i), 'too short'); // 9 chars
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason/i), ' but now long enough');
    expect(screen.getByRole('button', { name: /confirm/i })).toBeEnabled();
  });

  it('submitting: manual Confirm disables while the POST is in flight', async () => {
    await seedEmpty();
    fetchMock.mockResolvedValueOnce(err(400, 'MANUAL_DECIMALS_REQUIRED'));
    await userEvent.type(screen.getByLabelText(/coin type/i), '0xacme::a::A');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    await screen.findByLabelText(/^decimals$/i);
    await userEvent.type(screen.getByLabelText(/^decimals$/i), '8');
    await userEvent.type(screen.getByLabelText(/symbol/i), 'ACME');
    await userEvent.type(screen.getByLabelText(/reason/i), 'private treasury coin');

    const d = deferred<unknown>();
    fetchMock.mockReturnValueOnce({ ok: true, status: 201, text: async () => JSON.stringify(await d.promise) });
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(await screen.findByRole('button', { name: /registering/i })).toBeDisabled();
    d.resolve({ ...CHAIN_ROW });
  });

  it('renders the 409 ASSET_DECIMALS_CONFLICT restatement copy', async () => {
    await seedEmpty();
    fetchMock.mockResolvedValueOnce(err(409, 'ASSET_DECIMALS_CONFLICT'));
    await userEvent.type(screen.getByLabelText(/coin type/i), '0x2::sui::SUI');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    expect(await screen.findByText(/needs a restatement/i)).toBeInTheDocument();
  });

  it('renders the 400 INVALID_COIN_TYPE copy', async () => {
    await seedEmpty();
    fetchMock.mockResolvedValueOnce(err(400, 'INVALID_COIN_TYPE'));
    await userEvent.type(screen.getByLabelText(/coin type/i), 'garbage');
    await userEvent.click(screen.getByRole('button', { name: /probe/i }));
    expect(await screen.findByText(/Expected 0x…::module::TYPE/i)).toBeInTheDocument();
    // INVALID_COIN_TYPE is a format error, not an absence-of-metadata one — no manual fields.
    expect(screen.queryByLabelText(/^decimals$/i)).toBeNull();
  });
});
