import { EntityProvider, useEntityCtx } from './app/EntityContext';
import { WorkspaceProvider, useWorkspace } from './app/WorkspaceContext';
import { WORKSPACES } from './app/workspaces';
import { AppBackground } from './components/chrome/AppBackground';
import { TopBar } from './components/chrome/TopBar';
import { SideNav } from './components/chrome/SideNav';
import { StepRail } from './components/chrome/StepRail';
import { EmptyState } from './components/chrome/EmptyState';
import { GuardrailBanner } from './components/data/GuardrailBanner';
import { IngestStep } from './steps/IngestStep';
import { ClassifyStep } from './steps/ClassifyStep';
import { ReviewStep } from './steps/ReviewStep';
import { JournalStep } from './steps/JournalStep';
import { AnchorStep } from './steps/AnchorStep';

function CloseWorkspace() {
  const { step } = useEntityCtx();
  return (
    <>
      <StepRail current={step} />
      <section style={{ marginTop: 'var(--space-6)' }} data-step={step}>
        {step === 'ingest' && <IngestStep />}
        {step === 'classify' && <ClassifyStep />}
        {step === 'review' && <ReviewStep />}
        {step === 'journal' && <JournalStep />}
        {step === 'anchor' && <AnchorStep />}
      </section>
    </>
  );
}

function WorkspaceContent() {
  const { activeWorkspace } = useWorkspace();
  if (activeWorkspace === 'close') return <CloseWorkspace />;
  const meta = WORKSPACES.find((w) => w.id === activeWorkspace);
  return (
    <EmptyState
      title={`${meta?.label ?? 'Workspace'} — coming soon`}
      body="此工作面尚未啟用。目前 demo 的可操作流程在 Close workspace。"
    />
  );
}

function Shell() {
  return (
    <>
      <TopBar />
      <div style={{ display: 'flex', maxWidth: 1200, margin: '0 auto', alignItems: 'flex-start' }}>
        <aside style={{ position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
          <SideNav />
        </aside>
        <main
          aria-label="TallyMarina"
          style={{ flex: 1, minWidth: 0, padding: '0 clamp(16px, 4vw, 48px) var(--space-10)' }}
        >
          <GuardrailBanner />
          <div style={{ marginTop: 'var(--space-4)' }}>
            <WorkspaceContent />
          </div>
        </main>
      </div>
    </>
  );
}

export default function App() {
  return (
    <EntityProvider>
      <WorkspaceProvider>
        <AppBackground />
        <Shell />
      </WorkspaceProvider>
    </EntityProvider>
  );
}
