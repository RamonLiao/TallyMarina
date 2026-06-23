import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// AI/disposition zero posting authority: the disposition module must never reach journalStore.
describe('disposition guardrail', () => {
  it('disposition.ts imports nothing from journalStore', () => {
    const p = fileURLToPath(new URL('../src/exceptions/disposition.ts', import.meta.url));
    const src = readFileSync(p, 'utf8');
    expect(src).not.toMatch(/journalStore/);
    expect(src).not.toMatch(/insertJournalEntry/);
  });
});
