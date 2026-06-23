// TODO Task 5 — replace this stub with full ExceptionDetail + DispositionControls
import type { ExceptionDTO } from '../../api/types';

export function ExceptionDetail({
  exception,
  entityId: _entityId,
}: {
  exception: ExceptionDTO;
  entityId: string;
}) {
  return <div className="card">{exception.exceptionId}</div>;
}
