// DATA ZONE (spec §8.4 + §8.5). The agent's visible leash. NO mascot here.
export function GuardrailBanner() {
  return (
    <div
      role="note"
      aria-label="AI suggestions only — no posting authority"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        fontSize: 'var(--text-sm)',
        color: 'var(--ink-soft)',
        borderBottom: '1px solid var(--brass)',
        paddingBottom: 2,
      }}
    >
      {/* Inline SVG padlock (currentColor) — replaces the 🔒 emoji so the leash
          icon renders identically across platforms. aria-hidden + no role="img"
          keeps this out of the a11y tree (data zone). */}
      <svg
        aria-hidden
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <span>AI suggestions only — no posting authority</span>
    </div>
  );
}
