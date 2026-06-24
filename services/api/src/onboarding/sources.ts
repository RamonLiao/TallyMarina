import type { Db } from '../store/db.js';
import { listEvents } from '../store/eventStore.js';
import { DEMO_OWNED_WALLET } from './constants.js';

export interface DerivedSource {
  wallet: string;
  eventCount: number;
  isDemoOwned: boolean;
}

export function deriveSources(db: Db, entityId: string): DerivedSource[] {
  const counts = new Map<string, number>();
  for (const ev of listEvents(db, entityId)) {
    const wallet = (JSON.parse(ev.rawJson) as { wallet?: string }).wallet;
    if (!wallet) throw new Error(`onboarding: event ${ev.id} has no wallet`);
    counts.set(wallet, (counts.get(wallet) ?? 0) + 1);
  }
  if (!counts.has(DEMO_OWNED_WALLET)) counts.set(DEMO_OWNED_WALLET, 0);
  return [...counts.entries()]
    .map(([wallet, eventCount]) => ({ wallet, eventCount, isDemoOwned: wallet === DEMO_OWNED_WALLET }))
    .sort((a, b) => a.wallet.localeCompare(b.wallet));
}
