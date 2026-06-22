import * as api from './endpoints';

function mockOnce(body: unknown, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

beforeEach(() => { vi.restoreAllMocks(); });

it('listEntities returns the entities array', async () => {
  mockOnce({ entities: [{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }] });
  const out = await api.listEntities();
  expect(out[0]!.id).toBe('acme:pilot-001');
});

it('classifyEvent surfaces degraded flag', async () => {
  mockOnce({ event: { id: 'e1', entityId: 'acme:pilot-001', status: 'NEEDS_REVIEW', normalized: {}, ai: null, final: null, routing: 'NEEDS_REVIEW' }, degraded: true });
  const out = await api.classifyEvent('e1');
  expect(out.degraded).toBe(true);
  expect(out.event.status).toBe('NEEDS_REVIEW');
});

it('prepareAnchor posts walletAddress + snapshotId and returns txKind', async () => {
  mockOnce({ txKind: 'IR_BYTES', expectedSeq: 4, chainId: '0xabc', capId: '0x266e' });
  const out = await api.prepareAnchor('acme:pilot-001', { snapshotId: 's1', walletAddress: '0xwallet' });
  expect(out.txKind).toBe('IR_BYTES');
  expect(out.expectedSeq).toBe(4);
});

it('getAnchors passes idempotencyKey as a query param', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify({ anchors: [], inclusionProof: null }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  await api.getAnchors('acme:pilot-001', 'key-1');
  expect(String(spy.mock.calls[0]![0])).toContain('idempotencyKey=key-1');
});
