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

// Matches `decimals` as the DIRECT left operand of `??` / `||` (only whitespace between the
// word and the operator), with a fallback value that is NOT `null` / `undefined`.
//
// Two false-positive shapes were found and deliberately excluded:
//  - store.ts `appendAssetLog` does `row.decimals ?? null` to bind an absent optional log
//    field to SQL NULL. That's the absence of a value, not a fabricated one — must stay green.
//    Handled by the `(?!null\b|undefined\b)` negative lookahead.
//  - precision.ts does `!Number.isInteger(decimals) || decimals < 0 || decimals > 36`, a
//    boolean validation guard where `decimals` is nowhere near `||` (it's separated by `)` or
//    a comparison operator). Handled by requiring only whitespace (`\s*`) between the word
//    `decimals` and the `??`/`||` token — a validation condition never has that shape.
//
// `?? 9` / `|| 6` directly on `decimals` supplies an actual numeric default for an
// authoritative decimals value, which is exactly the bug this guard exists to catch.
const FALLBACK_RE = /\bdecimals\b\s*(\?\?|\|\|)\s*(?!null\b|undefined\b)\S/i;

describe('structural guard: no decimals fallback', () => {
  // WHY: `?? 9` was not a typo. It was someone thinking "a default seems reasonable here".
  // The next person will think it too. Make the codebase say no on their behalf.
  it('services/api/src/assets contains no ?? or || fallback on a decimals expression', () => {
    const offenders: string[] = [];
    for (const file of walk(join(__dirname, '..', 'src', 'assets'))) {
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (FALLBACK_RE.test(line) && !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//')) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `decimals must never have a fallback (spec D6/V1):\n${offenders.join('\n')}`).toEqual([]);
  });
});
