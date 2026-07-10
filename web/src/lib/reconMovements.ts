import type { JournalDTO, EventDTO } from '../api/types';
import { origMemo } from './balance';

/**
 * Recompute wallet|coinType movement totals from raw JE lines — client-side mirror of
 * backend walletAssetMovements. Uses origMemo for netting (DEBIT−CREDIT per coinType).
 * Throws on integrity gaps: a JE with no matching event, or an event with no wallet.
 *
 * MUST stay behaviourally identical to services/api/src/reconciliation/movement.ts
 * walletAssetMovements — including the OPENING_LOT exclusion below. This function is the
 * independent check the recon screen runs against the backend's own numbers; a divergence
 * here does not fail safe, it prints a break that isn't there.
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
    // OPENING_LOT declares pre-history holdings, not period activity — its quantity is already
    // the recon fixture's openingMinor. Folding its ACQUISITION leg in here would double-count
    // the same holding on both sides of `computed = opening + movement`.
    // Discriminator mirrors movement.ts:49 exactly: final (the type the engine actually posted
    // under, after any §6.9 human review override) takes precedence over the raw ingest type.
    // The DTO's `normalized` IS the raw event (routes.ts: `normalized: JSON.parse(e.rawJson)`),
    // so `normalized.eventType` is the backend's `rawEvent.eventType`.
    const postedType = event.final?.eventType
      ?? (event.normalized as Record<string, unknown>)?.eventType as string | undefined;
    if (postedType === 'OPENING_LOT') continue;
    const memo = origMemo(je.je.lines);
    for (const [coinType, net] of Object.entries(memo)) {
      const key = `${wallet}|${coinType}`;
      result[key] = (result[key] ?? 0n) + net;
    }
  }
  return result;
}
