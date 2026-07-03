import type { GeminiClient, GeminiSchema } from './geminiClient.js';

export interface ClassifySuggestion {
  eventType: string;
  economicPurpose: string;
  counterparty: string | null;
  confidence: number;
  reasoning: string;
}

export interface ClassifyOutput {
  suggestion: ClassifySuggestion;
  routing: 'AUTO' | 'NEEDS_REVIEW';
  degraded: boolean;
}

const RESPONSE_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    eventType: { type: 'STRING' },
    economicPurpose: { type: 'STRING' },
    counterparty: { type: 'STRING', nullable: true },
    confidence: { type: 'NUMBER' },
    reasoning: { type: 'STRING' },
  },
  required: ['eventType', 'economicPurpose', 'confidence', 'reasoning'],
};

/**
 * Deterministic AUTO gate (review F3, 2026-07-03). Routing is a code decision, not an
 * LLM judgment: AUTO requires (1) the ingestion-normalized eventType to be on this
 * allow-list, (2) the LLM suggestion to AGREE with it, and (3) confidence ≥ threshold.
 * The self-reported confidence alone can never reach AUTO — a prompt injection via
 * event memo/counterparty fields inflating confidence or steering the suggestion
 * still lands in NEEDS_REVIEW.
 */
const AUTO_ALLOWLIST: ReadonlySet<string> = new Set(['DIGITAL_ASSET_RECEIPT', 'DIGITAL_ASSET_PAYMENT']);

const DEGRADED: ClassifySuggestion = {
  eventType: 'NEEDS_REVIEW',
  economicPurpose: 'unknown',
  counterparty: null,
  confidence: 0,
  reasoning: 'AI classification failed; routed to human review',
};

export async function classifyEvent(
  input: { rawJson: string },
  deps: { client: GeminiClient; model: string; threshold: number },
): Promise<ClassifyOutput> {
  try {
    const parsed = JSON.parse(input.rawJson) as Record<string, unknown>;
    const prompt = `Classify this financial event for accounting purposes. Respond with valid JSON only.\n\nEvent: ${JSON.stringify(parsed)}\n\nProvide:\n- eventType: category (e.g. DIGITAL_ASSET_RECEIPT, DIGITAL_ASSET_PAYMENT)\n- economicPurpose: brief description\n- counterparty: address or null\n- confidence: float 0.0-1.0\n- reasoning: brief explanation`;
    const raw = await deps.client.generateJson<{
      eventType: string; economicPurpose: string; counterparty?: string | null; confidence: unknown; reasoning: string;
    }>(deps.model, prompt, RESPONSE_SCHEMA);

    const confidence = typeof raw.confidence === 'number' && isFinite(raw.confidence) && raw.confidence >= 0 && raw.confidence <= 1
      ? raw.confidence : 0;
    const isValidConf = typeof raw.confidence === 'number' && isFinite(raw.confidence) && raw.confidence >= 0 && raw.confidence <= 1;
    if (!isValidConf) {
      return { suggestion: { ...DEGRADED, eventType: raw.eventType ?? 'NEEDS_REVIEW', economicPurpose: raw.economicPurpose ?? 'unknown', counterparty: raw.counterparty ?? null, confidence: 0, reasoning: raw.reasoning ?? '' }, routing: 'NEEDS_REVIEW', degraded: true };
    }
    const rawEventType = typeof parsed.eventType === 'string' ? parsed.eventType : '';
    const routing: 'AUTO' | 'NEEDS_REVIEW' =
      AUTO_ALLOWLIST.has(rawEventType) && raw.eventType === rawEventType && confidence >= deps.threshold
        ? 'AUTO' : 'NEEDS_REVIEW';
    return {
      suggestion: { eventType: raw.eventType, economicPurpose: raw.economicPurpose, counterparty: raw.counterparty ?? null, confidence, reasoning: raw.reasoning },
      routing,
      degraded: false,
    };
  } catch {
    return { suggestion: DEGRADED, routing: 'NEEDS_REVIEW', degraded: true };
  }
}
