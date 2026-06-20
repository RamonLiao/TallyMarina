import { describe, it, expect } from 'vitest';
import { deconstruct } from '../src/core/deconstruct.js';
import type { RawTxEnvelope } from '../src/domain/types.js';

const base = (rawJson: unknown): RawTxEnvelope => ({
  digest: 'D1', checkpoint: '1', timestampMs: '1', status: 'success', rawJson,
});

describe('deconstruct', () => {
  it('maps a balanceChange to a coin_balance_change effect with string amount', () => {
    const { effects } = deconstruct(base({
      balanceChanges: [{ coinType: '0x2::sui::SUI', owner: { AddressOwner: '0xb' }, amount: '-1000' }],
    }));
    const c = effects.find(e => e.kind === 'coin_balance_change')!;
    expect(c.amount).toBe('-1000');
    expect(c.coinType).toBe('0x2::sui::SUI');
    expect(typeof c.amount).toBe('string');
  });

  it('emits exactly one gas effect tagged so it is not double-booked', () => {
    const { effects } = deconstruct(base({
      balanceChanges: [{ coinType: '0x2::sui::SUI', owner: { AddressOwner: '0xb' }, amount: '-1000' }],
      effects: { gasUsed: { computationCost: '700', storageCost: '300', storageRebate: '100', nonRefundableStorageFee: '0' } },
    }));
    const gas = effects.filter(e => e.kind === 'gas');
    expect(gas).toHaveLength(1);
    expect(gas[0].rawRef).toBe('effects.gasUsed');
  });

  it('gas effect carries balance_change_gas_inclusive marker', () => {
    const { effects } = deconstruct(base({
      effects: { gasUsed: { computationCost: '700', storageCost: '300', storageRebate: '100', nonRefundableStorageFee: '0' } },
    }));
    const gas = effects.find(e => e.kind === 'gas')!;
    expect(gas.note).toBe('balance_change_gas_inclusive');
  });

  it('classifies StakedSui objectChange as staking', () => {
    const { effects } = deconstruct(base({
      objectChanges: [{ type: 'created', objectType: '0x3::staking_pool::StakedSui', objectId: '0xs' }],
    }));
    expect(effects.some(e => e.kind === 'staking' && e.objectId === '0xs')).toBe(true);
  });

  it('never throws on unrecognized shape and yields unknown with rawRef', () => {
    const { effects } = deconstruct(base({ weirdField: [{ z: 1 }] }));
    expect(effects.some(e => e.kind === 'unknown')).toBe(true);
    expect(effects.find(e => e.kind === 'unknown')!.rawRef).toBeDefined();
  });

  it('sets overflow when effect count exceeds the cap and honors exact cap', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ coinType: 'c', owner: { AddressOwner: '0x' + i }, amount: '1' }));
    const { overflow, effects } = deconstruct(base({ balanceChanges: many }), { maxEffects: 3 });
    expect(overflow).toBe(true);
    expect(effects.length).toBe(3);
  });

  it('emits unknown for each unrecognized top-level field even when recognized fields also exist', () => {
    const { effects } = deconstruct(base({
      balanceChanges: [{ coinType: '0x2::sui::SUI', owner: { AddressOwner: '0xb' }, amount: '-1000' }],
      mysteryField: [{ q: 1 }],
    }));
    expect(effects.some(e => e.kind === 'coin_balance_change')).toBe(true);
    expect(effects.some(e => e.kind === 'unknown' && e.rawRef === 'mysteryField')).toBe(true);
  });
});
