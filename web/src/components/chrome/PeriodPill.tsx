import { useEntityCtx } from '../../app/EntityContext';

export function PeriodPill() {
  const { periodId } = useEntityCtx();
  return (
    <span aria-label="Accounting period" className="period-pill">
      {periodId}
    </span>
  );
}
