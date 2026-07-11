# PolicySet + CoA 落庫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `DEMO_POLICY_SET` / `DEMO_COA_RULES` 常數搬進 SQLite（append-only 版本表），加 change_log 與寫入 API，UI PolicyWorkspace 接電。

**Architecture:** 方案 A（spec §3）：`policy_sets` / `coa_mapping_sets` 為 append-only 版本化 JSON 文件表，active = MAX(version)；`accounts` 為 CoA seed 表；`change_log` append-only。改 MappingRule 必 bump `ruleVersion`（已在 idempotencyKey 內）→ 封 idempotency 碰撞洞。讀路徑換源、契約 additive 不破壞；既有 JE/snapshot bytes 零觸碰。

**Tech Stack:** better-sqlite3、fastify、zod（api 已有 `^3.25.76`）、vitest、React 18。

**Spec:** `docs/superpowers/specs/2026-07-11-policyset-coa-persistence-design.md`（下稱 spec；§n 引用該檔）

## Global Constraints

- 紅線 V4：不重算/不改寫任何既有 JE 與 snapshot；驗收含「既有測試全綠 + snapshot root byte-identical」。
- Fail-closed：讀不到 active policy/mapping → 503 `POLICY_MISSING`，**絕不 fallback 回常數**；髒 doc JSON → fail-loud。
- Append-only：`policy_sets` / `coa_mapping_sets` / `change_log` 無 UPDATE/DELETE 路徑。
- 版本 bump 由 server 計算（尾碼整數遞增，`demo-rule-1`→`demo-rule-2`），client 不得指定。
- `reason` 必填非空；`actor` 自由文字必填（RBAC P1）。
- MVP 幣別鎖 USD：`functionalCurrency`/`reportingCurrency` 不可經 API 修改（400 `CURRENCY_LOCKED`）。
- git：只 stage 明確列出的檔案（`git add <file>...`，禁 `git add -A`）。
- 每個 workspace 跑測試：`cd services/api && npx vitest run`；web：`cd web && npx vitest run`；typecheck：root `npm run typecheck`。
- 現況型別事實：引擎 `ResolvedPolicySet`（`services/rules-engine/src/domain/types.ts:42-53`）只有 6 版本欄 + `costBasisMethod:'FIFO'` + `functionalCurrency` + `roundingThresholdMinor` + `periodOpen`。DB doc 是超集（§9.1 十欄），loader 只餵引擎子集；引擎零改動。

---

### Task 1: DB schema + PolicyDoc 型別 + seed（policyStore 基座）

**Files:**
- Modify: `services/api/src/store/schema.sql`（檔尾加 4 表）
- Modify: `services/api/src/store/db.ts`（MIGRATIONS 加 2 條 ALTER；呼叫 `ensurePolicySeed`）
- Create: `services/api/src/store/policyStore.ts`
- Test: `services/api/test/policyStore.test.ts`

**Interfaces:**
- Produces: `PolicyDoc`（型別）、`PolicyDocSchema`（zod）、`SEED_POLICY_DOC`、`ACCOUNT_SEED`、`bumpVersion(v: string): string`、`ensurePolicySeed(db: Db): void`
- Consumes: `DEMO_POLICY_SET`/`DEMO_COA_RULES`/`CoaRule`（`services/api/src/http/policyConstants.ts`，降級為 seed 唯一輸入）

- [ ] **Step 1: schema.sql 檔尾加 4 表**（`db.exec(SCHEMA)` 每次開庫都跑，`IF NOT EXISTS` 讓 legacy DB 自動補表，不需 MIGRATIONS）

```sql
-- Spec 2026-07-11 policyset-coa-persistence §3: append-only versioned policy documents.
-- active = MAX(version). Rows are NEVER updated or deleted (restatement interface: versions coexist).
CREATE TABLE IF NOT EXISTS policy_sets (
  entity_id  TEXT NOT NULL REFERENCES entities(id),
  version    INTEGER NOT NULL,
  doc        TEXT NOT NULL,      -- JSON: PolicyDoc (§9.1 ten fields + 6 version dims + roundingThresholdMinor)
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (entity_id, version)
);
CREATE TABLE IF NOT EXISTS coa_mapping_sets (
  entity_id    TEXT NOT NULL REFERENCES entities(id),
  version      INTEGER NOT NULL,
  rules        TEXT NOT NULL,    -- JSON: [{eventType, leg, account}], leg='*' catch-all
  rule_version TEXT NOT NULL,    -- audit anchor: equals doc.ruleVersion written in the same transaction
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  PRIMARY KEY (entity_id, version)
);
CREATE TABLE IF NOT EXISTS accounts (
  entity_id      TEXT NOT NULL REFERENCES entities(id),
  name           TEXT NOT NULL,  -- the JE-line account string (single authority, no id alias)
  class          TEXT NOT NULL CHECK (class IN ('asset','liability','equity','income','expense')),
  source_section TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('active','reserved_p1')),
  PRIMARY KEY (entity_id, name)
);
CREATE TABLE IF NOT EXISTS change_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  actor       TEXT NOT NULL,
  at          TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('policy_set','mapping_rule','asset_class','manual_price','je_void')),
  object_ref  TEXT NOT NULL,
  before      TEXT,              -- JSON; NULL for the first human change of an object
  after       TEXT NOT NULL,
  reason      TEXT NOT NULL
);
```

- [ ] **Step 2: db.ts MIGRATIONS 陣列加 2 條 ALTER**（JE 版本欄；spec §3.5——歷史 row 誠實留 NULL，不回填假值）

```ts
    'ALTER TABLE journal_entries ADD COLUMN policy_set_version TEXT',
    'ALTER TABLE journal_entries ADD COLUMN rule_version TEXT',
```

同時 schema.sql 的 `journal_entries` CREATE 內（`period_id TEXT` 之後）加同名兩欄：

```sql
  period_id TEXT,
  policy_set_version TEXT,
  rule_version TEXT
```

- [ ] **Step 3: 寫 failing test（policyStore.test.ts）**

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.js';
import { DEMO_POLICY_SET, DEMO_COA_RULES } from '../src/http/policyConstants.js';

describe('policy persistence seed (Task 1)', () => {
  it('fresh DB has the 4 tables and JE version columns', () => {
    const db = openDb(':memory:');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('policy_sets','coa_mapping_sets','accounts','change_log')",
    ).all().map((r: { name: string }) => r.name).sort();
    expect(tables).toEqual(['accounts', 'change_log', 'coa_mapping_sets', 'policy_sets']);
    const cols = db.prepare('PRAGMA table_info(journal_entries)').all().map((c: { name: string }) => c.name);
    expect(cols).toContain('policy_set_version');
    expect(cols).toContain('rule_version');
  });

  it('seeds version 1 from the demo constants byte-for-byte for every entity', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0xc','0xcap','0xp')").run();
    const { ensurePolicySeed } = require('../src/store/policyStore.js') as typeof import('../src/store/policyStore.js');
    ensurePolicySeed(db);
    const ps = db.prepare("SELECT version, doc, created_by FROM policy_sets WHERE entity_id='e1'").all() as Array<{ version: number; doc: string; created_by: string }>;
    expect(ps).toHaveLength(1);
    expect(ps[0].version).toBe(1);
    expect(ps[0].created_by).toBe('seed');
    const doc = JSON.parse(ps[0].doc);
    // the 6 version dims carry over verbatim from the constant (byte-identical guarantee, spec §3.6)
    expect(doc.policySetVersion).toBe(DEMO_POLICY_SET.policySetVersion);
    expect(doc.ruleVersion).toBe(DEMO_POLICY_SET.ruleVersion);
    expect(doc.roundingThresholdMinor).toBe(DEMO_POLICY_SET.roundingThresholdMinor);
    const coa = db.prepare("SELECT version, rules, rule_version FROM coa_mapping_sets WHERE entity_id='e1'").get() as { version: number; rules: string; rule_version: string };
    expect(coa.version).toBe(1);
    expect(coa.rule_version).toBe('demo-rule-1');
    expect(JSON.parse(coa.rules)).toEqual(DEMO_COA_RULES);
    // accounts: 7 legacy + 8 new MVP + 1 reserved P1 = 16
    const n = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE entity_id='e1'").get() as { n: number };
    expect(n.n).toBe(16);
    const reserved = db.prepare("SELECT status FROM accounts WHERE entity_id='e1' AND name='RevaluationSurplus'").get() as { status: string };
    expect(reserved.status).toBe('reserved_p1');
    // seed writes NO change_log rows (seed is not a human change, spec §3.6)
    expect((db.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number }).n).toBe(0);
  });

  it('ensurePolicySeed is idempotent (re-open does not duplicate)', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0xc','0xcap','0xp')").run();
    const { ensurePolicySeed } = require('../src/store/policyStore.js') as typeof import('../src/store/policyStore.js');
    ensurePolicySeed(db);
    ensurePolicySeed(db);
    expect((db.prepare('SELECT COUNT(*) AS n FROM policy_sets').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM coa_mapping_sets').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(16);
  });

  it('bumpVersion increments a trailing integer and appends -2 otherwise', () => {
    const { bumpVersion } = require('../src/store/policyStore.js') as typeof import('../src/store/policyStore.js');
    expect(bumpVersion('demo-rule-1')).toBe('demo-rule-2');
    expect(bumpVersion('demo-rule-9')).toBe('demo-rule-10');
    expect(bumpVersion('vX')).toBe('vX-2');
  });
});
```

- [ ] **Step 4: 跑測試確認 fail**

Run: `cd services/api && npx vitest run test/policyStore.test.ts`
Expected: FAIL（policyStore 模組不存在 / 表不存在）

- [ ] **Step 5: 實作 policyStore.ts（型別 + seed + bump）**

```ts
// Spec 2026-07-11 policyset-coa-persistence. Append-only versioned policy persistence.
// This module is the ONLY writer of policy_sets / coa_mapping_sets / accounts seed rows.
import { z } from 'zod';
import type { Db } from './db.js';
import { DEMO_POLICY_SET, DEMO_COA_RULES, type CoaRule } from '../http/policyConstants.js';

