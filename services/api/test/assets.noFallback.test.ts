import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mts|cts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

// Strips `//` and `/* */` comments while preserving string length and newline
// positions (comment content is blanked to spaces, newlines inside comments are
// kept as newlines). This lets us collapse real line breaks afterward without
// losing the ability to map a match offset back to an original source line.
function stripComments(s: string): string {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const two = s[i] + (s[i + 1] ?? '');
    if (two === '//') {
      while (i < n && s[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (two === '/*') {
      out += '  ';
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) {
        out += s[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}

// Newline replaced with a single space is length-preserving (both are 1 char),
// so offsets computed against the collapsed string stay valid against the
// original source for line-number reporting. This is what lets a fallback that
// a formatter (e.g. Prettier wrapping a long line) split across lines still be
// detected as a single expression instead of silently escaping through a
// per-line scan.
function collapseNewlines(s: string): string {
  return s.replace(/\n/g, ' ');
}

// Matches `decimals` as the DIRECT left operand of `??` / `||` (only whitespace between the
// word and the operator), with a fallback value that is NOT `null` / `undefined`.
//
// Three false-positive shapes were found and deliberately excluded:
//  - store.ts `appendAssetLog` does `row.decimals ?? null` to bind an absent optional log
//    field to SQL NULL. That's the absence of a value, not a fabricated one — must stay green.
//    Handled by the `(?!null\b|undefined\b)` negative lookahead.
//  - precision.ts does `!Number.isInteger(decimals) || decimals < 0 || decimals > 36`, a
//    boolean validation guard where `decimals` is nowhere near `||` (it's separated by `)` or
//    a comparison operator). Handled by requiring only intraline whitespace (`[ \t]*`, NOT `\s*`
//    — `\s` matches `\n` too, which would make the newline-collapse step below unobservable)
//    between the word `decimals` and the `??`/`||` token — a validation condition never has
//    that shape.
//  - a boolean guard of the shape `!decimals || typeof decimals !== 'number'` puts `decimals`
//    as the operand of `||`, but negated (`!decimals`) — that's "is this value falsy", not
//    "substitute a default". Handled by the `(?<!!)` negative lookbehind: a fabricated
//    default is never written as `!decimals ?? x` with the guard word glued directly onto a
//    preceding `!`.
//
// Only `!` is excluded from the lookbehind — NOT `(`. An earlier version used
// `(?<![!(])`, which also excluded a preceding `(`. That was a hole: a fabricated default is
// routinely written with a wrapping paren, and all three of these literal shapes escaped the
// old regex entirely (zero matches):
//   - `(decimals ?? 9)`               — parenthesized expression
//   - `foo(decimals ?? 9)`            — as a function-call argument
//   - `return (decimals ?? 9)`        — parenthesized return value
// None of those are boolean guards; they're the exact reflex this guard exists to catch, just
// with parens around it. Narrowing the lookbehind to `(?<!!)` catches all three while still
// passing `!decimals || typeof decimals !== 'number'` (the `!` there is glued directly to
// `decimals`, not to a paren).
//
// `?? 9` / `|| 6` directly on `decimals` supplies an actual numeric default for an
// authoritative decimals value, which is exactly the bug this guard exists to catch.
//
// Deliberately `[ \t]*`, not `\s*`: if this used `\s*`, it would match a literal `\n` on its
// own, making `collapseNewlines` below redundant and the whole cross-line fix untestable by
// mutation (removing the collapse step would silently do nothing, since \s already spans
// lines). Restricting to intraline whitespace makes collapseNewlines the ONLY thing that lets
// a Prettier-wrapped fallback match — which is the guarantee finding (1) requires.
const FALLBACK_RE = /(?<!!)\bdecimals\b[ \t]*(\?\?|\|\|)[ \t]*(?!null\b|undefined\b)\S/i;

function findFallbackOffenders(src: string): { index: number; matchText: string }[] {
  const collapsed = collapseNewlines(stripComments(src));
  const re = new RegExp(FALLBACK_RE.source, 'gi');
  const offenders: { index: number; matchText: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(collapsed))) {
    offenders.push({ index: m.index, matchText: m[0] });
    // zero-width safety: (?<...) lookbehind/lookahead groups never produce a zero-length
    // overall match here (\S is consumed), so re.lastIndex always advances. No infinite-loop
    // guard needed, but keep the invariant documented in case the pattern changes.
  }
  return offenders;
}

function lineInfoAt(src: string, offset: number): { line: number; text: string } {
  let line = 1;
  let lastNewline = -1;
  for (let idx = 0; idx < offset && idx < src.length; idx++) {
    if (src[idx] === '\n') {
      line++;
      lastNewline = idx;
    }
  }
  const nextNewline = src.indexOf('\n', offset);
  const text = src.slice(lastNewline + 1, nextNewline === -1 ? src.length : nextNewline);
  return { line, text: text.trim() };
}

describe('structural guard: no decimals fallback', () => {
  // WHY: `?? 9` was not a typo. It was someone thinking "a default seems reasonable here".
  // The next person will think it too. Make the codebase say no on their behalf.
  it('services/api/src/assets contains no ?? or || fallback on a decimals expression', () => {
    const offenders: string[] = [];
    for (const file of walk(join(__dirname, '..', 'src', 'assets'))) {
      const src = readFileSync(file, 'utf8');
      for (const { index } of findFallbackOffenders(src)) {
        const { line, text } = lineInfoAt(src, index);
        offenders.push(`${file}:${line}: ${text}`);
      }
    }
    expect(offenders, `decimals must never have a fallback (spec D6/V1):\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('the guard itself', () => {
  // These assertions test FALLBACK_RE (via findFallbackOffenders) directly against string
  // literals — no filesystem access. This is what protects the regex from silently regressing:
  // a change that "fixes" one file-scan case must not reopen any of these.
  const mustCatch: [name: string, snippet: string][] = [
    ['decimals ?? 9', 'decimals ?? 9'],
    ['decimals || 9', 'decimals || 9'],
    ['decimals ?? 0', 'decimals ?? 0'],
    ['decimals ?? DEFAULT_DECIMALS', 'decimals ?? DEFAULT_DECIMALS'],
    ['row.decimals ?? 9', 'row.decimals ?? 9'],
    ['decimals: fx?.decimals ?? 9', 'decimals: fx?.decimals ?? 9'],
    // Finding (1): a formatter wrapping a long line splits the fallback across two lines.
    // Nobody has to "try" to hide this — Prettier does it for free. Must still be caught.
    ['cross-line decimals ??\\n  9 (Prettier-wrapped)', 'const d = row.decimals ??\n  9;'],
    // Fix wave 2: parenthesized fallbacks previously escaped `(?<![!(])` entirely (a `(`
    // directly before `decimals` blocked the match). These are the same reflex, just wrapped
    // in parens — must be caught by `(?<!!)`.
    ['(decimals ?? 9)', '(decimals ?? 9)'],
    ['foo(decimals ?? 9)', 'foo(decimals ?? 9)'],
    ['return (decimals ?? 9)', 'return (decimals ?? 9)'],
  ];

  const mustPass: [name: string, snippet: string][] = [
    ['row.decimals ?? null', 'row.decimals ?? null'],
    ['decimals ?? undefined', 'decimals ?? undefined'],
    ['decimals < 0 || decimals > 36', 'decimals < 0 || decimals > 36'],
    // Finding (2): a legitimate boolean guard, verbatim from the brief's must-pass list.
    // `decimals` here is negated and tested for truthiness, not defaulted.
    ['!decimals || typeof decimals !== "number"', "!decimals || typeof decimals !== 'number'"],
  ];

  it.each(mustCatch)('catches: %s', (_name, snippet) => {
    const offenders = findFallbackOffenders(snippet);
    expect(offenders.length, `expected a fallback match in: ${snippet}`).toBeGreaterThan(0);
  });

  it.each(mustPass)('passes: %s', (_name, snippet) => {
    const offenders = findFallbackOffenders(snippet);
    expect(offenders.length, `expected no fallback match in: ${snippet}`).toBe(0);
  });

  // HONEST DISCLOSURE: this guard is not a data-flow analyzer. Renaming the variable before
  // returning it defeats the regex completely.
  it('discloses a known escape: renaming the variable before the fallback is undetectable', () => {
    const snippet = 'const d = row.decimals;\nreturn d ?? 9;';
    const offenders = findFallbackOffenders(snippet);
    expect(offenders.length).toBe(0);
    // This is expected, and the guard is still worth having despite it. The bug this guard
    // exists to prevent (`?? 9` on decimals) is a REFLEX — someone sees an absent value and
    // types a default without thinking. That reflex fires on the literal `decimals` token,
    // in the same expression, because that's how the thought happens in real time. Renaming
    // the variable to `d` first is a deliberate, extra step nobody takes by accident; if
    // someone goes to that trouble, they've already made a conscious choice this guard was
    // never trying to police. A lint rule that blocks reflexes doesn't need to also defeat
    // deliberate evasion to be worth keeping.
  });

  // Mutation check, direction 1: restoring the old, too-wide exclusion `(?<![!(])` must make
  // all three parenthesized mustCatch cases stop matching (go red), proving those assertions
  // actually depend on the `(` no longer being excluded — not on some other part of the regex.
  it('mutation check: reverting to (?<![!(]) un-catches the parenthesized fallbacks', () => {
    const oldRe = /(?<![!(])\bdecimals\b[ \t]*(\?\?|\|\|)[ \t]*(?!null\b|undefined\b)\S/i;
    const parenthesized = ['(decimals ?? 9)', 'foo(decimals ?? 9)', 'return (decimals ?? 9)'];
    for (const snippet of parenthesized) {
      const m = new RegExp(oldRe.source, 'gi').exec(snippet);
      expect(m, `expected (?<![!(]) to NOT match: ${snippet}`).toBeNull();
    }
  });

  // Mutation check, direction 2: dropping the lookbehind entirely must make the negated
  // boolean guard (`!decimals || ...`) start matching (go red), proving `(?<!!)` is load-bearing
  // — not merely decorative — and that `(?<!!)` is exactly as narrow as needed (removing it
  // reopens finding (2); the earlier check proves widening it to `(?<![!(])` reopens finding (1)-adjacent
  // parenthesized cases). Together these bound `(?<!!)` as the correct, minimal exclusion.
  it('mutation check: dropping the lookbehind entirely re-catches the negated boolean guard', () => {
    const noLookbehindRe = /\bdecimals\b[ \t]*(\?\?|\|\|)[ \t]*(?!null\b|undefined\b)\S/i;
    const snippet = "!decimals || typeof decimals !== 'number'";
    const m = new RegExp(noLookbehindRe.source, 'gi').exec(snippet);
    expect(m, `expected removing the lookbehind to matches: ${snippet}`).not.toBeNull();
  });

  // Verifies the report's length-preserving claim for stripComments/collapseNewlines. If either
  // function changes the string length, match offsets computed against the transformed string
  // no longer line up with the original source, and file:line reporting silently drifts.
  it('stripComments and collapseNewlines are length-preserving', () => {
    const sample =
      '// line comment\n' +
      'const a = 1; /* block\n   spans lines */ const b = row.decimals ??\n  9;\n' +
      '/* trailing */';
    const stripped = stripComments(sample);
    expect(stripped.length, 'stripComments must not change string length').toBe(sample.length);
    const collapsed = collapseNewlines(stripped);
    expect(collapsed.length, 'collapseNewlines must not change string length').toBe(stripped.length);
  });
});
