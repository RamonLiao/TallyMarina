import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/store/db.js';
import { applyReconDisposition } from '../src/reconciliation/disposition.js';
import { getReconDisposition } from '../src/store/reconBreakStore.js';

const base = { entityId: 'acme:pilot-001', periodId: '2026-Q2', wallet: '0xw', coinType: '0x2::sui::SUI', decidedBy: 'demo-controller', now: 1 };

describe('applyReconDisposition', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('acme:pilot-001','Acme','0x1','0x2','0x3')").run();
  });

  it('open -> resolved persists + logs prev_state', () => {
    applyReconDisposition(db, { ...base, to: 'resolved', reasonCode: 'error', reasonNote: 'correcting JE filed' });
    const row = getReconDisposition(db, base.entityId, base.periodId, base.wallet, base.coinType)!;
    expect(row.state).toBe('resolved');
    expect(row.reasonCode).toBe('error');
    const log = db.prepare('SELECT prev_state, state FROM recon_break_disposition_log').all() as { prev_state: string | null; state: string }[];
    expect(log).toEqual([{ prev_state: null, state: 'resolved' }]);
  });

  it('rejects illegal transition resolved -> open', () => {
    applyReconDisposition(db, { ...base, to: 'resolved', reasonCode: 'error', reasonNote: null });
    expect(() => applyReconDisposition(db, { ...base, to: 'open', reasonCode: 'error', reasonNote: null, now: 2 }))
      .toThrow(/ILLEGAL_TRANSITION/);
  });
});
