import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LightCard } from './LightCard';
import { sortLights, LIGHT_META } from './lightMeta';
import type { CockpitLight } from '../../api/types';

const L = (key: string, status: CockpitLight['status']): CockpitLight => ({
  key,
  status,
  label: key,
  real: status !== 'mock',
});

it('renders glyph + word (not color-only)', () => {
  render(<LightCard light={L('recon', 'red')} onDispatch={() => {}} />);
  // WHY: red must be legible without color — assert the textual word + glyph are present.
  expect(screen.getByText(LIGHT_META.red.word)).toBeInTheDocument();
  expect(screen.getByText(LIGHT_META.red.glyph)).toBeInTheDocument();
});

it('mock light shows the not-wired word and never the green word', () => {
  render(<LightCard light={L('pricing', 'mock')} onDispatch={() => {}} />);
  expect(screen.getByText(LIGHT_META.mock.word)).toBeInTheDocument();
  expect(screen.queryByText(LIGHT_META.green.word)).not.toBeInTheDocument();
});

it('sortLights orders red -> derived -> mock -> green', () => {
  const sorted = sortLights([
    L('a', 'green'),
    L('b', 'mock'),
    L('c', 'red'),
    L('d', 'derived'),
  ]);
  expect(sorted.map((l) => l.status)).toEqual(['red', 'derived', 'mock', 'green']);
});

it('completeness green (real:false) renders Derived glyph/word, not Ready', () => {
  // WHY: a presence-only completeness signal arrives from backend as {status:'green', real:false}.
  // Honesty rule: derived-green must NEVER display as verified green (✓ Ready).
  // effectiveStatus must map it to 'derived' so the ≈ Derived label is shown.
  const completenessLight: CockpitLight = {
    key: 'completeness',
    status: 'green',
    label: 'Completeness',
    real: false,
  };
  render(<LightCard light={completenessLight} onDispatch={() => {}} />);
  expect(screen.getByText(LIGHT_META.derived.word)).toBeInTheDocument();
  expect(screen.getByText(LIGHT_META.derived.glyph)).toBeInTheDocument();
  expect(screen.queryByText(LIGHT_META.green.word)).not.toBeInTheDocument();
});
