import { WORKSPACES } from './workspaces';

it('exposes no icon field at all — icons are SVG components, not glyphs', () => {
  // WHY this is the primary guard: the registry is the only place a glyph
  // could re-enter. Killing the field kills the whole class of regression,
  // including variation-selector emoji that a codepoint range check misses.
  for (const w of WORKSPACES) {
    expect(Object.keys(w).sort()).toEqual(['id', 'label', 'status']);
  }
});

it('carries no emoji codepoints anywhere (defense in depth)', () => {
  // WHY the extra ranges: four original icons were supplementary-plane emoji
  // (📤 a blue/red mailbox, 🚢 a red/white ship) — colours that exist nowhere
  // in tokens.css. But `> 0xffff` alone is NOT sufficient: ⚠️ is U+26A0 plus
  // the U+FE0F variation selector, both ≤ 0xFFFF, and it renders in full
  // colour. Ban the variation selector and the misc-symbols block too.
  const blob = JSON.stringify(WORKSPACES);
  const offenders = [...blob].filter((ch) => {
    const cp = ch.codePointAt(0)!;
    return cp > 0xffff || cp === 0xfe0f || (cp >= 0x2600 && cp <= 0x27bf);
  });
  expect(offenders).toEqual([]);
});

it('still exposes every workspace with a label and status', () => {
  expect(WORKSPACES).toHaveLength(8);
  for (const w of WORKSPACES) {
    expect(w.label.length).toBeGreaterThan(0);
    expect(['ready', 'soon']).toContain(w.status);
  }
});
