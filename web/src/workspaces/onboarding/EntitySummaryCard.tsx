import type { OnboardingDTO } from '../../api/types';

export function EntitySummaryCard({ entity }: { entity: OnboardingDTO['entity'] }) {
  const m = entity.meta;
  return (
    <section className="ob-card">
      <h2 className="ob-card-title">{entity.displayName}</h2>
      <p className="ob-card-note">These settings drive downstream FX conversion and period close.</p>
      {m ? (
        <>
          <Row label="Functional currency" value={m.functionalCurrency} />
          <Row label="Reporting currency" value={m.reportingCurrency} />
          <Row label="Fiscal calendar" value={m.fiscalCalendar} />
          <Row label="Timezone" value={m.timezone} />
        </>
      ) : <p className="ob-bad">entity meta unavailable</p>}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="ob-defrow">
      <span className="ob-defrow-label">{label}</span>
      <span className="ob-defrow-value">{value}</span>
    </div>
  );
}
