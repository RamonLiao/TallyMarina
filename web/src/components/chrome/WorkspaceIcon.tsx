import type { ReactElement } from 'react';

// NOTE: do NOT `import type { JSX } from 'react'` — that named export only
// exists in the React 19 types. This repo is on React 18, where JSX is a
// global namespace. ReactElement is the portable choice.

// Monochrome, 24×24, stroke-only. `currentColor` lets the active nav item's
// --brass `color` tint the icon; a fixed stroke would not.
const PATHS: Record<string, ReactElement> = {
  close: (
    <>
      <circle cx="12" cy="5" r="2" />
      <line x1="12" y1="7" x2="12" y2="21" />
      <path d="M5 13a7 7 0 0 0 14 0" />
      <line x1="8" y1="11" x2="16" y2="11" />
    </>
  ),
  exceptions: (
    <>
      <path d="M12 3 L22 20 H2 Z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </>
  ),
  reconciliation: (
    <>
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="6" y1="20" x2="18" y2="20" />
      <line x1="4" y1="8" x2="20" y2="8" />
      <path d="M4 8 L1.5 14 h5 Z" />
      <path d="M20 8 L17.5 14 h5 Z" />
    </>
  ),
  audit: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </>
  ),
  policy: (
    <>
      <path d="M4 4 V20 H20 Z" />
      <line x1="7" y1="16" x2="12" y2="16" />
    </>
  ),
  export: (
    <>
      <path d="M4 15 v4 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-4" />
      <line x1="12" y1="4" x2="12" y2="15" />
      <path d="M8 8 l4 -4 l4 4" />
    </>
  ),
  onboarding: (
    <>
      <path d="M3 17 h18 l-2 4 H5 Z" />
      <line x1="12" y1="3" x2="12" y2="17" />
      <path d="M12 5 l6 4 l-6 2 Z" />
    </>
  ),
};

export function WorkspaceIcon({ id }: { id: string }): ReactElement | null {
  const path = PATHS[id];
  if (!path) return null; // unknown id (e.g. test-injected 'soon-test')
  return (
    <svg
      className="ws-nav-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}
