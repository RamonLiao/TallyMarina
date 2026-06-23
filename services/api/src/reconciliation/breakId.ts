// services/api/src/reconciliation/breakId.ts
// Single source of truth for the wallet|coinType breakId wire format.

class ReconBreakIdError extends Error {
  readonly code = 'RECON_BREAK_ID_INVALID';
  constructor(msg: string) { super(msg); this.name = 'ReconBreakIdError'; }
}

export function encodeReconBreakId(wallet: string, coinType: string): string {
  return `${wallet}|${coinType}`;
}

export function decodeReconBreakId(raw: string): { wallet: string; coinType: string } {
  const parts = raw.split('|');
  if (parts.length !== 2) throw new ReconBreakIdError(`breakId must be exactly wallet|coinType, got: ${raw}`);
  const [wallet, coinType] = parts;
  if (!wallet || !coinType) throw new ReconBreakIdError('breakId wallet and coinType must both be non-empty');
  return { wallet, coinType };
}

export { ReconBreakIdError };
