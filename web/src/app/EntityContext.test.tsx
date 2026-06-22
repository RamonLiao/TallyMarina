import { render, act, screen } from '@testing-library/react';
import { EntityProvider, useEntityCtx } from './EntityContext';

// Helper component to expose context values via DOM for assertions
function Inspector({ onValue }: { onValue: (ctx: ReturnType<typeof useEntityCtx>) => void }) {
  const ctx = useEntityCtx();
  onValue(ctx);
  return <div data-testid="step">{ctx.step}</div>;
}

function setup() {
  let ctx!: ReturnType<typeof useEntityCtx>;
  render(
    <EntityProvider>
      <Inspector onValue={(c) => { ctx = c; }} />
    </EntityProvider>
  );
  return () => ctx;
}

// ── Step machine: initial state ───────────────────────────────────────────

it('starts at ingest', () => {
  const get = setup();
  expect(get().step).toBe('ingest');
  expect(get().periodId).toBe('2026-Q2');
});

// ── goNext advances through all steps ────────────────────────────────────

it('goNext advances Ingest → Classify → Review → Journal → Anchor', () => {
  const get = setup();
  const seq: string[] = [get().step];

  for (let i = 0; i < 4; i++) {
    act(() => { get().goNext(); });
    seq.push(get().step);
  }

  expect(seq).toEqual(['ingest', 'classify', 'review', 'journal', 'anchor']);
});

// ── goNext stops at Anchor (never advances past last step) ────────────────

it('goNext does NOT advance past Anchor', () => {
  const get = setup();

  // Jump to anchor first
  act(() => { get().setStep('anchor'); });
  expect(get().step).toBe('anchor');

  // Multiple goNext calls must remain at anchor
  act(() => { get().goNext(); });
  act(() => { get().goNext(); });
  expect(get().step).toBe('anchor');
});

// ── setStep jumps to any step ──────────────────────────────────────────────

it('setStep jumps directly to any step', () => {
  const get = setup();

  act(() => { get().setStep('journal'); });
  expect(get().step).toBe('journal');

  act(() => { get().setStep('ingest'); });
  expect(get().step).toBe('ingest');
});

// ── goNext never goes before first step ───────────────────────────────────

it('step never goes below ingest via setStep + goNext round-trip', () => {
  const get = setup();
  // setStep to ingest then goNext should go to classify, not wrap around
  act(() => { get().setStep('ingest'); });
  act(() => { get().goNext(); });
  expect(get().step).toBe('classify');
});
