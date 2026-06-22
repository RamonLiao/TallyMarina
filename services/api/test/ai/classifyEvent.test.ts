import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyEvent } from '../../src/ai/classifyEvent.js';

const BASE_EVENT = { id: 'evt-1', description: 'Payment received', amount: 100, currency: 'USD' };

function makeGeminiResponse(confidence: number) {
  const body = JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            eventType: 'revenue',
            economicPurpose: 'product sale',
            counterparty: 'Acme Corp',
            confidence,
            reasoning: 'It is a payment received',
          }),
        }],
      },
      finishReason: 'STOP',
    }],
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.AI_CONFIDENCE_THRESHOLD;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('classifyEvent — routing boundary', () => {
  it('confidence 0.84 → NEEDS_REVIEW', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeGeminiResponse(0.84)));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
    expect(result.confidence).toBe(0.84);
  });

  it('confidence 0.85 → AUTO (boundary)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeGeminiResponse(0.85)));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('AUTO');
    expect(result.confidence).toBe(0.85);
  });

  it('confidence 0.9 → AUTO', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeGeminiResponse(0.9)));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('AUTO');
  });

  it('confidence 0.0 → NEEDS_REVIEW', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeGeminiResponse(0.0)));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
  });

  it('custom threshold 0.9: confidence 0.89 → NEEDS_REVIEW', async () => {
    process.env.AI_CONFIDENCE_THRESHOLD = '0.9';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeGeminiResponse(0.89)));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
  });

  it('custom threshold 0.9: confidence 0.9 → AUTO', async () => {
    process.env.AI_CONFIDENCE_THRESHOLD = '0.9';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeGeminiResponse(0.9)));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('AUTO');
  });
});

describe('classifyEvent — fail-closed', () => {
  it('fetch throws → NEEDS_REVIEW', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
    expect(result.eventType).toBe('unknown');
  });

  it('non-2xx response → NEEDS_REVIEW', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Server Error', { status: 500 }),
    ));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
  });

  it('bad JSON in text field → NEEDS_REVIEW', async () => {
    const body = JSON.stringify({
      candidates: [{
        content: { parts: [{ text: 'not json at all {{{' }] },
        finishReason: 'STOP',
      }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
  });

  it('confidence NaN → NEEDS_REVIEW', async () => {
    // JSON cannot encode NaN; simulate by returning 'null' which becomes non-number
    const body = JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              eventType: 'revenue',
              economicPurpose: 'sale',
              counterparty: null,
              confidence: null, // null coerces to 0 but isValidConfidence rejects null
              reasoning: 'test',
            }),
          }],
        },
        finishReason: 'STOP',
      }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
  });

  it('confidence > 1 → NEEDS_REVIEW', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeGeminiResponse(1.5)));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
  });

  it('confidence < 0 → NEEDS_REVIEW', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeGeminiResponse(-0.1)));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
  });

  it('missing candidates in response → NEEDS_REVIEW', async () => {
    const body = JSON.stringify({ modelVersion: '001' }); // no candidates
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
  });

  it('AbortController timeout → NEEDS_REVIEW', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      const err = new Error('The operation was aborted');
      (err as NodeJS.ErrnoException).name = 'AbortError';
      return Promise.reject(err);
    }));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.routing).toBe('NEEDS_REVIEW');
  });
});

describe('classifyEvent — result shape', () => {
  it('returns all required fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeGeminiResponse(0.9)));
    const result = await classifyEvent(BASE_EVENT);
    expect(result).toHaveProperty('eventType');
    expect(result).toHaveProperty('economicPurpose');
    expect(result).toHaveProperty('counterparty');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reasoning');
    expect(result).toHaveProperty('routing');
  });

  it('counterparty is null when AI returns null', async () => {
    const body = JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              eventType: 'expense',
              economicPurpose: 'fee',
              counterparty: null,
              confidence: 0.9,
              reasoning: 'fee payment',
            }),
          }],
        },
        finishReason: 'STOP',
      }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));
    const result = await classifyEvent(BASE_EVENT);
    expect(result.counterparty).toBeNull();
  });
});
