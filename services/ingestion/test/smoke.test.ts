import { describe, it, expect } from 'vitest';
import { ingestionVersion } from '../src/index.js';

describe('scaffold', () => {
  it('exposes a version marker', () => {
    expect(ingestionVersion).toBe('0.1.0');
  });
});
