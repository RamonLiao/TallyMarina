// CHROME ZONE (spec §8.4 + §8.7). Background is decoration only. NEVER behind the
// journal table or hash-chain (those panels paint their own opaque bg over this layer).
// Missing generated asset → procedural SVG nautical-chart pattern → flat --paper fallback.
//
// Procedural nautical-chart: compass rose grid lines, faint depth contours — all tinted
// toward --paper/--paper-line so it reads ≤8% busy and never competes with data text.

// Attempt to import a generated background if it has been produced by gen-assets.ts.
// Vite resolves this at build time; if absent the module will 404 silently and bgUrl
// stays undefined (the procedural SVG takes over). The journal/.austere panels paint
// opaque --paper-card/--ink over this fixed layer regardless (§8.4).
let bgUrl: string | undefined;
try {
  bgUrl = new URL('../../assets/generated/app-background.png', import.meta.url).href;
} catch {
  bgUrl = undefined;
}

// Procedural SVG: 240×240 tile — compass grid + faint depth rings.
// Colors use rgba approximations of --paper-line (#E3D7BC) at low opacity so
// they degrade gracefully in any browser without CSS var() in SVG attributes.
const NAUTICAL_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>
  <defs>
    <pattern id='grid' width='60' height='60' patternUnits='userSpaceOnUse'>
      <path d='M60 0L0 0 0 60' fill='none' stroke='rgba(163,145,107,0.07)' stroke-width='0.5'/>
    </pattern>
    <pattern id='cross' width='120' height='120' patternUnits='userSpaceOnUse'>
      <line x1='60' y1='0' x2='60' y2='120' stroke='rgba(163,145,107,0.05)' stroke-width='0.5'/>
      <line x1='0' y1='60' x2='120' y2='60' stroke='rgba(163,145,107,0.05)' stroke-width='0.5'/>
    </pattern>
  </defs>
  <rect width='240' height='240' fill='url(%23grid)'/>
  <rect width='240' height='240' fill='url(%23cross)'/>
  <!-- depth contour rings at tile center -->
  <circle cx='120' cy='120' r='48' fill='none' stroke='rgba(163,145,107,0.045)' stroke-width='0.5'/>
  <circle cx='120' cy='120' r='80' fill='none' stroke='rgba(163,145,107,0.03)' stroke-width='0.5'/>
  <!-- compass tick marks -->
  <line x1='120' y1='36' x2='120' y2='46' stroke='rgba(163,145,107,0.08)' stroke-width='0.75'/>
  <line x1='120' y1='194' x2='120' y2='204' stroke='rgba(163,145,107,0.08)' stroke-width='0.75'/>
  <line x1='36' y1='120' x2='46' y2='120' stroke='rgba(163,145,107,0.08)' stroke-width='0.75'/>
  <line x1='194' y1='120' x2='204' y2='120' stroke='rgba(163,145,107,0.08)' stroke-width='0.75'/>
</svg>`;

const NAUTICAL_DATA_URI = `url("data:image/svg+xml,${NAUTICAL_SVG.replace(/\n\s*/g, ' ')}")`;

export function AppBackground() {
  return (
    <div
      aria-hidden
      data-testid="app-background"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        // Flat --paper is always the base color (fallback per §8.7)
        backgroundColor: 'var(--paper)',
        // Layer order: generated PNG (if available) → procedural SVG pattern
        backgroundImage: bgUrl
          ? `url(${bgUrl}), ${NAUTICAL_DATA_URI}`
          : NAUTICAL_DATA_URI,
        backgroundSize: bgUrl ? 'cover, 240px 240px' : '240px 240px',
        backgroundPosition: 'center, top left',
        backgroundAttachment: 'fixed, fixed',
        // Keep subtle: generated PNG at ~40% blend, SVG pattern at natural opacity
        opacity: 0.85,
        // Pointer-events off — purely visual
        pointerEvents: 'none',
      }}
    />
  );
}
