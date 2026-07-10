import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('structural guard: getCoinMetadata is banned', () => {
  it('no file under services/api/src calls getCoinMetadata', () => {
    // WHY: @mysten/sui 2.19.0 grpc/core.mjs:158 does `decimals: response.metadata.decimals ?? 0`
    // behind a required-number type, and its bare catch at :152-153 turns a transport error into
    // {coinMetadata: null}. Both are invisible at the call site. Use stateService.getCoinInfo().
    const offenders = walk(join(__dirname, '..', 'src'))
      .filter((f) => /\bgetCoinMetadata\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders, `use client.stateService.getCoinInfo() instead — see spec D14`).toEqual([]);
  });
});
