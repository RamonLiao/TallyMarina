import { createHash } from 'node:crypto';

// Fields the RPC may add that are not part of the tx's logical content.
const VOLATILE_KEYS = new Set(['_rpcLatencyMs', 'requestId', 'timestampReceived']);

export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = canonicalize((v as Record<string, unknown>)[key]);
    }
    return out;
  }
  return v;
}

export function contentHash(rawJson: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(rawJson))).digest('hex');
}
