import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/store/db.js';
import { insertAssetIfAbsent } from '../src/assets/store.js';
import { getAssetDecimals } from '../src/assets/registry.js';

const tmpDirs: string[] = [];
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'assetreg2-')); tmpDirs.push(dir);
  const db = openDb(join(dir, 'test.db'));
  db.prepare(`INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id)
              VALUES ('e1','E1','0xc','0xcap','0xpkg')`).run();
  return db;
}
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const SUI_LONG = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

describe('getAssetDecimals', () => {
  it('returns null for an unregistered asset — never a default', () => {
    // WHY: this is the whole bug. `?? 9` silently mislabelled 6dp stablecoins by 1000x.
    expect(getAssetDecimals(freshDb(), 'e1', SUI_LONG)).toBeNull();
  });

  it('finds a row registered under the long form when queried with the short form', () => {
    const db = freshDb();
    insertAssetIfAbsent(db, { entityId: 'e1', coinType: SUI_LONG, decimals: 9, symbol: 'SUI',
      displayName: 'Sui', source: 'chain', chainObjectId: '0xm', metadataCapState: 'DELETED',
      fetchedAt: 't', decidedBy: null, reason: null, createdAt: 't' });
    // WHY (V2): ingest sees '0x2::sui::SUI' in the event payload; the registry stores canonical.
    expect(getAssetDecimals(db, 'e1', '0x2::sui::SUI')).toEqual({
      decimals: 9, symbol: 'SUI', displayName: 'Sui', source: 'chain',
    });
  });

  it('returns null rather than throwing for a malformed coinType', () => {
    // WHY: read paths must not explode on legacy rows. Unknown scale is a state, not a crash.
    expect(getAssetDecimals(freshDb(), 'e1', 'garbage')).toBeNull();
  });
});
