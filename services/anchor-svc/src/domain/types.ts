export const HASH_LEN = 32;
export const MAX_REF_LEN = 64;
export const U64_MAX = 2n ** 64n - 1n;

export type AnchorErrorCode =
  | 'ENTITY_NOT_REGISTERED'
  | 'ENTITY_REF_MISMATCH'
  | 'STALE_CAP'
  | 'BAD_HASH_LEN'
  | 'PERIOD_TOO_LONG'
  | 'SEQ_OUT_OF_RANGE'
  | 'LINK_MISMATCH_AFTER_RETRY'
  | 'ENTITY_CHAIN_NOT_FOUND'
  | 'AMBIGUOUS_ENTITY_CHAIN';

export class AnchorError extends Error {
  constructor(public readonly code: AnchorErrorCode, message?: string) {
    // Always surface the code in the message so logs and string matchers
    // (and consistency across throw sites) carry it without manual prefixing.
    super(message ? `${code}: ${message}` : code);
    this.name = 'AnchorError';
  }
}

/** Thrown by SuiChainPort.execAnchor when the chain rejects prev_link (on-chain ELinkMismatch). */
export class LinkMismatchError extends Error {
  constructor(message?: string) {
    super(message ?? 'on-chain prev_link mismatch');
    this.name = 'LinkMismatchError';
  }
}

export interface ChainState {
  entityRef: Uint8Array;
  latestLink: Uint8Array;
  seq: bigint;
  capEpoch: bigint;
}

export interface EntityRegistryEntry {
  chainObjectId: string;
  capObjectId: string;
}
export type EntityRegistry = Record<string, EntityRegistryEntry>;

export interface AnchorCallArgs {
  manifestHash: Uint8Array; // 32B
  merkleRoot: Uint8Array;   // 32B
  periodId: Uint8Array;     // <=64B
  supersedesSeq: bigint;    // 0 = no prior
}

export interface AnchorResult {
  digest: string;
  seq: bigint;
  link: Uint8Array;
}

export interface ExecAnchorInput {
  packageId: string;
  chainObjectId: string;
  capObjectId: string;
  prevLink: Uint8Array;
  args: AnchorCallArgs;
}

export interface SuiChainPort {
  getChainState(chainObjectId: string): Promise<ChainState>;
  getCapEpoch(capObjectId: string): Promise<bigint>;
  execAnchor(input: ExecAnchorInput): Promise<AnchorResult>;
}

/** One discovered AnchorCap owned by the signer, with the chain it writes to. */
export interface OwnedCap {
  capObjectId: string;
  chainId: string;
}

/**
 * Discovery port for buildRegistry. Separate from SuiChainPort so the builder
 * is unit-testable with a fake and the write path is not widened.
 * `originalPackageId` is the FIRST-published package id — Sui struct types keep
 * the identity of their defining package across upgrades, so the AnchorCap
 * StructType filter must use the original id, not the latest upgraded id.
 */
export interface RegistryPort {
  listOwnedAnchorCaps(owner: string, originalPackageId: string): Promise<OwnedCap[]>;
  getChainState(chainObjectId: string): Promise<ChainState>;
}
