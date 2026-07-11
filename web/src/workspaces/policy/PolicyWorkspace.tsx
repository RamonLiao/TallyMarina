import { useEntityCtx } from '../../app/EntityContext';
import { usePolicyData } from '../../data/usePolicyData';
import { PolicySummaryCard } from './PolicySummaryCard';
import { CoaMappingTable } from './CoaMappingTable';
import { PreviewPanel } from './PreviewPanel';
import { PolicyEditForm } from './PolicyEditForm';
import { PolicyHistoryCard } from './PolicyHistoryCard';
import './policy.css';

export function PolicyWorkspace() {
  const { entity } = useEntityCtx();
  const { data, loading, error, applyPolicyChanges, applyCoaMapping } = usePolicyData(entity?.id ?? '');

  if (loading && !data) return <div className="policy-workspace"><p>Loading policy…</p></div>;
  if (error || !data) return <div className="policy-workspace"><p className="policy-bad">policy unavailable{error ? `: ${error}` : ''}</p></div>;

  const { policy, journal, events } = data;
  return (
    <div className="policy-workspace">
      <PolicySummaryCard policy={policy} />
      <PolicyEditForm doc={policy.policyDoc} onApply={applyPolicyChanges} />
      <CoaMappingTable rules={policy.coaMapping.rules} defaultAccount={policy.coaMapping.defaultAccount} title={`Live COA mapping (v${policy.coaMapping.version})`} />
      <PreviewPanel policy={policy} journal={journal} events={events} onApply={applyCoaMapping} />
      <PolicyHistoryCard entityId={entity?.id ?? ''} />
    </div>
  );
}
