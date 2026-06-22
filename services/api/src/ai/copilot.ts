import type { GeminiClient, GeminiSchema } from './geminiClient.js';

export interface CopilotAdvice {
  explanation: string;
  redFlags: string[];
  suggestedEntry: { lines: Array<{ account: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string }> } | null;
  citations: string[];
}

const RESPONSE_SCHEMA: GeminiSchema = {
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
  input: { rawJson: string },
  context: Record<string, unknown>,
  deps: { client: GeminiClient; model: string },
): Promise<CopilotAdvice> {
  try {
    const parsed = JSON.parse(input.rawJson) as Record<string, unknown>;
    const prompt = `You are an accounting review assistant. Analyze this financial event and provide review advice. Respond with valid JSON only.\n\nEvent: ${JSON.stringify(parsed)}\nContext: ${JSON.stringify(context)}\n\nProvide:\n- explanation: accounting treatment explanation\n- redFlags: array of concerns (empty if none)\n- suggestedEntry: suggested journal entry object or null\n- citations: relevant accounting standards (empty if none)\n\nIMPORTANT: Advice only. Do not suggest any system writes or state changes.`;
    const raw = await deps.client.generateJson<{
      explanation: string; redFlags: string[]; suggestedEntry?: unknown; citations: string[];
    }>(deps.model, prompt, RESPONSE_SCHEMA);
    return {
      explanation: raw.explanation ?? '',
      redFlags: Array.isArray(raw.redFlags) ? raw.redFlags : [],
      suggestedEntry: (raw.suggestedEntry as CopilotAdvice['suggestedEntry']) ?? null,
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
