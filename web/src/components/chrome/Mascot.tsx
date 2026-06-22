// CHROME ZONE (spec §8.4). The otter IS the AI signifier — never a stock sparkle/robot.
// This component must NEVER be imported by anything under components/data/.
import logoWave from '../../assets/generated/mascot-wave.png'; // logo_2 waving paw (raising-hand)
import logoCalm from '../../assets/generated/mascot-calm.png'; // logo_3 sailor cap (default)

export type MascotPose = 'sailing' | 'thinking' | 'confident' | 'raising-hand' | 'celebrate';

const POSE_LABEL: Record<MascotPose, string> = {
  sailing: 'Otter sailing to current step',
  thinking: 'Otter thinking — AI is working',
  confident: 'Otter confident — high-confidence auto-pass',
  'raising-hand': 'Otter raising hand — needs human review',
  celebrate: 'Otter celebrating — anchored on-chain',
};

export function Mascot({ pose, size = 48 }: { pose: MascotPose; size?: number }) {
  const src = pose === 'raising-hand' || pose === 'celebrate' ? logoWave : logoCalm;
  return (
    <span
      data-pose={pose}
      role="img"
      aria-label={POSE_LABEL[pose]}
      style={{ display: 'inline-flex', width: size, height: size, position: 'relative' }}
    >
      <img src={src} alt="" width={size} height={size} style={{ objectFit: 'contain' }} />
      {pose === 'thinking' && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: '50%',
            border: '2px solid var(--aqua)',
            animation: 'otter-pulse 1.2s ease-in-out infinite',
          }}
        />
      )}
      <style>{`@keyframes otter-pulse { 0%,100% { opacity:.25; transform:scale(1);} 50% { opacity:.8; transform:scale(1.06);} }`}</style>
    </span>
  );
}
