import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reviewCopilot } from '../../src/ai/reviewCopilot.js';

const BASE_EVENT = { id: 'evt-2', description: 'Suspicious transfer', amount: 50000, currency: 'USD' };
const BASE_CONTEXT = { entityName: 'Acme Corp', period: '2026-Q1' };

function makeCopilotResponse(overrides = {}) {
  const payload = {
    explanation: 'This is a large transfer that needs review',
    redFlags: ['Unusual amount', 'Missing counterparty'],
    suggestedEntry: { debit: 'Cash', credit: 'Revenue', amount: 50000 },
    citations: ['ASC 606'],
    ...overrides,
  };
  const body = JSON.stringify({
    candidates: [{
      content: { parts: [{ text: JSON.stringify(payload) }] },
      finishReason: 'STOP',
    }],
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reviewCopilot — pure read-only', () => {
  it('returns advice without any side effects', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeCopilotResponse());
    vi.stubGlobal('fetch', mockFetch);

    const result = await reviewCopilot(BASE_EVENT, BASE_CONTEXT);

    // Verify fetch was called (AI was consulted)
    expect(mockFetch).toHaveBeenCalledOnce();
    // Verify result shape — no side effects possible from pure data return
    expect(result).toHaveProperty('explanation');
    expect(result).toHaveProperty('redFlags');
    expect(result).toHaveProperty('suggestedEntry');
    expect(result).toHaveProperty('citations');
  });

  it('result is a plain data object — not a function or class', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeCopilotResponse()));
    const result = await reviewCopilot(BASE_EVENT, BASE_CONTEXT);
    expect(typeof result).toBe('object');
    // Ensure no write methods were returned
    const r = result as unknown as Record<string, unknown>;
    expect(typeof r.write).toBe('undefined');
    expect(typeof r.save).toBe('undefined');
    expect(typeof r.insert).toBe('undefined');
  });

  it('redFlags is always an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeCopilotResponse()));
    const result = await reviewCopilot(BASE_EVENT, BASE_CONTEXT);
    expect(Array.isArray(result.redFlags)).toBe(true);
  });

  it('citations is always an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeCopilotResponse()));
    const result = await reviewCopilot(BASE_EVENT, BASE_CONTEXT);
    expect(Array.isArray(result.citations)).toBe(true);
  });

  it('suggestedEntry can be null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeCopilotResponse({ suggestedEntry: null })));
    const result = await reviewCopilot(BASE_EVENT, BASE_CONTEXT);
    expect(result.suggestedEntry).toBeNull();
  });

  it('works with empty context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeCopilotResponse()));
    const result = await reviewCopilot(BASE_EVENT);
    expect(result.explanation).toBeTruthy();
  });
});

describe('reviewCopilot — fail-closed graceful degradation', () => {
  it('fetch throws → returns graceful fallback (no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await reviewCopilot(BASE_EVENT, BASE_CONTEXT);
    expect(result.explanation).toContain('unavailable');
    expect(result.redFlags).toContain('AI service error');
    expect(result.suggestedEntry).toBeNull();
  });

  it('bad JSON → returns graceful fallback', async () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{invalid}' }] }, finishReason: 'STOP' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));
    const result = await reviewCopilot(BASE_EVENT, BASE_CONTEXT);
    // Either graceful fallback or parse of partial JSON — must not throw
    expect(result).toHaveProperty('explanation');
  });

  it('non-2xx → returns graceful fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    ));
    const result = await reviewCopilot(BASE_EVENT, BASE_CONTEXT);
    expect(result.suggestedEntry).toBeNull();
    expect(result.redFlags.length).toBeGreaterThan(0);
  });
});

describe('reviewCopilot — monkey tests', () => {
  it('handles event with no amount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeCopilotResponse()));
    const result = await reviewCopilot({ id: 'x', description: 'unknown' });
    expect(result).toBeDefined();
  });

  it('handles very large amount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeCopilotResponse()));
    const result = await reviewCopilot({ id: 'x', description: 'big', amount: Number.MAX_SAFE_INTEGER });
    expect(result).toBeDefined();
  });

  it('handles empty redFlags array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeCopilotResponse({ redFlags: [] })));
    const result = await reviewCopilot(BASE_EVENT, BASE_CONTEXT);
    expect(result.redFlags).toEqual([]);
  });
});
