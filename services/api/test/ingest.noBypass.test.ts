import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mts|cts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

// insertEvent( as a whole identifier followed by an open paren — matches both the
// `export function insertEvent(` definition and any call site `insertEvent(...)`.
const INSERT_EVENT_RE = /\binsertEvent\(/;

function callersOf(): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC_ROOT)) {
    const src = readFileSync(file, 'utf8');
    if (INSERT_EVENT_RE.test(src)) {
      hits.push(relative(SRC_ROOT, file).split('\\').join('/'));
    }
  }
  return hits.sort();
}

describe('structural guard: insertEvent() has no unknown callers', () => {
  // WHY: defect A is closed by ingestEvent(). insertEvent() is the raw writer underneath it.
  // A future caller reaching for the writer instead of the gate would silently reopen the path
  // that anchors a wrong decimal scale onto the chain, and every gate test would stay green.
  // store/seed.ts USED to bypass the gate on the production server-start path; Task 12 routed
  // it through ingestEvent(), so the raw writer now has exactly two legitimate references. This
  // assertion is what forces the list to be updated if a future caller reaches for the writer.
  it('insertEvent has exactly the known callers — a new one bypasses the registry gate', () => {
    const KNOWN_CALLERS = [
      'store/eventStore.ts', // definition
      'http/ingestEvent.ts', // the gate itself — legitimate
    ].sort();

    const actual = callersOf();
    expect(
      actual,
      `insertEvent( is referenced from an unexpected file. If this is a new legitimate ` +
        `caller, it must go through ingestEvent() (the registry gate), not insertEvent() ` +
        `directly. Known callers: ${KNOWN_CALLERS.join(', ')}. Actual: ${actual.join(', ')}`,
    ).toEqual(KNOWN_CALLERS);
  });
});
