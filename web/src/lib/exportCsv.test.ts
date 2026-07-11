import { describe, it, expect } from 'vitest';
import { csvField, csvRows, formatMinor, headerBlock } from './exportCsv';

describe('exportCsv', () => {
  it('quotes fields containing comma, quote, or newline (doubling inner quotes)', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('plain')).toBe('plain');
  });
  it('guards CSV-injection prefixes by prepending a single quote (WHY: =cmd in a cell executes in Excel)', () => {
    for (const p of ['=', '+', '-', '@']) {
      expect(csvField(`${p}cmd`)).toBe(`"'${p}cmd"`);
    }
  });
  it('guards injection chars preceded by leading whitespace/tab/CR (WHY: Excel normalises " =cmd" and executes it)', () => {
    // Space-prefixed injection — Excel/Sheets strip leading space and treat as formula
    expect(csvField(' =cmd')).toBe(`"' =cmd"`);
    // Tab-prefixed injection
    expect(csvField('\t=cmd')).toBe(`"'\t=cmd"`);
    // CR-prefixed injection
    expect(csvField('\r=cmd')).toBe(`"'\r=cmd"`);
    // Guard applied to original value, not stripped (the ' is before the original string)
    expect(csvField('  +SUM()')).toBe(`"'  +SUM()"`);
  });
  it('guards "-2+cmd" and "-100": dash is an injection trigger, not stripped (WHY: Excel evaluates "-number" as formula)', () => {
    // '-' is in INJECTION set; strip only whitespace/control, NOT '-'
    expect(csvField('-2+cmd')).toBe(`"'-2+cmd"`);
    expect(csvField('-100')).toBe(`"'-100"`);
  });
  it('formats minor units at scale with no thousands separator', () => {
    expect(formatMinor('123456', 2)).toBe('1234.56');
    expect(formatMinor('5', 2)).toBe('0.05');
    expect(formatMinor('0', 2)).toBe('0.00');
  });
  it('formatMinor at scale=0 returns integer string unchanged (WHY: scale=0 means no fractional part)', () => {
    expect(formatMinor('123', 0)).toBe('123');
  });
  it('formatMinor throws on a non-integer / negative / non-finite scale instead of silently mis-scaling', () => {
    // WHY: this is the `?? 9`/`?? null` family of bug in its fourth form. A null/undefined
    // scale reaching formatMinor is NOT a formatting edge — it is an unregistered asset whose
    // decimals we do not know. The pre-guard function returned:
    //   formatMinor('5000000000', null)      -> '5000000000'  (silent wrong scale)
    //   formatMinor('5000000000', undefined) -> '0'           (a number that does not exist)
    // Either one, imported into an ERP, is a silent scale error — exactly what this spec kills.
    // Refusing is the only honest answer.
    expect(() => formatMinor('5000000000', null as never)).toThrow(/scale/);
    expect(() => formatMinor('5000000000', undefined as never)).toThrow(/scale/);
    expect(() => formatMinor('5000000000', 1.5)).toThrow(/scale/);
    expect(() => formatMinor('5000000000', -1)).toThrow(/scale/);
    expect(() => formatMinor('5000000000', Number.POSITIVE_INFINITY)).toThrow(/scale/);
    expect(() => formatMinor('5000000000', Number.NaN)).toThrow(/scale/);
  });
  it('joins header + rows with \\n', () => {
    expect(csvRows(['a', 'b'], [['1', '2']])).toBe('a,b\n1,2');
  });
  it('emits # comment header lines', () => {
    expect(headerBlock({ entityId: 'acme', periodId: '2026-06' }))
      .toBe('# entityId: acme\n# periodId: 2026-06');
  });
  it('headerBlock strips newlines from meta values to prevent CSV row injection (WHY: a meta value containing \\n could inject a new CSV data row)', () => {
    // '\n=cmd()' — newline replaced with space, becomes ' =cmd()'; leading-space stripped → '=cmd()' starts with '=', guard applied
    const result1 = headerBlock({ formula: '\n=cmd()' });
    // After newline→space: ' =cmd()'; stripped: '=cmd()' → injection guard → "' =cmd()"
    expect(result1).toBe("# formula: ' =cmd()");

    // 'x\n=cmd()' — after newline→space: 'x =cmd()'; stripped starts with 'x' (not injection char) → no guard, just sanitised
    const result2 = headerBlock({ note: 'x\n=cmd()' });
    expect(result2).toBe('# note: x =cmd()');

    // CR+LF stripped to single space
    const result3 = headerBlock({ entity: 'ok\r\nbad' });
    expect(result3).toBe('# entity: ok bad');
  });
  it('headerBlock sanitises key containing \\n to prevent new-row injection via key (WHY: defense-in-depth for keys from dynamic sources)', () => {
    // key '\n=cmd()' → newline stripped to space → '# ' + ' =cmd()' + ': val'
    // The key is not injection-guarded (no formula prefix added to key), just CR/LF removed
    const result = headerBlock({ '\n=cmd()': 'val' });
    expect(result).toBe('# ' + ' =cmd(): val');
  });
});

