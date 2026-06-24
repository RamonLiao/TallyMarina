import { useEntityCtx } from '../../app/EntityContext';
import { usePolicyData } from '../../data/usePolicyData';
import { PolicySummaryCard } from './PolicySummaryCard';
import { CoaMappingTable } from './CoaMappingTable';
import { PreviewPanel } from './PreviewPanel';
import './policy.css';

export function PolicyWorkspace() {
  const { entity } = useEntityCtx();
  const { data, loading, error } = usePolicyData(entity?.id ?? '');

  if (loading && !data) return <div className="policy-workspace"><p>Loading policy…</p></div>;
  if (error || !data) return <div className="policy-workspace"><p className="policy-bad">policy unavailable{error ? `: ${error}` : ''}</p></div>;

  const { policy, journal, events } = data;
  return (
    <div className="policy-workspace">
      <PolicySummaryCard policy={policy} />
      <CoaMappingTable rules={policy.coaMapping.rules} defaultAccount={policy.coaMapping.defaultAccount} title="Live COA mapping" />
      <PreviewPanel policy={policy} journal={journal} events={events} />
    </div>
  );
}
