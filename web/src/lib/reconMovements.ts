import type { JournalDTO, EventDTO } from '../api/types';
import { origMemo } from './balance';

/**
 * Recompute wallet|coinType movement totals from raw JE lines — client-side mirror of
 * backend walletAssetMovements. Uses origMemo for netting (DEBIT−CREDIT per coinType).
 * Throws on integrity gaps: a JE with no matching event, or an event with no wallet.
 */
export function recomputeMovements(
  journal: JournalDTO[],
  events: EventDTO[],
): Record<string, bigint> {
  const result: Record<string, bigint> = {};
  for (const je of journal) {
    const event = events.find((e) => e.id === je.eventId);
    if (!event) {
      throw new Error(
        `recomputeMovements: no event found for JE ${je.id} (eventId=${je.eventId})`,
      );
    }
    const wallet = (event.normalized as Record<string, unknown>)?.wallet as string | undefined;
    if (!wallet) {
      throw new Error(
        `recomputeMovements: event ${event.id} has no normalized.wallet`,
      );
    }
    const memo = origMemo(je.je.lines);
    for (const [coinType, net] of Object.entries(memo)) {
      const key = `${wallet}|${coinType}`;
      result[key] = (result[key] ?? 0n) + net;
    }
  }
  return result;
}