describe('csvField monkey / extreme inputs', () => {
  /**
   * Table-driven fuzz regression for csvField.
   * Each entry: [label, input, expected, why]
   * All assertions are non-trivial — they encode WHY each result is correct.
   */
  const cases: [string, string, string, string][] = [
    // ── Empty / clean values (must NOT be over-guarded) ──────────────────────
    [
      'empty string → empty string',
      '',
      '',
      'WHY: empty is a valid CSV cell; adding quotes/prefix breaks downstream parsers',
    ],
    [
      'plain text → unchanged',
      'plain',
      'plain',
      'WHY: clean strings must pass through verbatim to avoid corrupt exports',
    ],
    [
      'SUI address-like token → unchanged',
      '0x2::sui::SUI',
      '0x2::sui::SUI',
      'WHY: colon/hex chars are common in blockchain data; must not be misidentified as injection',
    ],
    [
      'hyphenated ID starting with alpha → unchanged',
      'acct-100',
      'acct-100',
      'WHY: the hyphen is only dangerous as the FIRST char; interior hyphens are safe',
    ],

    // ── Control-char extremes ─────────────────────────────────────────────────
    [
      'null + control chars only → stable output (no crash)',
      '\x00\x01\x1f',
      '\x00\x01\x1f',
      'WHY: no injection prefix after stripping; must not throw and must round-trip stably',
    ],

    // ── CR / LF variants ─────────────────────────────────────────────────────
    [
      'a\\r\\nb → quoted (contains CR+LF)',
      'a\r\nb',
      '"a\r\nb"',
      'WHY: newline inside a field MUST be quoted to prevent the CSV parser from splitting rows',
    ],
    [
      '\\n\\n=cmd → injection guard because \\n stripped reveals = as first real char',
      '\n\n=cmd',
      '"\'\n\n=cmd"',
      'WHY: Excel/Sheets strip leading newlines; the remaining =cmd would execute as formula without the guard',
    ],

    // ── Leading whitespace + injection prefix combos (bypass regression) ─────
    [
      'space + = → guarded',
      ' =cmd',
      "\"' =cmd\"",
      'WHY: a leading space before = is the classic Excel injection bypass; must be blocked',
    ],
    [
      'tab + = → guarded',
      '\t=cmd',
      '"\'\t=cmd"',
      'WHY: tab is also stripped by spreadsheet apps before formula evaluation',
    ],
    [
      'CR + = → guarded',
      '\r=cmd',
      '"\'\r=cmd"',
      'WHY: carriage-return is a control char stripped during normalisation',
    ],
    [
      'null byte + = → guarded',
      '\x00=cmd',
      '"\'\x00=cmd"',
      'WHY: \\x00 is in the stripped control-char range; = after it must still trigger guard',
    ],
    [
      'space + + → guarded',
      ' +SUM()',
      '"\' +SUM()"',
      'WHY: + is an injection trigger; leading space bypass must be blocked',
    ],
    [
      'tab + - → guarded',
      '\t-1',
      '"\'\t-1"',
      'WHY: - is an injection trigger; tab-prefixed must be blocked',
    ],
    [
      'space + @ → guarded',
      ' @user',
      "\"' @user\"",
      'WHY: @ triggers DDE in older Excel; space-prefix bypass must be blocked',
    ],
    [
      '\\x00 + - → guarded',
      '\x00-1',
      '"\'\x00-1"',
      'WHY: null-byte prefix before - must not bypass the injection guard',
    ],

    // ── Quote + injection prefix ──────────────────────────────────────────────
    [
      '="quote" → guard + double-escaped inner quote',
      '="quote"',
      '"\'=""quote"""',
      'WHY: injection prefix inside a quoted field must still be guarded AND inner quotes double-escaped',
    ],
    [
      '@a"b → guard + double-escaped quote',
      '@a"b',
      '"\'@a""b"',
      'WHY: @ is injection trigger; the embedded quote must also be double-escaped per RFC 4180',
    ],

    // ── Negative numbers (- is always an injection trigger) ──────────────────
    [
      '-100 → guarded (- is injection trigger)',
      '-100',
      '"\'-100"',
      'WHY: Excel can interpret -number cells as a formula prefix; must guard even pure negatives',
    ],
    [
      '-2+cmd → guarded',
      '-2+cmd',
      '"\'-2+cmd"',
      'WHY: starts with -, which is in INJECTION set; no exception for numeric-looking strings',
    ],

    // ── Extremely long strings ────────────────────────────────────────────────
    [
      '= + 10 000 "a" chars → guarded, no crash',
      '=' + 'a'.repeat(10000),
      '"\'=' + 'a'.repeat(10000) + '"',
      'WHY: large payloads must not cause stack overflow or silent truncation; guard must still apply',
    ],
  ];

  it.each(cases)('%s', (_label, input, expected, _why) => {
    expect(csvField(input)).toBe(expected);
  });
});
