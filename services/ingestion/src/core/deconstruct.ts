import type { RawTxEnvelope, RawEffect } from '../domain/types.js';

const DEFAULT_MAX = 10_000;

function ownerToAddress(owner: unknown): string | undefined {
  if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
    return String((owner as Record<string, unknown>).AddressOwner);
  }
  return undefined;
}

export function deconstruct(
  env: RawTxEnvelope,
  opts: { maxEffects?: number } = {},
): { effects: RawEffect[]; overflow: boolean } {
  const max = opts.maxEffects ?? DEFAULT_MAX;
  const json = (env.rawJson ?? {}) as Record<string, unknown>;
  const effects: RawEffect[] = [];
  let overflow = false;
  let idx = 0;
  const push = (e: Omit<RawEffect, 'rawIndex'>): boolean => {
    if (effects.length >= max) { overflow = true; return false; }
    effects.push({ rawIndex: idx++, ...e });
    return true;
  };

  const balanceChanges = Array.isArray(json.balanceChanges) ? json.balanceChanges : [];
  for (let i = 0; i < balanceChanges.length; i++) {
    const b = balanceChanges[i] as Record<string, unknown>;
    if (!push({
      kind: 'coin_balance_change',
      coinType: b.coinType != null ? String(b.coinType) : undefined,
      amount: b.amount != null ? String(b.amount) : undefined,
      counterparty: ownerToAddress(b.owner),
      rawRef: `balanceChanges.${i}`,
    })) return { effects, overflow };
  }

  const objectChanges = Array.isArray(json.objectChanges) ? json.objectChanges : [];
  for (let i = 0; i < objectChanges.length; i++) {
    const o = objectChanges[i] as Record<string, unknown>;
    const objectType = o.objectType != null ? String(o.objectType) : '';
    const isStake = objectType.includes('StakedSui');
    if (!push({
      kind: isStake ? 'staking' : 'object_transfer',
      objectId: o.objectId != null ? String(o.objectId) : undefined,
      rawRef: `objectChanges.${i}`,
    })) return { effects, overflow };
  }

  const gasUsed = (json.effects as Record<string, unknown> | undefined)?.gasUsed;
  if (gasUsed && typeof gasUsed === 'object') {
    if (!push({ kind: 'gas', coinType: '0x2::sui::SUI', rawRef: 'effects.gasUsed' })) {
      return { effects, overflow };
    }
  }

  const events = Array.isArray(json.events) ? json.events : [];
  for (let i = 0; i < events.length; i++) {
    if (!push({ kind: 'event', rawRef: `events.${i}` })) return { effects, overflow };
  }

  // Emit one unknown effect per unrecognized top-level field.
  const known = new Set(['balanceChanges', 'objectChanges', 'effects', 'events']);
  const unknownKeys = Object.keys(json).filter(k => !known.has(k));
  if (unknownKeys.length > 0) {
    for (const key of unknownKeys) {
      if (!push({ kind: 'unknown', rawRef: key })) return { effects, overflow };
    }
  } else if (effects.length === 0) {
    // No recognized fields and no unknown fields: emit a root-level unknown so tx is never silent.
    push({ kind: 'unknown', rawRef: '$root' });
  }

  return { effects, overflow };
}
