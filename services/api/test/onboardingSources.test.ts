import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { insertEntity } from '../src/store/entityStore.js';
import { insertEvent } from '../src/store/eventStore.js';
import { deriveSources } from '../src/onboarding/sources.js';
import { DEMO_OWNED_WALLET } from '../src/onboarding/constants.js';

let db: Db;
const E = 'acme:pilot-001';
beforeEach(() => {
  db = openDb(':memory:');
  insertEntity(db, { id: E, displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' });
});

function addEvent(id: string, wallet: string) {
  insertEvent(db, { id, entityId: E, rawJson: JSON.stringify({ wallet, eventTime: '2026-05-01T00:00:00Z' }) });
}

describe('deriveSources', () => {
  it('returns distinct wallets ∪ DEMO_OWNED_WALLET with counts', () => {
    addEvent('e1', '0xacmeTreasury');
    addEvent('e2', '0xacmeTreasury');
    addEvent('e3', '0xcustomerA');
    const s = deriveSources(db, E);
    const treasury = s.find((x) => x.wallet === '0xacmeTreasury');
    expect(treasury?.eventCount).toBe(2);
    expect(s.some((x) => x.wallet === '0xcustomerA')).toBe(true);
    const demo = s.find((x) => x.wallet === DEMO_OWNED_WALLET);
    expect(demo?.isDemoOwned).toBe(true);
    expect(demo?.eventCount).toBe(0);
  });

  it('returns sorted by wallet', () => {
    addEvent('e1', '0xZZZ');
    addEvent('e2', '0xAAA');
    const s = deriveSources(db, E);
    const wallets = s.map((x) => x.wallet);
    expect(wallets).toEqual([...wallets].sort());
  });

  it('throws when an event has no wallet in rawJson', () => {
    insertEvent(db, { id: 'bad', entityId: E, rawJson: JSON.stringify({ other: 'field', eventTime: '2026-05-01T00:00:00Z' }) });
    expect(() => deriveSources(db, E)).toThrow('no wallet');
  });
});
