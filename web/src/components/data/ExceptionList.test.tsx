import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExceptionList } from './ExceptionList';
import type { ExceptionDTO } from '../../api/types';

const ex = (over: Partial<ExceptionDTO>): ExceptionDTO => ({
  exceptionId: 'X:1', category: 'LOW_CONFIDENCE_AUTO', eventId: '1', severity: 1,
  reason: 'r', amount: null, ai: { eventType: 'T', purpose: 'p', confidence: 0.8, reasoning: '' },
  disposition: null, anchoredReadOnly: false, ...over,
});

describe('ExceptionList', () => {
  it('groups blockers first under a BLOCKS CLOSE label and labels category by text (not color-only)', () => {
    const items = [
      ex({ exceptionId: 'LOW_CONFIDENCE_AUTO:1', eventId: '1', category: 'LOW_CONFIDENCE_AUTO', severity: 1 }),
      ex({ exceptionId: 'RULES_FAILED:2', eventId: '2', category: 'RULES_FAILED', severity: 3 }),
    ];
    render(<ExceptionList exceptions={items} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/BLOCKS CLOSE/i)).toBeInTheDocument();
    // category conveyed by text label, a11y (not color alone)
    expect(screen.getByText(/RULES_FAILED|Rule/i)).toBeInTheDocument();
  });

  it('does NOT render "Blocks close" when all items have severity < 2, but renders "Hold"', () => {
    const items = [
      ex({ exceptionId: 'LOW_CONFIDENCE_AUTO:1', eventId: '1', category: 'LOW_CONFIDENCE_AUTO', severity: 1 }),
      ex({ exceptionId: 'LOW_CONFIDENCE_AUTO:2', eventId: '2', category: 'LOW_CONFIDENCE_AUTO', severity: 0 }),
    ];
    render(<ExceptionList exceptions={items} selectedId={null} onSelect={() => {}} />);
    expect(screen.queryByText(/blocks close/i)).toBeNull();
    expect(screen.getByText(/hold/i)).toBeInTheDocument();
  });

  it('calls onSelect with exceptionId on row click', () => {
    const onSelect = vi.fn();
    render(<ExceptionList exceptions={[ex({ exceptionId: 'RULES_FAILED:2', eventId: '2', category: 'RULES_FAILED', severity: 3 })]} selectedId={null} onSelect={onSelect} />);
    screen.getByText(/RULES_FAILED|Rule/i).click();
    expect(onSelect).toHaveBeenCalledWith('RULES_FAILED:2');
  });
});