// §9.1 ten policy fields + the 6 version dims + engine's roundingThresholdMinor.
// Superset of the engine's ResolvedPolicySet: the engine consumes a subset (Task 2 loader);
// the §9.1-only fields (accountingStandard, stablecoinTreatment, …) are persisted for the
// upcoming revaluation/close sub-projects and exposed read-only via GET /policy/active.
export const PolicyDocSchema = z.object({
  accountingStandard: z.enum(['IFRS', 'US_GAAP']),
  functionalCurrency: z.string().min(1),
  reportingCurrency: z.string().min(1),
  costBasisMethod: z.enum(['FIFO', 'WAC']),
  stablecoinTreatment: z.enum(['FINANCIAL_ASSET_IFRS9', 'INTANGIBLE_ASSET', 'CASH_EQUIVALENT']),
  cryptoClassificationDefault: z.string().min(1),
  stakingIncomePolicy: z.enum(['OPERATING_REVENUE', 'OTHER_INCOME']),
  feeExpensePolicy: z.enum(['EXPENSE_IMMEDIATE', 'CAPITALIZE_TO_ASSET']),
  revaluationPolicy: z.enum(['cost', 'revaluation']),
  asu202308Applies: z.record(z.string(), z.boolean()),
  policySetVersion: z.string().min(1),
  assetPolicyVersion: z.string().min(1),
  eventPolicyVersion: z.string().min(1),
  ruleVersion: z.string().min(1),
  parserVersion: z.string().min(1),
  normalizationVersion: z.string().min(1),
  roundingThresholdMinor: z.string().regex(/^\d+$/),
}).strict();
export type PolicyDoc = z.infer<typeof PolicyDocSchema>;

// Seed doc = the demo constant's 6 version dims verbatim + §9.1 values matching TODAY's
// hardwired engine behaviour (buildRuleInput.ts pins INTANGIBLE_IAS38_COST / IAS38_COST,
// i.e. IFRS cost track). These are policy DEFAULTS, editable via PATCH (Task 4).
export const SEED_POLICY_DOC: PolicyDoc = {
  accountingStandard: 'IFRS',
  functionalCurrency: DEMO_POLICY_SET.functionalCurrency,
  reportingCurrency: 'USD',
  costBasisMethod: DEMO_POLICY_SET.costBasisMethod,
  stablecoinTreatment: 'FINANCIAL_ASSET_IFRS9',
  cryptoClassificationDefault: 'INTANGIBLE_IAS38_COST',
  stakingIncomePolicy: 'OTHER_INCOME',
  feeExpensePolicy: 'EXPENSE_IMMEDIATE',
  revaluationPolicy: 'cost',
  asu202308Applies: {},
  policySetVersion: DEMO_POLICY_SET.policySetVersion,
  assetPolicyVersion: DEMO_POLICY_SET.assetPolicyVersion,
  eventPolicyVersion: DEMO_POLICY_SET.eventPolicyVersion,
  ruleVersion: DEMO_POLICY_SET.ruleVersion,
  parserVersion: DEMO_POLICY_SET.parserVersion,
  normalizationVersion: DEMO_POLICY_SET.normalizationVersion,
  roundingThresholdMinor: DEMO_POLICY_SET.roundingThresholdMinor,
};

// §10.3 seed list: 7 legacy (in DEMO_COA_RULES today) + 8 new MVP + 1 reserved P1.
export const ACCOUNT_SEED: Array<{ name: string; class: 'asset' | 'liability' | 'equity' | 'income' | 'expense'; sourceSection: string; status: 'active' | 'reserved_p1' }> = [
  { name: 'DigitalAssets',            class: 'asset',     sourceSection: '§10.3', status: 'active' },
  { name: 'AccountsReceivable',       class: 'asset',     sourceSection: '§10.3', status: 'active' },
  { name: 'AccountsPayable',          class: 'liability', sourceSection: '§10.3', status: 'active' },
  { name: 'DisposalGain',             class: 'income',    sourceSection: '§10.3', status: 'active' },
  { name: 'DisposalLoss',             class: 'expense',   sourceSection: '§10.3', status: 'active' },
  { name: 'GasFeeExpense',            class: 'expense',   sourceSection: '§10.3', status: 'active' },
  { name: 'OpeningBalanceEquity',     class: 'equity',    sourceSection: '§7.3',  status: 'active' },
  { name: 'StakingIncome',            class: 'income',    sourceSection: '§4.1.1', status: 'active' },
  { name: 'RoundingDifference',       class: 'expense',   sourceSection: '§4.0',  status: 'active' },
  { name: 'UnrealizedGainCryptoPnL',  class: 'income',    sourceSection: '§5.1',  status: 'active' },
  { name: 'UnrealizedLossCryptoPnL',  class: 'expense',   sourceSection: '§5.1',  status: 'active' },
  { name: 'ImpairmentLoss',           class: 'expense',   sourceSection: '§5.2',  status: 'active' },
  { name: 'ImpairmentReversalGain',   class: 'income',    sourceSection: '§5.2',  status: 'active' },
  { name: 'GasRebateIncome',          class: 'income',    sourceSection: '§4.4.1', status: 'active' },
  { name: 'RetainedEarnings',         class: 'equity',    sourceSection: '§7.3',  status: 'active' },
  { name: 'RevaluationSurplus',       class: 'equity',    sourceSection: '§5.3',  status: 'reserved_p1' },
];

