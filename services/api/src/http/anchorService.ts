import type { Db } from '../store/db.js';
import type { ApiConfig } from '../config.js';
import { ApiError } from './errors.js';
import { getEntity } from '../store/entityStore.js';
import { getSnapshot, setSnapshotStatus, getLatestSnapshotSeq } from '../store/snapshotStore.js';
import { insertAnchor, listAnchors, type AnchorRow } from '../store/anchorStore.js';
import { deriveEntityRef } from '../deps/anchorSvc.js';
import { buildAnchorPtb } from '@subledger/anchor-svc';
import type { SuiGrpcChainAdapter } from '@subledger/anchor-svc';

export interface AnchorServiceDeps {
  db: Db;
  adapter: SuiGrpcChainAdapter;
  mutex: { run<T>(key: string, fn: () => Promise<T>): Promise<T> };
  cfg: ApiConfig;
}

export interface AnchorDTO {
  id: string; snapshotId: string; seq: number; link: string; digest: string; explorerUrl: string; anchoredAt: string;
}

/**
 * S-F1: on-chain supersedes_seq must be a CHAIN seq (entity-global), not the
 * snapshot's per-period seq. Return the chain seq of this period's prior anchor
 * (the version being replaced on-chain), or 0 if this period was never anchored.
 */
export function computeSupersedesChainSeq(db: Db, entityId: string, periodId: string): number {
  const priorForPeriod = listAnchors(db, entityId)
    .map((a) => ({ a, snap: getSnapshot(db, a.snapshotId) }))
    .filter((x) => x.snap?.periodId === periodId)
    .sort((x, y) => y.a.seq - x.a.seq)[0];
  return priorForPeriod ? priorForPeriod.a.seq : 0;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function prepareAnchor(
  deps: AnchorServiceDeps,
  p: { entityId: string; snapshotId: string; walletAddress: string },
): Promise<{ txKind: string; expectedSeq: number; chainId: string; capId: string }> {
  return deps.mutex.run(p.entityId, async () => {
    const ent = getEntity(deps.db, p.entityId);
    if (!ent) throw new ApiError(404, 'ENTITY_NOT_FOUND', `no entity ${p.entityId}`);
    const snap = getSnapshot(deps.db, p.snapshotId);
    if (!snap) throw new ApiError(404, 'SNAPSHOT_NOT_FOUND', `no snapshot ${p.snapshotId}`);
    if (snap.status !== 'FROZEN') throw new ApiError(409, 'ILLEGAL_TRANSITION', `snapshot ${snap.status}, expected FROZEN`);
    // S-F2: refuse to anchor a superseded FROZEN version — it would make a known-stale
    // root an on-chain fact and create a permanent STALE_ANCHOR.
    const latestSeq = getLatestSnapshotSeq(deps.db, snap.entityId, snap.periodId);
    if (snap.seq < latestSeq) {
      throw new ApiError(409, 'ANCHOR_SUPERSEDED', `snapshot seq ${snap.seq} superseded by seq ${latestSeq}; anchor the latest`);
    }

    let chain;
    try {
      chain = await deps.adapter.getChainState(ent.chainObjectId);
    } catch (e) {
      throw new ApiError(502, 'CHAIN_UNREACHABLE', e instanceof Error ? e.message : String(e));
    }
    // A4 gate: on-chain entity_ref must match derived ref.
    if (!bytesEqual(chain.entityRef, deriveEntityRef(p.entityId))) {
      throw new ApiError(409, 'ENTITY_CHAIN_MISMATCH', `entity_ref mismatch for ${p.entityId}`);
    }
    // Cap-owner preflight.
    let owner: string;
    try { owner = await deps.adapter.getCapOwner(ent.capObjectId); }
    catch (e) { throw new ApiError(502, 'CHAIN_UNREACHABLE', e instanceof Error ? e.message : String(e)); }
    if (owner !== p.walletAddress) {
      throw new ApiError(409, 'CAP_NOT_OWNED_BY_WALLET', `cap owned by ${owner}, not ${p.walletAddress}`);
    }
    const expectedSeq = Number(chain.seq) + 1;
    // hashes come from the SERVER snapshot row — never client input (anti-tamper).
    const ptb = buildAnchorPtb({
      packageId: deps.cfg.anchorPackageId,
      chainObjectId: ent.chainObjectId,
      capObjectId: ent.capObjectId,
      prevLink: chain.latestLink,
      walletAddress: p.walletAddress,
      args: {
        manifestHash: snap.manifestHash, merkleRoot: snap.merkleRoot,
        periodId: snap.periodId, supersedesSeq: computeSupersedesChainSeq(deps.db, snap.entityId, snap.periodId),
      },
    });
    return { txKind: ptb.txKind, expectedSeq, chainId: ent.chainObjectId, capId: ent.capObjectId };
  });
}

export async function confirmAnchor(
  deps: AnchorServiceDeps,
  p: { entityId: string; snapshotId: string; digest: string; expectedSeq: number },
): Promise<AnchorDTO> {
  return deps.mutex.run(p.entityId, async () => {
    const ent = getEntity(deps.db, p.entityId);
    if (!ent) throw new ApiError(404, 'ENTITY_NOT_FOUND', `no entity ${p.entityId}`);
    const snap = getSnapshot(deps.db, p.snapshotId);
    if (!snap) throw new ApiError(404, 'SNAPSHOT_NOT_FOUND', `no snapshot ${p.snapshotId}`);
    // Fast-fail: only FROZEN snapshots may be anchored.
    if (snap.status !== 'FROZEN') throw new ApiError(409, 'ILLEGAL_TRANSITION', `snapshot status is ${snap.status}, expected FROZEN`);

    try { await deps.adapter.waitForTransaction(p.digest); }
    catch (e) { throw new ApiError(502, 'CHAIN_UNREACHABLE', e instanceof Error ? e.message : String(e)); }

    const chain = await deps.adapter.getChainState(ent.chainObjectId);
    // fail-closed: confirmed head seq must equal expectedSeq.
    if (Number(chain.seq) !== p.expectedSeq) {
      throw new ApiError(409, 'SEQ_MISMATCH', `head seq ${chain.seq} != expected ${p.expectedSeq}`);
    }
    const ev = await deps.adapter.getAnchorEvent(p.digest);
    const linkHex = Buffer.from(ev.link).toString('hex');
    // setSnapshotStatus validates FROZEN -> ANCHORED (throws StateError if already ANCHORED).
    setSnapshotStatus(deps.db, p.snapshotId, 'ANCHORED');
    const row: AnchorRow = {
      id: `anchor-${p.entityId}-${Number(ev.seq)}`, entityId: p.entityId, snapshotId: p.snapshotId,
      seq: Number(ev.seq), link: linkHex, digest: p.digest,
      explorerUrl: `${deps.cfg.explorerBase}/tx/${p.digest}`, anchoredAt: new Date().toISOString(),
    };
    insertAnchor(deps.db, row);
    return row;
  });
}
