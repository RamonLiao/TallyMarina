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
        fontSize: 13,
        color: 'var(--ink-soft)',
        borderBottom: '1px solid var(--brass)',
        paddingBottom: 2,
      }}
    >
      <span aria-hidden>🔒</span>
      <span>AI suggestions only — no posting authority</span>
    </div>
  );
}