// Server-computed version bump (spec §4 V1/V2): trailing integer increments; a version
// string with no trailing integer gets '-2' appended. Clients never supply versions.
export function bumpVersion(v: string): string {
  const m = /^(.*?)(\d+)$/.exec(v);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${v}-2`;
}

// Idempotent: seeds version 1 + accounts for every entity that has none yet. Runs at
// every openDb (fresh DBs, legacy DBs, and entities inserted before this feature).
// Entities inserted AFTER boot are seeded by insertEntity's caller path re-running this
// (cheap: one SELECT per entity when already seeded).
export function ensurePolicySeed(db: Db): void {
  const entities = db.prepare('SELECT id FROM entities').all() as Array<{ id: string }>;
  const now = new Date().toISOString();
  const insPs = db.prepare('INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by) VALUES (?, 1, ?, ?, ?)');
  const insCoa = db.prepare('INSERT INTO coa_mapping_sets (entity_id, version, rules, rule_version, created_at, created_by) VALUES (?, 1, ?, ?, ?, ?)');
  const insAcct = db.prepare('INSERT OR IGNORE INTO accounts (entity_id, name, class, source_section, status) VALUES (?, ?, ?, ?, ?)');
  const hasPs = db.prepare('SELECT 1 FROM policy_sets WHERE entity_id = ? LIMIT 1');
  const hasCoa = db.prepare('SELECT 1 FROM coa_mapping_sets WHERE entity_id = ? LIMIT 1');
  const seedAll = db.transaction(() => {
    for (const { id } of entities) {
      if (!hasPs.get(id)) insPs.run(id, JSON.stringify(SEED_POLICY_DOC), now, 'seed');
      if (!hasCoa.get(id)) insCoa.run(id, JSON.stringify(DEMO_COA_RULES), SEED_POLICY_DOC.ruleVersion, now, 'seed');
      for (const a of ACCOUNT_SEED) insAcct.run(id, a.name, a.class, a.sourceSection, a.status);
    }
  });
  seedAll();
}
```

- [ ] **Step 6: db.ts 的 openDb 尾端接上 seed**（`backfillPeriodIds(db)` 之後、`return db` 之前）

```ts
  ensurePolicySeed(db);
```

import 放檔頭：`import { ensurePolicySeed } from './policyStore';`（依 db.ts 現有無 `.js` 副檔名慣例，見 `./backfillPeriod`）。

**循環 import 注意**：policyStore import `policyConstants`（http 層）→ policyConstants 只 import rules-engine 型別，無回路，安全。

- [ ] **Step 7: 跑測試確認 pass + 全套綠（byte-identical 紅線第一驗）**

Run: `cd services/api && npx vitest run`
Expected: 新 test 全 PASS；既有全套原樣綠（openDb 多建 4 表 + seed，不動任何既有行為）。

- [ ] **Step 8: root typecheck + commit**

```bash
npm run typecheck
git add services/api/src/store/schema.sql services/api/src/store/db.ts services/api/src/store/policyStore.ts services/api/test/policyStore.test.ts
git commit -m "feat(policy): versioned policy/coa/accounts/change_log tables + seed v1 from demo constants"
```

---

### Task 2: active loader（fail-loud 讀路徑）+ 髒資料 monkey tests

**Files:**
- Modify: `services/api/src/store/policyStore.ts`
- Test: `services/api/test/policyStore.load.test.ts`

**Interfaces:**
- Produces:
  - `class PolicyPersistenceError extends Error { code: 'POLICY_MISSING' | 'POLICY_CORRUPT' }`
  - `getActivePolicy(db: Db, entityId: string): { version: number; doc: PolicyDoc }`
  - `getActiveCoaMapping(db: Db, entityId: string): { version: number; ruleVersion: string; rules: CoaRule[] }`
  - `toResolvedPolicySet(doc: PolicyDoc, periodOpen: boolean): ResolvedPolicySet`
  - `buildCoaMappingFromRules(rules: CoaRule[]): CoaMapping`
- Consumes: Task 1 全部；`resolveCoa`（policyConstants）；`ResolvedPolicySet`/`CoaMapping`（`../deps/rulesEngine.js`）

- [ ] **Step 1: 寫 failing test**

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.js';
import {
  getActivePolicy, getActiveCoaMapping, toResolvedPolicySet, buildCoaMappingFromRules,
  PolicyPersistenceError, SEED_POLICY_DOC,
} from '../src/store/policyStore.js';
import { DEMO_POLICY_SET, DEMO_COA_RULES } from '../src/http/policyConstants.js';

function dbWithEntity() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('e1','E1','0xc','0xcap','0xp')").run();
  // openDb already ran ensurePolicySeed BEFORE the entity existed; re-run for it:
  const { ensurePolicySeed } = require('../src/store/policyStore.js') as typeof import('../src/store/policyStore.js');
  ensurePolicySeed(db);
  return db;
}

