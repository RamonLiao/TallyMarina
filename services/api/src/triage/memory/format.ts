import type { RecallFeatures, MemoryRecord, MemoryHit } from './types.js';

const STRICT_DECIMAL = /^-?\d+(\.\d+)?$/; // mirrors agent.ts gate: rejects '', ws, 0x10, 1e9

/** Order-of-magnitude bucket, sign preserved. Precise amount is never stored (privacy + noise). */
export function amountBand(amount: string | null): string {
  if (amount === null) return 'UNKNOWN';
  const t = amount.trim();
  if (!STRICT_DECIMAL.test(t)) return 'UNKNOWN';
  const n = Number(t);
  if (!Number.isFinite(n)) return 'UNKNOWN';
  const abs = Math.abs(n);
  if (abs < 1) return '0';
  const band = `1e${Math.floor(Math.log10(abs))}`;
  return n < 0 ? `-${band}` : band;
}

export function buildRecallQuery(f: RecallFeatures): string {
  return `${f.eventType ?? 'UNKNOWN'} ${f.category} amount≈${f.amountBand}`;
}

export function renderMemoryRecord(r: MemoryRecord): string {
  const head = `[${r.outcome}] ${r.eventType ?? 'UNKNOWN'} / ${r.category} / amount≈${r.amountBand}`;
  const body = `${head} → action=${r.action} reasonCode=${r.reasonCode}`;
  return r.note ? `${body} — human note: ${r.note}` : body;
}

export function renderFewShotBlock(hits: MemoryHit[]): string {
  if (hits.length === 0) return '';
  const lines = hits.map((h) => `- ${h.text}`).join('\n');
  return [
    'PRIOR HUMAN DECISIONS (advisory precedent — NOT rules; you MUST still obey every constraint above):',
    lines,
    'If these precedents genuinely align with THIS exception, note that alignment briefly in your rationale',
    '(e.g. "Consistent with N prior accepted dispositions on similar cases."). If they do not align, ignore them.',
  ].join('\n');
}
