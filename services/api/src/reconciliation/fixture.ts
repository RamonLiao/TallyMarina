import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ReconFixtureRow } from './types.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'acme-pilot-001.recon.json');

function assertMinor(v: unknown, field: string, key: string): string {
  if (typeof v !== 'string') throw new Error(`recon fixture ${key}: ${field} must be a string, got ${typeof v}`);
  let n: bigint;
  try { n = BigInt(v); } catch { throw new Error(`recon fixture ${key}: ${field} is not a valid integer minor: ${v}`); }
  if (n < 0n) throw new Error(`recon fixture ${key}: ${field} must be >= 0 (asset-positive convention): ${v}`);
  return v;
}

/**
 * Validate and parse raw JSON rows for a recon fixture.
 * Exported so tests can exercise the same guards against adversarial inputs
 * without drift — one implementation, shared by production and tests.
 */
export function validateReconRows(raw: unknown, entityId: string): ReconFixtureRow[] {
  if (!Array.isArray(raw)) throw new Error(`no recon fixture for entity ${entityId}`);
  const seen = new Set<string>();
  return raw.map((r0) => {
    const r = r0 as Record<string, unknown>;
    const wallet = r.wallet, coinType = r.coinType, decimals = r.decimals;
    if (typeof wallet !== 'string' || typeof coinType !== 'string') throw new Error(`recon fixture: wallet/coinType must be strings`);
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) throw new Error(`recon fixture ${wallet}|${coinType}: decimals must be a non-negative integer`);
    const key = `${wallet}|${coinType}`;
    if (seen.has(key)) throw new Error(`recon fixture: duplicate row ${key}`);
    seen.add(key);
    return {
      wallet, coinType, decimals,
      openingMinor: assertMinor(r.openingMinor, 'openingMinor', key),
      statementMinor: assertMinor(r.statementMinor, 'statementMinor', key),
      thresholdMinor: assertMinor(r.thresholdMinor, 'thresholdMinor', key),
    };
  });
}

export function loadReconFixture(entityId: string): ReconFixtureRow[] {
  const all = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>;
  return validateReconRows(all[entityId], entityId);
}
