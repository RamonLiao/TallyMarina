import { WORKSPACES } from './workspaces';

it('carries no emoji codepoints — icons are SVG, not glyphs', () => {
  // WHY this test exists: four of the original seven icons were
  // supplementary-plane colour emoji (📤 renders as a blue/red mailbox,
  // 🚢 as a red/white ship). Those colours exist nowhere in tokens.css.
  // Stacked vertically in the drawer the mismatch is glaring. This pins the
  // rule so a future edit cannot quietly reintroduce a colour emoji.
  const blob = JSON.stringify(WORKSPACES);
  const offenders = [...blob].filter((ch) => ch.codePointAt(0)! > 0xffff);
  expect(offenders).toEqual([]);
});

it('still exposes every workspace with a label and status', () => {
  expect(WORKSPACES).toHaveLength(7);
  for (const w of WORKSPACES) {
    expect(w.label.length).toBeGreaterThan(0);
    expect(['ready', 'soon']).toContain(w.status);
  }
});
