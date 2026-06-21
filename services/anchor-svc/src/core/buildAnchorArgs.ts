import { AnchorError, HASH_LEN, MAX_REF_LEN, U64_MAX, type AnchorCallArgs } from '../domain/types.js';

export interface AnchorPayloadInput {
  manifestHash: string;  // hex, 32B
  merkleRoot: string;    // hex, 32B
  periodId: string;
  supersedesSeq: number; // >=0, 0 = no prior
}

/** Strict fixed-length hex → bytes. Rejects bad hex or wrong length as BAD_HASH_LEN. */
function hexToHash(hex: string, field: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (s.length !== HASH_LEN * 2 || !/^[0-9a-fA-F]+$/.test(s)) {
    throw new AnchorError('BAD_HASH_LEN', `${field} must be ${HASH_LEN}-byte hex, got "${hex}"`);
  }
  const out = new Uint8Array(HASH_LEN);
  for (let i = 0; i < HASH_LEN; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function buildAnchorArgs(payload: AnchorPayloadInput): AnchorCallArgs {
  const manifestHash = hexToHash(payload.manifestHash, 'manifestHash');
  const merkleRoot = hexToHash(payload.merkleRoot, 'merkleRoot');

  const periodId = new Uint8Array(Buffer.from(payload.periodId, 'utf8'));
  if (periodId.length > MAX_REF_LEN) {
    throw new AnchorError('PERIOD_TOO_LONG', `period_id is ${periodId.length} bytes (max ${MAX_REF_LEN})`);
  }

  if (!Number.isInteger(payload.supersedesSeq) || payload.supersedesSeq < 0) {
    throw new AnchorError('SEQ_OUT_OF_RANGE', `supersedesSeq must be a non-negative integer, got ${payload.supersedesSeq}`);
  }
  const supersedesSeq = BigInt(payload.supersedesSeq);
  if (supersedesSeq > U64_MAX) {
    throw new AnchorError('SEQ_OUT_OF_RANGE', `supersedesSeq exceeds u64 max`);
  }

  return { manifestHash, merkleRoot, periodId, supersedesSeq };
}
