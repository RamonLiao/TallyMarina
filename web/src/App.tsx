import { EntityProvider, useEntityCtx } from './app/EntityContext';
import { Header } from './components/chrome/Header';
import { StepRail } from './components/chrome/StepRail';
import { GuardrailBanner } from './components/data/GuardrailBanner';

function Shell() {
  const { step } = useEntityCtx();
  return (
    <main
      aria-label="TallyMarina"
      style={{ maxWidth: 1200, margin: '0 auto', padding: '0 var(--space-6) var(--space-10)' }}
    >
      <Header />
      <StepRail current={step} />
      <GuardrailBanner />
      <section style={{ marginTop: 'var(--space-6)' }} data-step={step}>
        {/* Step bodies wired in Tasks 7–11 */}
        <p style={{ fontFamily: 'var(--font-body)' }}>Step: {step}</p>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <EntityProvider>
      <Shell />
    </EntityProvider>
  );
}