describe('policy loaders (Task 2)', () => {
  it('getActivePolicy returns the max version and a validated doc', () => {
    const db = dbWithEntity();
    const { version, doc } = getActivePolicy(db, 'e1');
    expect(version).toBe(1);
    expect(doc).toEqual(SEED_POLICY_DOC);
  });

  it('toResolvedPolicySet reproduces DEMO_POLICY_SET byte-for-byte from the seed doc', () => {
    // THE byte-identical linchpin: engine input from DB seed === engine input from constant.
    expect(toResolvedPolicySet(SEED_POLICY_DOC, true)).toEqual({ ...DEMO_POLICY_SET, periodOpen: true });
    expect(toResolvedPolicySet(SEED_POLICY_DOC, false)).toEqual({ ...DEMO_POLICY_SET, periodOpen: false });
  });

  it('buildCoaMappingFromRules resolves like the legacy mapping (incl. catch-all and miss→null)', () => {
    const m = buildCoaMappingFromRules(DEMO_COA_RULES);
    expect(m.resolve({ eventType: 'GAS_FEE' as never, leg: 'NETWORK_FEE', coinType: '0x2::sui::SUI' })).toBe('GasFeeExpense');
    expect(m.resolve({ eventType: 'INTERNAL_TRANSFER' as never, leg: 'WALLET:0xabc', coinType: '0x2::sui::SUI' })).toBe('DigitalAssets');
    expect(m.resolve({ eventType: 'GAS_FEE' as never, leg: 'NO_SUCH_LEG', coinType: '0x2::sui::SUI' })).toBeNull();
  });

  it('POLICY_MISSING: entity without rows fails loud, never falls back to constants', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO entities (id, display_name, chain_object_id, cap_object_id, original_package_id) VALUES ('ghost','G','0xc','0xcap','0xp')").run();
    // deliberately NOT re-running ensurePolicySeed
    expect(() => getActivePolicy(db, 'ghost')).toThrowError(PolicyPersistenceError);
    try { getActivePolicy(db, 'ghost'); } catch (e) { expect((e as PolicyPersistenceError).code).toBe('POLICY_MISSING'); }
  });

  // Monkey tests (test.md): raw-SQLite dirty payloads must fail loud, not be swallowed.
  it('POLICY_CORRUPT: unknown enum value in doc fails loud', () => {
    const db = dbWithEntity();
    db.prepare("INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by) VALUES ('e1', 2, ?, 't', 'monkey')")
      .run(JSON.stringify({ ...SEED_POLICY_DOC, costBasisMethod: 'LIFO' }));
    try { getActivePolicy(db, 'e1'); expect.unreachable('should throw'); }
    catch (e) { expect((e as PolicyPersistenceError).code).toBe('POLICY_CORRUPT'); }
  });

  it('POLICY_CORRUPT: missing field / non-JSON doc / non-array rules all fail loud', () => {
    const db = dbWithEntity();
    const { policySetVersion: _drop, ...missingField } = SEED_POLICY_DOC;
    db.prepare("INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by) VALUES ('e1', 2, ?, 't', 'monkey')").run(JSON.stringify(missingField));
    expect(() => getActivePolicy(db, 'e1')).toThrowError(PolicyPersistenceError);
    db.prepare("INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by) VALUES ('e1', 3, 'not-json', 't', 'monkey')").run();
    expect(() => getActivePolicy(db, 'e1')).toThrowError(PolicyPersistenceError);
    db.prepare("INSERT INTO coa_mapping_sets (entity_id, version, rules, rule_version, created_at, created_by) VALUES ('e1', 2, ?, 'demo-rule-1', 't', 'monkey')").run(JSON.stringify({ not: 'an array' }));
    expect(() => getActiveCoaMapping(db, 'e1')).toThrowError(PolicyPersistenceError);
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd services/api && npx vitest run test/policyStore.load.test.ts`
Expected: FAIL（loader 函式未定義）

- [ ] **Step 3: 實作 loaders（附加到 policyStore.ts）**

```ts
import type { ResolvedPolicySet, CoaMapping } from '../deps/rulesEngine.js';
import { resolveCoa } from '../http/policyConstants.js';

export class PolicyPersistenceError extends Error {
  constructor(public readonly code: 'POLICY_MISSING' | 'POLICY_CORRUPT', message: string) {
    super(message);
    this.name = 'PolicyPersistenceError';
  }
}

const CoaRulesSchema = z.array(z.object({
  eventType: z.string().min(1), leg: z.string().min(1), account: z.string().min(1),
}).strict()).nonempty();

export function getActivePolicy(db: Db, entityId: string): { version: number; doc: PolicyDoc } {
  const row = db.prepare(
    'SELECT version, doc FROM policy_sets WHERE entity_id = ? ORDER BY version DESC LIMIT 1',
  ).get(entityId) as { version: number; doc: string } | undefined;
  if (!row) throw new PolicyPersistenceError('POLICY_MISSING', `no policy_sets row for entity ${entityId}; seed missing`);
  let parsed: unknown;
  try { parsed = JSON.parse(row.doc); } catch {
    throw new PolicyPersistenceError('POLICY_CORRUPT', `policy_sets v${row.version} for ${entityId}: doc is not JSON`);
  }
  const v = PolicyDocSchema.safeParse(parsed);
  if (!v.success) throw new PolicyPersistenceError('POLICY_CORRUPT', `policy_sets v${row.version} for ${entityId}: ${v.error.message}`);
  return { version: row.version, doc: v.data };
}

export function getActiveCoaMapping(db: Db, entityId: string): { version: number; ruleVersion: string; rules: CoaRule[] } {
  const row = db.prepare(
    'SELECT version, rules, rule_version FROM coa_mapping_sets WHERE entity_id = ? ORDER BY version DESC LIMIT 1',
  ).get(entityId) as { version: number; rules: string; rule_version: string } | undefined;
  if (!row) throw new PolicyPersistenceError('POLICY_MISSING', `no coa_mapping_sets row for entity ${entityId}; seed missing`);
  let parsed: unknown;
  try { parsed = JSON.parse(row.rules); } catch {
    throw new PolicyPersistenceError('POLICY_CORRUPT', `coa_mapping_sets v${row.version} for ${entityId}: rules is not JSON`);
  }
  const v = CoaRulesSchema.safeParse(parsed);
  if (!v.success) throw new PolicyPersistenceError('POLICY_CORRUPT', `coa_mapping_sets v${row.version} for ${entityId}: ${v.error.message}`);
  return { version: row.version, ruleVersion: row.rule_version, rules: v.data };
}

// Engine consumes a SUBSET of the doc (ResolvedPolicySet). §9.1-only fields ride along in
// the doc for later sub-projects; costBasisMethod narrows to 'FIFO' because the engine
// type pins it — 'WAC' docs are storable (P1) but not yet executable.
export function toResolvedPolicySet(doc: PolicyDoc, periodOpen: boolean): ResolvedPolicySet {
  if (doc.costBasisMethod !== 'FIFO') {
    throw new PolicyPersistenceError('POLICY_CORRUPT', `costBasisMethod ${doc.costBasisMethod} not executable in MVP (engine pins FIFO)`);
  }
  return {
    policySetVersion: doc.policySetVersion, assetPolicyVersion: doc.assetPolicyVersion,
    eventPolicyVersion: doc.eventPolicyVersion, ruleVersion: doc.ruleVersion,
    parserVersion: doc.parserVersion, normalizationVersion: doc.normalizationVersion,
    costBasisMethod: doc.costBasisMethod, functionalCurrency: doc.functionalCurrency,
    roundingThresholdMinor: doc.roundingThresholdMinor, periodOpen,
  };
}

export function buildCoaMappingFromRules(rules: CoaRule[]): CoaMapping {
  return { resolve: ({ eventType, leg }) => resolveCoa({ eventType: eventType as unknown as string, leg }, rules) };
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `cd services/api && npx vitest run test/policyStore.load.test.ts test/policyStore.test.ts`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add services/api/src/store/policyStore.ts services/api/test/policyStore.load.test.ts
git commit -m "feat(policy): fail-loud active policy/coa loaders with zod-validated docs"
```

---

### Task 3: 讀路徑切換（routes / buildRuleInput / triage / JE 版本欄）

**Files:**
- Modify: `services/api/src/http/buildRuleInput.ts`
- Modify: `services/api/src/http/routes.ts`（`GET /policy/active`、run-rules handler、error mapper、lot movement `policySetVersion`）
- Modify: `services/api/src/store/journalStore.ts`（JournalRow + INSERT 兩欄）
- Modify: `services/api/src/triage/agent.ts`（prompt 改吃 DB rules）
- Test: `services/api/test/policyRoute.test.ts`（改）、`services/api/test/runRules.policyVersion.test.ts`（新）

**Interfaces:**
- Consumes: Task 2 loaders。
- Produces:
  - `buildRuleInput(event, opts: { periodId: string; periodOpen: boolean; lots: PositionLot[]; policySet: ResolvedPolicySet; coaMapping: CoaMapping }): RuleInput`（**簽名變更**：呼叫端負責載入，per-request 一次）
  - `JournalRow` 增 `policySetVersion?: string | null; ruleVersion?: string | null`
  - `GET /policy/active?entity=<id>` response 增 `policyDoc`（完整 doc）、`policyVersion`、`coaVersion`（additive；舊欄位形狀不變）
- 完成後 **routes.ts / buildRuleInput.ts / agent.ts 不再 import `DEMO_POLICY_SET` / `DEMO_COA_RULES` / `buildCoaMapping`**（grep 驗證）；`policyConstants.ts` 僅剩 policyStore（seed）與測試引用。

- [ ] **Step 1: 寫 failing test（runRules.policyVersion.test.ts）**——證明 JE row 落版本欄。測試骨架仿 `policyRoute.test.ts` 的 app 組裝（openDb(':memory:') + registerRoutes + stubClient），seed 一個 entity + 一筆 APPROVED `GAS_FEE` event（fixture 形狀抄 `runRules.lots.test.ts` 的 gas event helper），打 `POST /entities/:id/run-rules`，然後：

```ts
    const row = db.prepare('SELECT policy_set_version, rule_version FROM journal_entries LIMIT 1').get() as { policy_set_version: string; rule_version: string };
    expect(row.policy_set_version).toBe('demo-ps-1');
    expect(row.rule_version).toBe('demo-rule-1');
```

並在 `policyRoute.test.ts` 加一個斷言（既有 describe 內）：

```ts
  it('exposes the persisted doc and versions (additive fields)', async () => {
    const res = await app.inject({ method: 'GET', url: '/policy/active' });
    const body = res.json();
    expect(body.policyVersion).toBe(1);
    expect(body.coaVersion).toBe(1);
    expect(body.policyDoc.accountingStandard).toBe('IFRS');
    expect(body.policySet).toEqual(expect.objectContaining({ policySetVersion: 'demo-ps-1' })); // legacy shape intact
  });
```

**注意**：policyRoute.test 的 beforeEach 用 `openDb(':memory:')` 後才插 entity（`cfg.ENTITY_ID='acme:pilot-001'`）。查該測試現有 entity 建立方式；若 entity 是 route 層 seed（`seed.ts`）建立，`ensurePolicySeed` 已涵蓋；否則在測試 beforeEach 插 entity 後補呼叫 `ensurePolicySeed(db)`。

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd services/api && npx vitest run test/runRules.policyVersion.test.ts test/policyRoute.test.ts`
Expected: FAIL（欄位 NULL / response 無新欄位）

- [ ] **Step 3: journalStore.ts 加兩欄**

```ts
export interface JournalRow {
  id: string; entityId: string; eventId: string; jeJson: string; idempotencyKey: string; leafHash: string; periodId?: string | null;
  policySetVersion?: string | null; ruleVersion?: string | null;
}
```

INSERT 改為：

```ts
    .prepare('INSERT OR IGNORE INTO journal_entries (id, entity_id, event_id, je_json, idempotency_key, leaf_hash, period_id, policy_set_version, rule_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.entityId, r.eventId, r.jeJson, r.idempotencyKey, r.leafHash, r.periodId, r.policySetVersion ?? null, r.ruleVersion ?? null);
```

- [ ] **Step 4: buildRuleInput.ts 簽名改（呼叫端注入 policy）**

```ts
import type {
  RuleInput, NormalizedEvent, RunContext, ResolvedPolicySet, ClassificationAssessment,
  PositionLot, PricePoint, FxRate, CoaMapping,
} from '../deps/rulesEngine.js';
// DEMO_POLICY_SET / buildCoaMapping imports DELETED — policy now arrives from the DB
// loader via opts (loaded once per request by the caller; spec §5 read-path switchover).

export function buildRuleInput(
  event: EventRow,
  opts: { periodId: string; periodOpen: boolean; lots: PositionLot[]; policySet: ResolvedPolicySet; coaMapping: CoaMapping },
): RuleInput {
```

函式體內原兩行改為：

```ts
  const policySet: ResolvedPolicySet = { ...opts.policySet, periodOpen: opts.periodOpen };
  const coaMapping = opts.coaMapping;
```

- [ ] **Step 5: routes.ts 切換**（import 改 `policyStore`，刪 policyConstants import）

(a) run-rules handler：`requireEntity` 後、candidates 前載一次：

```ts
    const activePolicy = getActivePolicy(db, req.params.id);
    const activeCoa = getActiveCoaMapping(db, req.params.id);
    const enginePolicy = toResolvedPolicySet(activePolicy.doc, periodOpen);
    const engineCoa = buildCoaMappingFromRules(activeCoa.rules);
```

loop 內 evaluate 改：

```ts
      const output = evaluate(buildRuleInput(ev, { periodId, periodOpen, lots: lotsForEvent(db, ev), policySet: enginePolicy, coaMapping: engineCoa }));
```

insertJournalEntry 呼叫（routes.ts:546 區塊）加兩欄：

```ts
            periodId: ev.periodId, // inherit from source event (spec §5.2.4)
            policySetVersion: activePolicy.doc.policySetVersion,
            ruleVersion: activePolicy.doc.ruleVersion,
```

lot movement 區塊（routes.ts:572）：`policySetVersion: DEMO_POLICY_SET.policySetVersion` → `policySetVersion: activePolicy.doc.policySetVersion`。

(b) `GET /policy/active`（routes.ts:241-246）改：

```ts
  // GET /policy/active — persisted policy (spec §5). ?entity falls back to the configured
  // demo entity (mirrors DEFAULT_PERIOD's known laxness — single-entity MVP; the WRITE
  // endpoints in Tasks 4-5 require an explicit entity, hard 400).
  app.get<{ Querystring: { entity?: string } }>('/policy/active', async (req) => {
    const entityId = req.query.entity ?? cfg.ENTITY_ID;
    requireEntity(db, entityId);
    const { version: policyVersion, doc } = getActivePolicy(db, entityId);
    const { version: coaVersion, ruleVersion, rules } = getActiveCoaMapping(db, entityId);
    return {
      policySet: toResolvedPolicySet(doc, true),          // legacy DTO shape (periodOpen was always true here)
      coaMapping: { rules, defaultAccount: null, version: coaVersion, ruleVersion },
      periodId: DEFAULT_PERIOD,
      policyDoc: doc, policyVersion,                       // additive: full §9.1 doc + table versions
    };
  });
```

（`cfg.ENTITY_ID` 欄位名以 `services/api/src/config.ts` 實際輸出為準——policyRoute.test 傳 `ENTITY_ID: 'acme:pilot-001'`，config 可能轉小寫駝峰；實作時 grep `entityId` in config.ts 確認。）

(c) error mapper（routes.ts:230 附近的 fastify setErrorHandler）加：

```ts
    if (err instanceof PolicyPersistenceError) {
      return reply.code(503).send(toEnvelope(err.code, err.message));
    }
```

- [ ] **Step 6: triage/agent.ts prompt 改吃 DB**

`buildTriagePrompt(ex, rawJson, fewshot)` 加第四參數 `coaRules: CoaRule[]`，行 89 改：

```ts
    `Chart-of-accounts mappings (context): ${JSON.stringify(coaRules).slice(0, 4000)}`,
```

呼叫端（`runTriageOnce` 內）在載 exception 迴圈前：

```ts
  const coaRules = getActiveCoaMapping(db, entityId).rules;
```

並把 `coaRules` 傳進 `buildTriagePrompt`。刪 `DEMO_COA_RULES` import。

- [ ] **Step 7: scripts 同步**——`services/api/scripts/scenarios/pipeline.ts`、`services/api/scripts/demo-e2e.ts` 若呼叫 `buildRuleInput` 或 import 常數：呼叫端補 loader 三行（同 Step 5a 模式，其 db 皆過 openDb → 已 seed）。以 `grep -n "buildRuleInput\|DEMO_POLICY_SET\|buildCoaMapping" services/api/scripts -r` 找齊，逐一修。

- [ ] **Step 8: 全套跑綠（byte-identical 紅線主驗）**

Run: `cd services/api && npx vitest run && npm run typecheck --workspaces=false`（root：`npm run typecheck`）
Expected: 全 PASS。特別注意 `aiPipeline.test.ts`（snapshot root 斷言）必須原樣綠——loader 供給的 `ResolvedPolicySet` 與常數 byte-identical（Task 2 linchpin test 已證），JE json/leaf hash 不變。
再 grep 驗收：`grep -rn "DEMO_POLICY_SET\|DEMO_COA_RULES\|buildCoaMapping()" services/api/src` 只剩 `policyStore.ts`。

- [ ] **Step 9: Commit**

```bash
git add services/api/src/http/buildRuleInput.ts services/api/src/http/routes.ts services/api/src/store/journalStore.ts services/api/src/triage/agent.ts services/api/test/policyRoute.test.ts services/api/test/runRules.policyVersion.test.ts services/api/scripts/scenarios/pipeline.ts services/api/scripts/demo-e2e.ts
git commit -m "feat(policy): read path switches to persisted policy; JE rows stamp policy/rule versions"
```

---

### Task 4: change_log store + `PATCH /policy/policy-set`

**Files:**
- Create: `services/api/src/store/changeLogStore.ts`
- Modify: `services/api/src/store/policyStore.ts`（加 `insertPolicyVersion`）
- Modify: `services/api/src/http/routes.ts`（新端點）
- Test: `services/api/test/policyWrite.policySet.test.ts`

**Interfaces:**
- Produces:
  - `appendChange(db, c: { entityId: string; actor: string; objectType: 'policy_set' | 'mapping_rule'; objectRef: string; before: string | null; after: string; reason: string }): void`（`at` 由函式內 `new Date().toISOString()`）
  - `listChanges(db, entityId: string): ChangeRow[]`（`SELECT * … ORDER BY seq DESC`）
  - `insertPolicyVersion(db, entityId: string, doc: PolicyDoc, createdBy: string): number`（回傳新 version；內部 `MAX(version)+1`）
  - `PATCH /policy/policy-set` body：`{ entity: string; actor: string; reason: string; changes: Partial<EditablePolicyFields> }`
- Consumes: Task 1/2。

**可編輯欄位（zod）**：`accountingStandard`、`costBasisMethod`、`stablecoinTreatment`、`cryptoClassificationDefault`、`stakingIncomePolicy`、`feeExpensePolicy`、`revaluationPolicy`、`asu202308Applies`、`roundingThresholdMinor`。**不可編輯**：兩個幣別（→400 `CURRENCY_LOCKED`）、六個版本維度（body schema `.strict()` 直接擋 →400）。

- [ ] **Step 1: 寫 failing test**（骨架同 policyRoute.test 的 app 組裝；entity 用 cfg 的 `acme:pilot-001` + `ensurePolicySeed`）

```ts
describe('PATCH /policy/policy-set (Task 4)', () => {
  const url = '/policy/policy-set';
  const base = { entity: 'acme:pilot-001', actor: 'controller-a', reason: 'switch to GAAP for pilot' };

  it('bumps policySetVersion, inserts version 2, appends change_log', async () => {
    const res = await app.inject({ method: 'PATCH', url, payload: { ...base, changes: { accountingStandard: 'US_GAAP' } } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.policyVersion).toBe(2);
    expect(body.policyDoc.accountingStandard).toBe('US_GAAP');
    expect(body.policyDoc.policySetVersion).toBe('demo-ps-2');       // server-computed bump
    expect(body.policyDoc.ruleVersion).toBe('demo-rule-1');          // untouched by policy-field edits
    const log = db.prepare("SELECT object_type, before, after, reason, actor FROM change_log ORDER BY seq").all() as Array<Record<string, string>>;
    expect(log).toHaveLength(1);
    expect(log[0].object_type).toBe('policy_set');
    expect(JSON.parse(log[0].before!).accountingStandard).toBe('IFRS');
    expect(JSON.parse(log[0].after).accountingStandard).toBe('US_GAAP');
    expect(log[0].reason).toBe(base.reason);
  });

  it('409 NO_CHANGE when the merged doc equals the active doc', async () => {
    const res = await app.inject({ method: 'PATCH', url, payload: { ...base, changes: { accountingStandard: 'IFRS' } } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_CHANGE');
    expect((db.prepare('SELECT COUNT(*) AS n FROM policy_sets').get() as { n: number }).n).toBe(1); // no version bloat
  });

  it('400s: empty reason / unknown field / currency change / bad enum / missing entity', async () => {
    for (const payload of [
      { ...base, reason: '  ', changes: { accountingStandard: 'US_GAAP' } },
      { ...base, changes: { policySetVersion: 'hax-1' } },              // version fields not editable (.strict())
      { ...base, changes: { functionalCurrency: 'TWD' } },              // CURRENCY_LOCKED
      { ...base, changes: { costBasisMethod: 'LIFO' } },
      { entity: '', actor: 'a', reason: 'r', changes: { accountingStandard: 'US_GAAP' } },
    ]) {
      const res = await app.inject({ method: 'PATCH', url, payload });
      expect([400, 404]).toContain(res.statusCode);
    }
    expect((db.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number }).n).toBe(0);
  });
});
```

（`functionalCurrency` 在 changes schema 內宣告為 `z.never()` 不可行——zod `.strict()` 擋未列 key 即可，但要**專屬錯誤碼**就把兩幣別列進 schema 再手動 reject：見 Step 3。測試預期 `CURRENCY_LOCKED` 走 400。）

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd services/api && npx vitest run test/policyWrite.policySet.test.ts`
Expected: FAIL（404 route not found）

- [ ] **Step 3: 實作**

`changeLogStore.ts`：

```ts
// Spec §3.4 / D19: append-only change log. This module offers INSERT and SELECT only —
// no update/delete path exists anywhere in code (SQLite can't hard-forbid; P1 may add triggers).
import type { Db } from './db.js';

export interface ChangeRow {
  seq: number; entityId: string; actor: string; at: string;
  objectType: string; objectRef: string; before: string | null; after: string; reason: string;
}

export function appendChange(db: Db, c: Omit<ChangeRow, 'seq' | 'at'>): void {
  db.prepare(
    'INSERT INTO change_log (entity_id, actor, at, object_type, object_ref, before, after, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(c.entityId, c.actor, new Date().toISOString(), c.objectType, c.objectRef, c.before, c.after, c.reason);
}

export function listChanges(db: Db, entityId: string): ChangeRow[] {
  return (db.prepare(
    'SELECT seq, entity_id AS entityId, actor, at, object_type AS objectType, object_ref AS objectRef, before, after, reason FROM change_log WHERE entity_id = ? ORDER BY seq DESC',
  ).all(entityId)) as ChangeRow[];
}
```

`policyStore.ts` 加：

```ts
export function insertPolicyVersion(db: Db, entityId: string, doc: PolicyDoc, createdBy: string): number {
  const cur = db.prepare('SELECT MAX(version) AS v FROM policy_sets WHERE entity_id = ?').get(entityId) as { v: number | null };
  const next = (cur.v ?? 0) + 1;
  db.prepare('INSERT INTO policy_sets (entity_id, version, doc, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(entityId, next, JSON.stringify(PolicyDocSchema.parse(doc)), new Date().toISOString(), createdBy);
  return next;
}
```

routes.ts 端點（放 `GET /policy/active` 之後；包進與 snapshot 同款 `mutex.run('policy-write', …)`——key 固定字串即可序列化所有 policy 寫入）：

```ts
  const PatchPolicyBody = z.object({
    entity: z.string().min(1), actor: z.string().min(1),
    reason: z.string().trim().min(1),
    changes: z.object({
      accountingStandard: z.enum(['IFRS', 'US_GAAP']).optional(),
      costBasisMethod: z.enum(['FIFO', 'WAC']).optional(),
      stablecoinTreatment: z.enum(['FINANCIAL_ASSET_IFRS9', 'INTANGIBLE_ASSET', 'CASH_EQUIVALENT']).optional(),
      cryptoClassificationDefault: z.string().min(1).optional(),
      stakingIncomePolicy: z.enum(['OPERATING_REVENUE', 'OTHER_INCOME']).optional(),
      feeExpensePolicy: z.enum(['EXPENSE_IMMEDIATE', 'CAPITALIZE_TO_ASSET']).optional(),
      revaluationPolicy: z.enum(['cost', 'revaluation']).optional(),
      asu202308Applies: z.record(z.string(), z.boolean()).optional(),
      roundingThresholdMinor: z.string().regex(/^\d+$/).optional(),
      functionalCurrency: z.string().optional(),   // listed to give CURRENCY_LOCKED its own error
      reportingCurrency: z.string().optional(),
    }).strict(),
  }).strict();

  app.patch('/policy/policy-set', async (req, reply) => {
    const p = PatchPolicyBody.safeParse(req.body);
    if (!p.success) throw new ApiError(400, 'VALIDATION', p.error.message);
    const { entity, actor, reason, changes } = p.data;
    requireEntity(db, entity);
    if (changes.functionalCurrency !== undefined || changes.reportingCurrency !== undefined) {
      throw new ApiError(400, 'CURRENCY_LOCKED', 'functional/reporting currency is USD-locked in MVP (spec §1.3)');
    }
    return mutex.run('policy-write', async () => {
      const { doc: before } = getActivePolicy(db, entity);
      const merged: PolicyDoc = { ...before, ...changes };
      if (JSON.stringify(merged) === JSON.stringify(before)) {
        throw new ApiError(409, 'NO_CHANGE', 'no effective change to the active policy set');
      }
      merged.policySetVersion = bumpVersion(before.policySetVersion);   // V2 invariant
      let newVersion = 0;
      const txn = db.transaction(() => {
        newVersion = insertPolicyVersion(db, entity, merged, actor);
        appendChange(db, {
          entityId: entity, actor, objectType: 'policy_set',
          objectRef: `policy_sets:${entity}:v${newVersion}`,
          before: JSON.stringify(before), after: JSON.stringify(merged), reason,
        });
      });
      txn();
      return { policyVersion: newVersion, policyDoc: merged };
    });
  });
```

（`ApiError` / `mutex` / `requireEntity` 均為 routes.ts 既有構件，直接用；`z` 若未 import 則加。）

- [ ] **Step 4: 跑測試確認 pass + 全套綠**

Run: `cd services/api && npx vitest run`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add services/api/src/store/changeLogStore.ts services/api/src/store/policyStore.ts services/api/src/http/routes.ts services/api/test/policyWrite.policySet.test.ts
git commit -m "feat(policy): PATCH /policy/policy-set — versioned edits with append-only change log"
```

---

### Task 5: `PUT /policy/coa-mapping`（V1 三合一 transaction）+ idempotency 洞封死證明

**Files:**
- Modify: `services/api/src/store/policyStore.ts`（加 `insertCoaMappingVersion`）
- Modify: `services/api/src/http/routes.ts`（新端點）
- Test: `services/api/test/policyWrite.coaMapping.test.ts`

**Interfaces:**
- Produces:
  - `insertCoaMappingVersion(db, entityId: string, rules: CoaRule[], ruleVersion: string, createdBy: string): number`
  - `PUT /policy/coa-mapping` body：`{ entity: string; actor: string; reason: string; rules: CoaRule[] }`（整份替換）
- Consumes: Task 1/2/4。

**驗證順序（fail-closed，任一失敗 400 不落任何 row）**：rules 非空陣列 → 每條 `{eventType, leg, account}` 非空字串 → `(eventType, leg)` 無重複 → 每個 `account` 存在於 `accounts` 且 `status='active'`（`reserved_p1` 不可入 mapping）→ 與 active rules JSON 相同 → 409 `NO_CHANGE`。

- [ ] **Step 1: 寫 failing test**

```ts
describe('PUT /policy/coa-mapping (Task 5)', () => {
  const url = '/policy/coa-mapping';
  const base = { entity: 'acme:pilot-001', actor: 'controller-a', reason: 'route gas to StakingIncome demo' };
  const withRuleChanged = () => {
    const rules = structuredClone(DEMO_COA_RULES);
    rules.find((r) => r.eventType === 'GAS_FEE' && r.leg === 'NETWORK_FEE')!.account = 'GasRebateIncome';
    return rules;
  };

  it('V1: one transaction bumps ruleVersion, inserts coa v2 AND policy v2, logs twice', async () => {
    const res = await app.inject({ method: 'PUT', url, payload: { ...base, rules: withRuleChanged() } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coaVersion).toBe(2);
    expect(body.ruleVersion).toBe('demo-rule-2');
    expect(body.policyVersion).toBe(2);
    const doc = JSON.parse((db.prepare("SELECT doc FROM policy_sets WHERE version=2").get() as { doc: string }).doc);
    expect(doc.ruleVersion).toBe('demo-rule-2');
    expect(doc.policySetVersion).toBe('demo-ps-1'); // policy-field identity unchanged; only the rule dim moved
    const log = db.prepare('SELECT object_type FROM change_log ORDER BY seq').all() as Array<{ object_type: string }>;
    expect(log.map((l) => l.object_type)).toEqual(['mapping_rule', 'policy_set']);
  });

  it('rejects: unknown account / reserved_p1 account / duplicate (eventType,leg) / empty rules / empty reason', async () => {
    const dup = structuredClone(DEMO_COA_RULES); dup.push({ ...dup[0] });
    const unknown = withRuleChanged(); unknown[0] = { ...unknown[0], account: 'NoSuchAccount' };
    const reserved = withRuleChanged(); reserved[0] = { ...reserved[0], account: 'RevaluationSurplus' };
    for (const payload of [
      { ...base, rules: unknown }, { ...base, rules: reserved },
      { ...base, rules: dup }, { ...base, rules: [] },
      { ...base, reason: '', rules: withRuleChanged() },
    ]) {
      const res = await app.inject({ method: 'PUT', url, payload });
      expect(res.statusCode).toBe(400);
    }
    expect((db.prepare('SELECT COUNT(*) AS n FROM coa_mapping_sets').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number }).n).toBe(0);
  });

  it('409 NO_CHANGE on identical rules', async () => {
    const res = await app.inject({ method: 'PUT', url, payload: { ...base, rules: structuredClone(DEMO_COA_RULES) } });
    expect(res.statusCode).toBe(409);
  });

  // The hole this design closes (spec §4 V1): after a mapping change, the SAME event
  // must produce a DIFFERENT idempotency key (ruleVersion is a key ingredient), so the
  // old JE and the new-rules JE can coexist instead of colliding on the corruption guard.
  it('same event re-evaluated after a mapping change yields a different idempotency key', async () => {
    // arrange: post one GAS_FEE event under v1 (reuse the run-rules fixture from Task 3's test)
    // ... seed event, POST run-rules, capture key1 = journal_entries.idempotency_key
    const key1 = (db.prepare('SELECT idempotency_key FROM journal_entries').get() as { idempotency_key: string }).idempotency_key;
    await app.inject({ method: 'PUT', url, payload: { ...base, rules: withRuleChanged() } });
    // re-approve the same event (reset status to APPROVED via eventStore) and re-run rules
    // ... POST run-rules again
    const keys = db.prepare('SELECT idempotency_key FROM journal_entries ORDER BY rowid').all() as Array<{ idempotency_key: string }>;
    expect(keys).toHaveLength(2);
    expect(keys[1].idempotency_key).not.toBe(key1);   // versions moved → key moved → no collision
  });
});
```

（最後一個 test 的 event 重跑機制：`setDecision`/UPDATE `events.status='APPROVED'` 讓它重新成為 candidate——實作時抄 `runRules.lots.test.ts` 現成 helper；重點斷言是兩把 key 不同、兩筆 JE 並存、無 corruption throw。）

- [ ] **Step 2: 跑測試確認 fail**

Run: `cd services/api && npx vitest run test/policyWrite.coaMapping.test.ts`
Expected: FAIL（404）

- [ ] **Step 3: 實作**

`policyStore.ts` 加：

```ts
export function insertCoaMappingVersion(db: Db, entityId: string, rules: CoaRule[], ruleVersion: string, createdBy: string): number {
  const cur = db.prepare('SELECT MAX(version) AS v FROM coa_mapping_sets WHERE entity_id = ?').get(entityId) as { v: number | null };
  const next = (cur.v ?? 0) + 1;
  db.prepare('INSERT INTO coa_mapping_sets (entity_id, version, rules, rule_version, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entityId, next, JSON.stringify(CoaRulesSchema.parse(rules)), ruleVersion, new Date().toISOString(), createdBy);
  return next;
}
```

（`CoaRulesSchema` 從 Task 2 的模組內常數升級為 export。）

routes.ts 端點：

```ts
  const PutCoaBody = z.object({
    entity: z.string().min(1), actor: z.string().min(1), reason: z.string().trim().min(1),
    rules: z.array(z.object({ eventType: z.string().min(1), leg: z.string().min(1), account: z.string().min(1) }).strict()).min(1),
  }).strict();

  app.put('/policy/coa-mapping', async (req) => {
    const p = PutCoaBody.safeParse(req.body);
    if (!p.success) throw new ApiError(400, 'VALIDATION', p.error.message);
    const { entity, actor, reason, rules } = p.data;
    requireEntity(db, entity);
    const seen = new Set<string>();
    for (const r of rules) {
      const k = `${r.eventType} ${r.leg}`;
      if (seen.has(k)) throw new ApiError(400, 'DUPLICATE_RULE', `duplicate (eventType, leg): ${r.eventType}/${r.leg}`);
      seen.add(k);
    }
    const active = new Set((db.prepare("SELECT name FROM accounts WHERE entity_id = ? AND status = 'active'").all(entity) as Array<{ name: string }>).map((a) => a.name));
    for (const r of rules) {
      if (!active.has(r.account)) throw new ApiError(400, 'UNKNOWN_ACCOUNT', `account not in active CoA seed: ${r.account}`);
    }
    return mutex.run('policy-write', async () => {
      const curCoa = getActiveCoaMapping(db, entity);
      if (JSON.stringify(rules) === JSON.stringify(curCoa.rules)) {
        throw new ApiError(409, 'NO_CHANGE', 'submitted rules equal the active mapping');
      }
      const { doc: beforeDoc } = getActivePolicy(db, entity);
      const newRuleVersion = bumpVersion(beforeDoc.ruleVersion);          // V1 invariant
      const newDoc: PolicyDoc = { ...beforeDoc, ruleVersion: newRuleVersion };
      let coaVersion = 0, policyVersion = 0;
      const txn = db.transaction(() => {
        coaVersion = insertCoaMappingVersion(db, entity, rules, newRuleVersion, actor);
        policyVersion = insertPolicyVersion(db, entity, newDoc, actor);
        appendChange(db, {
          entityId: entity, actor, objectType: 'mapping_rule',
          objectRef: `coa_mapping_sets:${entity}:v${coaVersion}`,
          before: JSON.stringify(curCoa.rules), after: JSON.stringify(rules), reason,
        });
        appendChange(db, {
          entityId: entity, actor, objectType: 'policy_set',
          objectRef: `policy_sets:${entity}:v${policyVersion}`,
          before: JSON.stringify(beforeDoc), after: JSON.stringify(newDoc),
          reason: `ruleVersion bump (V1 invariant) — ${reason}`,
        });
      });
      txn();
      return { coaVersion, ruleVersion: newRuleVersion, policyVersion, rules };
    });
  });
```

- [ ] **Step 4: 跑測試確認 pass + 全套綠**

Run: `cd services/api && npx vitest run`
Expected: 全 PASS（含 key-divergence 證明 test）

- [ ] **Step 5: Commit**

```bash
git add services/api/src/store/policyStore.ts services/api/src/http/routes.ts services/api/test/policyWrite.coaMapping.test.ts
git commit -m "feat(policy): PUT /policy/coa-mapping — V1 invariant (rule change bumps ruleVersion) closes idempotency collision"
```

---

### Task 6: `GET /policy/history`

**Files:**
- Modify: `services/api/src/http/routes.ts`
- Test: `services/api/test/policyHistory.test.ts`

**Interfaces:**
- Produces: `GET /policy/history?entity=<id>` → `{ changes: ChangeRow[], policyVersions: Array<{version, createdAt, createdBy}>, coaVersions: Array<{version, ruleVersion, createdAt, createdBy}> }`（changes 依 seq 倒序）
- Consumes: `listChanges`（Task 4）。entity **必填**（寫入面同規：hard 400，不用 fallback）。

- [ ] **Step 1: 寫 failing test**——做一次 PATCH + 一次 PUT 後打 history：`changes` 長度 3（1 policy_set + PUT 的 mapping_rule+policy_set）、倒序（`changes[0].seq > changes[2].seq`）、`policyVersions` 長度 3、`coaVersions` 長度 2；`GET /policy/history`（無 entity）→ 400。

- [ ] **Step 2: 跑確認 fail** → Run: `npx vitest run test/policyHistory.test.ts`，Expected: 404 FAIL

- [ ] **Step 3: 實作**

```ts
  app.get<{ Querystring: { entity?: string } }>('/policy/history', async (req) => {
    if (!req.query.entity) throw new ApiError(400, 'VALIDATION', 'entity query param is required');
    requireEntity(db, req.query.entity);
    const e = req.query.entity;
    return {
      changes: listChanges(db, e),
      policyVersions: db.prepare('SELECT version, created_at AS createdAt, created_by AS createdBy FROM policy_sets WHERE entity_id = ? ORDER BY version DESC').all(e),
      coaVersions: db.prepare('SELECT version, rule_version AS ruleVersion, created_at AS createdAt, created_by AS createdBy FROM coa_mapping_sets WHERE entity_id = ? ORDER BY version DESC').all(e),
    };
  });
```

- [ ] **Step 4: pass + commit**

```bash
cd services/api && npx vitest run
git add services/api/src/http/routes.ts services/api/test/policyHistory.test.ts
git commit -m "feat(policy): GET /policy/history — change log + version lists"
```

---

### Task 7: web API 層（types / endpoints / usePolicyData mutations）

**Files:**
- Modify: `web/src/api/types.ts`（additive DTO）
- Modify: `web/src/api/endpoints.ts`（getPolicyActive 帶 entity + 3 新函式）
- Modify: `web/src/data/usePolicyData.ts`（傳 entity、暴露 mutations）
- Test: `web/src/data/usePolicyData.test.tsx`（新；仿 `useExportData.test.tsx` 的 fetch stub 慣例）

**Interfaces:**
- Produces（types.ts additive）：

```ts
export interface PolicyDocDTO {
  accountingStandard: 'IFRS' | 'US_GAAP';
  functionalCurrency: string; reportingCurrency: string;
  costBasisMethod: 'FIFO' | 'WAC';
  stablecoinTreatment: 'FINANCIAL_ASSET_IFRS9' | 'INTANGIBLE_ASSET' | 'CASH_EQUIVALENT';
  cryptoClassificationDefault: string;
  stakingIncomePolicy: 'OPERATING_REVENUE' | 'OTHER_INCOME';
  feeExpensePolicy: 'EXPENSE_IMMEDIATE' | 'CAPITALIZE_TO_ASSET';
  revaluationPolicy: 'cost' | 'revaluation';
  asu202308Applies: Record<string, boolean>;
  policySetVersion: string; assetPolicyVersion: string; eventPolicyVersion: string;
  ruleVersion: string; parserVersion: string; normalizationVersion: string;
  roundingThresholdMinor: string;
}
export interface ChangeRowDTO {
  seq: number; entityId: string; actor: string; at: string;
  objectType: string; objectRef: string; before: string | null; after: string; reason: string;
}
export interface PolicyHistoryDTO {
  changes: ChangeRowDTO[];
  policyVersions: Array<{ version: number; createdAt: string; createdBy: string }>;
  coaVersions: Array<{ version: number; ruleVersion: string; createdAt: string; createdBy: string }>;
}
```

`PolicyActiveDTO` 增：`policyDoc: PolicyDocDTO; policyVersion: number;`，`coaMapping` 增 `version: number; ruleVersion: string;`。

- endpoints.ts：

```ts
export async function getPolicyActive(entityId?: string): Promise<PolicyActiveDTO> {
  return fetchJson<PolicyActiveDTO>(`/policy/active${entityId ? `?entity=${enc(entityId)}` : ''}`);
}
export async function patchPolicySet(body: { entity: string; actor: string; reason: string; changes: Partial<PolicyDocDTO> }): Promise<{ policyVersion: number; policyDoc: PolicyDocDTO }> {
  return fetchJson('/policy/policy-set', { method: 'PATCH', body: JSON.stringify(body) });
}
export async function putCoaMapping(body: { entity: string; actor: string; reason: string; rules: CoaRuleDTO[] }): Promise<{ coaVersion: number; ruleVersion: string; policyVersion: number; rules: CoaRuleDTO[] }> {
  return fetchJson('/policy/coa-mapping', { method: 'PUT', body: JSON.stringify(body) });
}
export async function getPolicyHistory(entityId: string): Promise<PolicyHistoryDTO> {
  return fetchJson(`/policy/history?entity=${enc(entityId)}`);
}
```

- usePolicyData：`getPolicyActive()` → `getPolicyActive(capturedEntityId)`；return 增 `applyCoaMapping`/`applyPolicyChanges` 包 mutation + 成功後 `refetch()`（沿用現有 gen guard 模式，mutation 錯誤以 throw 傳回呼叫端顯示）。

- [ ] **Step 1: 寫 failing test**（fetch stub 斷言 `?entity=` 有帶、mutation 成功觸發 refetch、mutation 失敗 throw 不吞）
- [ ] **Step 2: 跑確認 fail** → `cd web && npx vitest run src/data/usePolicyData.test.tsx`
- [ ] **Step 3: 實作上述三檔**
- [ ] **Step 4: pass + web 全套 + typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/api/endpoints.ts web/src/data/usePolicyData.ts web/src/data/usePolicyData.test.tsx
git commit -m "feat(policy-ui): web api layer for persisted policy — active(entity), patch, put, history"
```

---

### Task 8: UI 接電（PreviewPanel apply、PolicyEditForm、History）

**Files:**
- Modify: `web/src/workspaces/policy/PreviewPanel.tsx`（apply 區塊）
- Modify: `web/src/workspaces/policy/PolicyWorkspace.tsx`（wiring + 新卡片）
- Modify: `web/src/workspaces/policy/PolicySummaryCard.tsx`（顯示 version + doc 欄位）
- Create: `web/src/workspaces/policy/PolicyEditForm.tsx`
- Create: `web/src/workspaces/policy/PolicyHistoryCard.tsx`
- Modify: `web/src/workspaces/policy/policy.css`（新 class 沿現有命名慣例）
- Test: `web/src/workspaces/policy/PolicyWorkspace.test.tsx`（擴充）

**Interfaces:**
- Consumes: Task 7 的 `applyCoaMapping`/`applyPolicyChanges`/`getPolicyHistory` 與 DTO。
- Produces（component props）：
  - `PreviewPanel({ policy, journal, events, onApply }: { …既有…; onApply: (rules: CoaRuleDTO[], reason: string, actor: string) => Promise<void> })`
  - `PolicyEditForm({ doc, onApply }: { doc: PolicyDocDTO; onApply: (changes: Partial<PolicyDocDTO>, reason: string, actor: string) => Promise<void> })`
  - `PolicyHistoryCard({ entityId }: { entityId: string })`（自 fetch）

**UI 行為規格：**
- PreviewPanel：Recompute 之後才出現 apply 區（reason 必填 text input + actor input 預設 `'controller'` + `Apply to live mapping` 按鈕）。`result.conservation.balanced === false` 或有 `UNKNOWN_ACCOUNT`/`EMPTY_ACCOUNT` warning 時按鈕 disabled + title 說明。成功 → 清 result、顯示 `Applied — mapping v{n} (rule {ruleVersion})` badge；失敗 → 顯示 API error 文字（含 409 NO_CHANGE）。
- PolicyEditForm：枚舉欄下拉（值域抄 PolicyDocDTO 型別）、`functionalCurrency`/`reportingCurrency` 顯示為 disabled input + `title="USD-locked in MVP (spec §1.3)"`；六個版本欄唯讀顯示。reason/actor + Apply，成功後由 workspace refetch 帶新 doc。
- PolicyHistoryCard：載入 `getPolicyHistory(entityId)`，倒序列 `at · actor · objectType · reason`（before/after 摺疊在 `<details>`）。
- PolicyWorkspace 佈局：SummaryCard（含 version 徽章）→ PolicyEditForm → Live CoaMappingTable（title 帶 `v{coaMapping.version}`）→ PreviewPanel → PolicyHistoryCard。

- [ ] **Step 1: 寫 failing test（PolicyWorkspace.test.tsx 擴充）**——stub usePolicyData 回傳含 policyDoc 的 data：(a) render 出 `Apply to live mapping`（先 recompute）與 disabled 條件；(b) apply 成功呼叫 `applyCoaMapping` 且帶 reason；(c) reason 空時按鈕 disabled；(d) PolicyEditForm 的幣別欄 disabled。
- [ ] **Step 2: 跑確認 fail** → `cd web && npx vitest run src/workspaces/policy`
- [ ] **Step 3: 實作五個檔**（樣式沿 `policy.css` 現有 `policy-*`/`export-*` class；不引入新設計語彙——這不是 redesign）
- [ ] **Step 4: pass + build**

Run: `cd web && npx vitest run && npm run build`
Expected: 全 PASS、build 0 error

- [ ] **Step 5: Commit**

```bash
git add web/src/workspaces/policy/PreviewPanel.tsx web/src/workspaces/policy/PolicyWorkspace.tsx web/src/workspaces/policy/PolicySummaryCard.tsx web/src/workspaces/policy/PolicyEditForm.tsx web/src/workspaces/policy/PolicyHistoryCard.tsx web/src/workspaces/policy/policy.css web/src/workspaces/policy/PolicyWorkspace.test.tsx
git commit -m "feat(policy-ui): PolicyWorkspace goes live — apply mapping, edit policy fields, change history"
```

---

### Task 9: 端到端驗證（Playwright 實點擊 + 全套 + byte-identical 終驗）

**Files:**
- 無新檔（驗證 task；發現 bug 才開 fix commit）

- [ ] **Step 1: 全 workspace 測試 + typecheck**

Run（root）：`npm run typecheck && cd services/api && npx vitest run && cd ../../web && npx vitest run && npm run build`
Expected: 全綠，報數字（api n/n、web n/n）。

- [ ] **Step 2: byte-identical 終驗**——`aiPipeline.test.ts`（snapshot root 斷言）與 anchor 相關套件必須未動過斷言值而綠；`git diff main -- services/rules-engine services/anchor-svc services/snapshot-svc services/ingestion` 輸出必須為空（四個 service 零觸碰）。

- [ ] **Step 3: Playwright 實點擊**（啟服務：Tab1 `cd services/api && set -a && . ./.env && set +a && npm start`；Tab2 `cd web && npm run dev`；demo entity ACME Pilot 001）：
  1. Policy workspace 載入 → SummaryCard 顯示 version 1、CoA 表 15 條。
  2. Preview 改一條 rule → Recompute → 填 reason → Apply → badge 顯示 v2 / demo-rule-2；HistoryCard 出現兩筆 log。
  3. PolicyEditForm 改 `accountingStandard` → Apply → SummaryCard 更新；History 增一筆。
  4. 幣別欄確認 disabled。
  5. Console 0 errors；cache-bust/hard-reload 後複驗一次。

- [ ] **Step 4: 收尾 commit（若 Playwright 揪出 fix）+ 更新 `tasks/progress.md`**

---

## Self-Review 記錄

- **Spec coverage**：§3 四表+JE 欄（T1/T3）、§4 V1–V4（T1 seed byte-identical、T5 V1、T4 V2、insert-only V3、T9 V4 終驗）、§5 讀寫端點+lock 裁決（T3/T4/T5/T6）、§6 UI（T7/T8）、§7 fail-closed 表（T2 monkey、T4/T5 拒絕路徑）、§8 測試 1–7（T1/T5/T3/T4+5/T1/T9/T2 對應）。Restatement 接口 = 無 UNIQUE(event) 約束（本來就沒有，T5 key-divergence test 順帶證明並存可行）。
- **已知簡化（記錄在案）**：`GET /policy/active` 的 `?entity` fallback 到 `cfg.ENTITY_ID` 延續了 DEFAULT_PERIOD 既有的單租戶寬鬆（backlog 已有同類記錄）；寫端點與 history 一律硬 400。`ensurePolicySeed` 在 openDb 跑，runtime 新建 entity 需重呼叫（現況無 runtime entity 創建路徑，`insertEntity` 只被 seed.ts 用）。
- **Type consistency**：`PolicyDoc`/`PolicyDocDTO` 欄位一致（camelCase）；`bumpVersion`/`insertPolicyVersion`/`insertCoaMappingVersion`/`appendChange`/`listChanges` 名稱前後一致；`buildRuleInput` 新簽名在 T3 Step 4 定義、T3 Step 5/7 消費。
