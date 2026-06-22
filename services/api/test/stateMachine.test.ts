import { describe, it, expect } from 'vitest';
import { assertEventTransition, assertSnapshotTransition, StateError } from '../src/store/stateMachine.js';

describe('event state machine', () => {
  it('allows legal transitions', () => {
    expect(() => assertEventTransition('INGESTED', 'AUTO')).not.toThrow();
    expect(() => assertEventTransition('INGESTED', 'NEEDS_REVIEW')).not.toThrow();
    expect(() => assertEventTransition('NEEDS_REVIEW', 'APPROVED')).not.toThrow();
    expect(() => assertEventTransition('APPROVED', 'POSTED')).not.toThrow();
    expect(() => assertEventTransition('AUTO', 'POSTED')).not.toThrow();
  });
  it('fails closed on illegal transitions', () => {
    expect(() => assertEventTransition('POSTED', 'AUTO')).toThrowError(StateError);
    expect(() => assertEventTransition('INGESTED', 'POSTED')).toThrowError(/ILLEGAL_TRANSITION/);
    expect(() => assertEventTransition('NEEDS_REVIEW', 'POSTED')).toThrowError(StateError);
  });
});

describe('snapshot state machine', () => {
  it('allows DRAFT->FROZEN->ANCHORED', () => {
    expect(() => assertSnapshotTransition('DRAFT', 'FROZEN')).not.toThrow();
    expect(() => assertSnapshotTransition('FROZEN', 'ANCHORED')).not.toThrow();
  });
  it('fails closed: cannot re-anchor or skip', () => {
    expect(() => assertSnapshotTransition('ANCHORED', 'ANCHORED')).toThrowError(StateError);
    expect(() => assertSnapshotTransition('DRAFT', 'ANCHORED')).toThrowError(StateError);
    expect(() => assertSnapshotTransition('FROZEN', 'DRAFT')).toThrowError(StateError);
  });
});
