// 單一跨包 import chokepoint：全 snapshot-svc 只在此引用 rules-engine。
// 路徑變動或未來改 package alias 只需改這一檔。
export { buildMerkle } from '../../../rules-engine/src/index.js';
export type { MerkleManifest, RuleOutput, JournalEntry, JeLine } from '../../../rules-engine/src/index.js';
