import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { useEntityCtx } from '../../app/EntityContext';
import { useOnboardingData } from '../../data/useOnboardingData';
import { EntitySummaryCard } from './EntitySummaryCard';
import { SourceTable } from './SourceTable';
import './onboarding.css';

export function OnboardingWorkspace() {
  const { entity } = useEntityCtx();
  const { data, loading, error, refetch } = useOnboardingData(entity?.id ?? '');

  if (loading && !data) return <div className="ob-workspace"><p>Loading onboarding…</p></div>;
  if (error || !data) return <div className="ob-workspace"><p className="ob-bad">onboarding unavailable{error ? `: ${error}` : ''}</p></div>;

  return (
    <div className="ob-workspace">
      <div className="ob-toolbar"><ConnectButton /></div>
      <EntitySummaryCard entity={data.entity} />
      <SourceTable data={data} onVerified={() => { void refetch(); }} />
    </div>
  );
}
