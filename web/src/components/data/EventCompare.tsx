// DATA ZONE (spec §8.4) — NEVER import Mascot here.
import type { EventDTO, JournalDTO } from '../../api/types';
export function EventCompare(_: { events: EventDTO[]; journal: JournalDTO[] }) {
  return <div data-testid="compare-stub" />;
}
