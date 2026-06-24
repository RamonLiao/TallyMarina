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
});
