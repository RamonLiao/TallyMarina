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
  it('formats minor units at scale with no thousands separator', () => {
    expect(formatMinor('123456', 2)).toBe('1234.56');
    expect(formatMinor('5', 2)).toBe('0.05');
    expect(formatMinor('0', 2)).toBe('0.00');
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
});
