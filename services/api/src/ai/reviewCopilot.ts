/**
 * reviewCopilot.ts — READ-ONLY AI review assistant.
 * Returns advice only. Writes NOTHING.
 * Structurally unable to call any write-store functions.
 */

import { callGemini } from './geminiClient.js';

export interface ReviewEvent {
  id: string;
  description: string;
  amount?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface ReviewContext {
  existingEntries?: unknown[];
  entityName?: string;
  period?: string;
  [key: string]: unknown;
}

export interface CopilotResult {
  explanation: string;
  redFlags: string[];
  suggestedEntry: unknown | null;
  citations: string[];
}

const MODEL = process.env.AI_MODEL_COPILOT ?? 'gemini-flash-latest';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    explanation: { type: 'STRING' },
    redFlags: { type: 'ARRAY', items: { type: 'STRING' } },
    suggestedEntry: { type: 'OBJECT', nullable: true },
    citations: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['explanation', 'redFlags', 'citations'],
};

export async function reviewCopilot(
  event: ReviewEvent,
  context: ReviewContext = {},
): Promise<CopilotResult> {
  const prompt = `You are an accounting review assistant. Analyze this financial event and provide review advice. Respond with valid JSON only.

Event: ${JSON.stringify(event)}
Context: ${JSON.stringify(context)}

Provide:
- explanation: clear explanation of the event's accounting treatment
- redFlags: array of concerns or anomalies (empty array if none)
- suggestedEntry: suggested journal entry object or null
- citations: relevant accounting standards or references (empty array if none)

IMPORTANT: You are providing advice only. Do not suggest any system writes or state changes.`;

  try {
    const raw = await callGemini<{
      explanation: string;
      redFlags: string[];
      suggestedEntry?: unknown;
      citations: string[];
    }>(MODEL, prompt, RESPONSE_SCHEMA);

    return {
      explanation: raw.explanation ?? '',
      redFlags: Array.isArray(raw.redFlags) ? raw.redFlags : [],
      suggestedEntry: raw.suggestedEntry ?? null,
      citations: Array.isArray(raw.citations) ? raw.citations : [],
    };
  } catch {
    return {
      explanation: 'AI review unavailable; please review manually',
      redFlags: ['AI service error'],
      suggestedEntry: null,
      citations: [],
    };
  }
}
