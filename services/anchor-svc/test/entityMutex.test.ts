import { describe, it, expect } from 'vitest';
import { makeEntityMutex } from '../src/core/entityMutex.js';

describe('entityMutex', () => {
  it('serializes same-key runs (no overlap)', async () => {
    const m = makeEntityMutex();
    const order: string[] = [];
    const slow = (tag: string) => m.run('e1', async () => {
      order.push(`${tag}-start`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`${tag}-end`);
    });
    await Promise.all([slow('a'), slow('b')]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
  it('different keys run concurrently', async () => {
    const m = makeEntityMutex();
    const order: string[] = [];
    const t = (key: string, tag: string) => m.run(key, async () => { order.push(`${tag}-start`); await new Promise((r) => setTimeout(r, 20)); order.push(`${tag}-end`); });
    await Promise.all([t('e1', 'a'), t('e2', 'b')]);
    expect(order.slice(0, 2).sort()).toEqual(['a-start', 'b-start']); // both started before either ended
  });
  it('a throwing run releases the lock for the next', async () => {
    const m = makeEntityMutex();
    await expect(m.run('e1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(m.run('e1', async () => 42)).resolves.toBe(42);
  });
});
