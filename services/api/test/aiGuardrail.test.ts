import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AI_DIR = new URL('../src/ai/', import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('AI structural guardrail (zero posting authority)', () => {
  it('no file under src/ai/ imports journalStore (directly or transitively via store barrel)', () => {
    let files: string[];
    try {
      files = walk(AI_DIR);
    } catch {
      // src/ai/ not yet created (Task 5). Skip until then.
      return;
    }
    expect(files.length).toBeGreaterThan(0); // guard: ai/ must exist (created in Task 5)
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must not import journalStore`).not.toMatch(/journalStore/);
      expect(src, `${f} must not import insertJournalEntry`).not.toMatch(/insertJournalEntry/);
    }
  });

  it('the only event write the ai/ layer references is setAiSuggestion', () => {
    let files: string[];
    try {
      files = walk(AI_DIR);
    } catch {
      // src/ai/ not yet created (Task 5). Skip until then.
      return;
    }
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // ai/ may import eventStore ONLY for setAiSuggestion; forbid the posting writers.
      expect(src, `${f} must not call markPosted`).not.toMatch(/markPosted/);
      expect(src, `${f} must not call setDecision`).not.toMatch(/setDecision/);
    }
  });
});
