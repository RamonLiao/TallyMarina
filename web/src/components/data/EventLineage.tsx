// DATA ZONE (spec §8.4) — NEVER import Mascot here.
import type { EventDTO, JournalDTO } from '../../api/types';
export function EventLineage(_: { event: EventDTO; entityId: string; journal: JournalDTO[] }) {
  return <div data-testid="lineage-stub" />;
}
