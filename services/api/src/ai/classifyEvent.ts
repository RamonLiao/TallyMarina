/**
 * classifyEvent.ts — AI-powered event classification.
 * Routing is CODE, not model. Fail-closed: any AI error → NEEDS_REVIEW.
 * NO posting authority. Zero write-store imports.
 */

import { callGemini } from './geminiClient.js';

export interface NormalizedEvent {
  id: string;
  description: string;
  amount?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface ClassifyResult {
  eventType: string;
  economicPurpose: string;
  counterparty: string | null;
  confidence: number;
  reasoning: string;
  routing: 'AUTO' | 'NEEDS_REVIEW';
}

const MODEL = process.env.AI_MODEL_CLASSIFY ?? 'gemini-flash-lite-latest';

const RESPONSE_SCHEMA = {
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

function isValidConfidence(c: unknown): c is number {
  if (typeof c !== 'number') return false;
  if (Number.isNaN(c)) return false;
  if (c < 0 || c > 1) return false;
  return true;
}

function computeRouting(confidence: number): 'AUTO' | 'NEEDS_REVIEW' {
  const threshold = Number(process.env.AI_CONFIDENCE_THRESHOLD ?? 0.85);
  return confidence >= threshold ? 'AUTO' : 'NEEDS_REVIEW';
}

export async function classifyEvent(event: NormalizedEvent): Promise<ClassifyResult> {
  const prompt = `Classify this financial event for accounting purposes. Respond with valid JSON only.

Event: ${JSON.stringify(event)}

Provide:
- eventType: category of the event (e.g. "revenue", "expense", "transfer", "fee")
- economicPurpose: brief description of the economic purpose
- counterparty: counterparty entity name or null if unknown
- confidence: float 0.0-1.0 indicating classification confidence
- reasoning: brief explanation of classification`;

  try {
    const raw = await callGemini<{
      eventType: string;
      economicPurpose: string;
      counterparty?: string | null;
      confidence: unknown;
      reasoning: string;
    }>(MODEL, prompt, RESPONSE_SCHEMA);

    if (!isValidConfidence(raw.confidence)) {
      return {
        eventType: raw.eventType ?? 'unknown',
        economicPurpose: raw.economicPurpose ?? 'unknown',
        counterparty: raw.counterparty ?? null,
        confidence: typeof raw.confidence === 'number' ? raw.confidence : 0,
        reasoning: raw.reasoning ?? '',
        routing: 'NEEDS_REVIEW',
      };
    }

    return {
      eventType: raw.eventType,
      economicPurpose: raw.economicPurpose,
      counterparty: raw.counterparty ?? null,
      confidence: raw.confidence,
      reasoning: raw.reasoning,
      routing: computeRouting(raw.confidence),
    };
  } catch {
    // Fail-closed: any error → NEEDS_REVIEW
    return {
      eventType: 'unknown',
      economicPurpose: 'unknown',
      counterparty: null,
      confidence: 0,
      reasoning: 'AI classification failed; routed to human review',
      routing: 'NEEDS_REVIEW',
    };
  }
}
