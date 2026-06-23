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
import { ExceptionsWorkspace } from './workspaces/ExceptionsWorkspace';
import { AuditWorkspace } from './workspaces/AuditWorkspace';
import { ReconciliationWorkspace } from './workspaces/ReconciliationWorkspace';

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
  const { entity } = useEntityCtx();
  if (activeWorkspace === 'close') return <CloseWorkspace />;
  if (activeWorkspace === 'exceptions') return <ExceptionsWorkspace />;
  if (activeWorkspace === 'audit') return <AuditWorkspace />;
  if (activeWorkspace === 'reconciliation') return <ReconciliationWorkspace entityId={entity?.id ?? ''} />;
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
      {/* Full-width governance strip — directly under TopBar so the AI "leash" is never
          buried below the sidebar on mobile and stays prominent on desktop (spec §8.5). */}
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: 'var(--space-3) clamp(16px, 4vw, 48px) 0',
        }}
      >
        <GuardrailBanner />
      </div>
      <div className="shell-body" style={{ display: 'flex', maxWidth: 1200, margin: '0 auto', alignItems: 'flex-start' }}>
        <aside
          className="shell-sidenav"
          style={{
            position: 'sticky',
            top: 'var(--space-4)',
            alignSelf: 'flex-start',
            // Constrain to the viewport and own the overflow so a long content
            // column can't make the rail extend off-screen / peek past the chrome.
            maxHeight: 'calc(100vh - var(--space-8))',
            overflowY: 'auto',
          }}
        >
          <SideNav />
        </aside>
        <main
          aria-label="TallyMarina"
          style={{ flex: 1, minWidth: 0, padding: 'var(--space-4) clamp(16px, 4vw, 48px) var(--space-10)' }}
        >
          <WorkspaceContent />
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
