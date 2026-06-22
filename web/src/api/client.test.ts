import { fetchJson, ApiClientError } from './client';

beforeEach(() => { vi.restoreAllMocks(); });

it('parses a success body', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  await expect(fetchJson<{ ok: number }>('/x')).resolves.toEqual({ ok: 1 });
});

it('throws ApiClientError carrying the envelope code', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error: { code: 'BAD_STATE', message: 'nope' } }), {
      status: 409, headers: { 'content-type': 'application/json' },
    }),
  );
  await expect(fetchJson('/x')).rejects.toMatchObject({ code: 'BAD_STATE', message: 'nope' });
});

it('throws a generic ApiClientError on a non-envelope 500', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
  await expect(fetchJson('/x')).rejects.toBeInstanceOf(ApiClientError);
});
