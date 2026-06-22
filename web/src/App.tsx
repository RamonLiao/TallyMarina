import { EntityProvider, useEntityCtx } from './app/EntityContext';
import { Header } from './components/chrome/Header';
import { StepRail } from './components/chrome/StepRail';
import { GuardrailBanner } from './components/data/GuardrailBanner';
import { IngestStep } from './steps/IngestStep';
import { ClassifyStep } from './steps/ClassifyStep';
import { ReviewStep } from './steps/ReviewStep';
import { JournalStep } from './steps/JournalStep';
import { AnchorStep } from './steps/AnchorStep';

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
        {step === 'ingest' && <IngestStep />}
        {step === 'classify' && <ClassifyStep />}
        {step === 'review' && <ReviewStep />}
        {step === 'journal' && <JournalStep />}
        {step === 'anchor' && <AnchorStep />}
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
