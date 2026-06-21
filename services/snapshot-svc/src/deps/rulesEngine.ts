// 單一跨包 import chokepoint：全 snapshot-svc 只在此引用 rules-engine。
// 透過宣告的 workspace 依賴（package.json `@subledger/rules-engine: file:../rules-engine`
// + rules-engine 的 exports map）解析，而非脆弱的相對路徑。改 alias / 改路徑只需動這一檔。
export { buildMerkle } from '@subledger/rules-engine';
export type { MerkleManifest, RuleOutput, JournalEntry, JeLine } from '@subledger/rules-engine';
