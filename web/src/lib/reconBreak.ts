// Client-side break recompute — recomputable evidence. BigInt only.
export interface BreakResult {
  breakMinor: bigint;
  direction: 'book-over' | 'statement-over' | 'balanced';
  material: boolean;
}

export function computeBreak(computedMinor: string, statementMinor: string, thresholdMinor: string): BreakResult {
  const brk = BigInt(computedMinor) - BigInt(statementMinor);
  const abs = brk < 0n ? -brk : brk;
  const direction = brk > 0n ? 'book-over' : brk < 0n ? 'statement-over' : 'balanced';
  const material = abs > 0n && abs >= BigInt(thresholdMinor);
  return { breakMinor: brk, direction, material };
}
