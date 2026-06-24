import { describe, it, expect } from 'vitest';
import { buildTestApp, seedEntity, seedSnapshot, seedAnchor } from './helpers.js';

describe('GET /anchors periodId+leafCount enrichment', () => {
  it('anchors expose periodId and leafCount from the snapshot join', async () => {
    const app = await buildTestApp(false);
    seedEntity(app._db, 'acme:pilot-001');
    seedSnapshot(app._db, { id: 'snap-1', entityId: 'acme:pilot-001', merkleRoot: 'abcd1234', periodId: 'period-42', leafCount: 7 });
    seedAnchor(app._db, { id: 'anc-1', entityId: 'acme:pilot-001', snapshotId: 'snap-1', seq: 1 });

    const res = await app.inject({ method: 'GET', url: '/entities/acme%3Apilot-001/anchors' });
    expect(res.statusCode).toBe(200);
    const { anchors } = res.json() as { anchors: Array<{ periodId?: unknown; leafCount?: unknown }> };
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(typeof a.periodId).toBe('string');
      expect((a.periodId as string).length).toBeGreaterThan(0);
      expect(Number.isInteger(a.leafCount)).toBe(true);
      expect(a.leafCount as number).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('GET /anchors merkleRoot enrichment', () => {
  it('joins each anchor to its snapshot merkleRoot', async () => {
    const app = await buildTestApp(false);
    seedEntity(app._db, 'acme:pilot-001');
    seedSnapshot(app._db, { id: 'snap-1', entityId: 'acme:pilot-001', merkleRoot: 'abcd1234' });
    seedAnchor(app._db, { id: 'anc-1', entityId: 'acme:pilot-001', snapshotId: 'snap-1', seq: 1 });

    const res = await app.inject({ method: 'GET', url: '/entities/acme%3Apilot-001/anchors' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { anchors: Array<{ merkleRoot?: string | null }> };
    expect(body.anchors[0]?.merkleRoot).toBe('abcd1234');
  });

  it('returns merkleRoot null when the snapshot row is gone (fail-soft, no throw)', async () => {
    const app = await buildTestApp(false);
    seedEntity(app._db, 'acme:pilot-001');
    seedSnapshot(app._db, { id: 'snap-x', entityId: 'acme:pilot-001' });
    seedAnchor(app._db, { id: 'anc-x', entityId: 'acme:pilot-001', snapshotId: 'snap-x', seq: 1 });
    // Delete the snapshot after anchor creation to simulate missing snapshot (disable FK temporarily)
    app._db.pragma('foreign_keys = OFF');
    app._db.prepare('DELETE FROM snapshots WHERE id = ?').run('snap-x');
    app._db.pragma('foreign_keys = ON');

    const res = await app.inject({ method: 'GET', url: '/entities/acme%3Apilot-001/anchors' });
    expect(res.statusCode).toBe(200);
    expect(res.json().anchors[0]?.merkleRoot).toBeNull();
  });
});
