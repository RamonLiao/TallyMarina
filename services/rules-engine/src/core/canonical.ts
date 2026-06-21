import { createHash } from 'node:crypto';

export function canonicalize(v: unknown): unknown {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(canonicalize);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = canonicalize((v as Record<string, unknown>)[key]);
    }
    return out;
  }
  return v;
}

export function canonicalJson(v: unknown): string {
  return JSON.stringify(canonicalize(v));
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
