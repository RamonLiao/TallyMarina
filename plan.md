# TallyMarina — Project Plan & Decisions

**更新日期**：2026-06-20

## 1. 專案目標與定位
- **專案名稱**：TallyMarina (原暫定 Sui Agentic Subledger)
- **定位**：面向財務團隊的 AI 輔助數位資產子分類帳 (Subledger)，將 Sui 鏈上活動與交易所交易，轉換為可對帳、可核准、可直接對接 ERP 的政策驅動 (IFRS/US GAAP) 分錄與審計憑證。

## 2. 核心架構與設計決策
- **雙層架構**：
  1. **Off-chain 主系統** (Postgres + Node.js/TypeScript)：處理數據接入、語意標準化、AI 預分類建議、成本計價與 GAAP 規則引擎。
  2. **On-chain 錨定合約** (`AuditAnchor` Move package)：在 Sui 上以 shared object 形式維護 Per-entity append-only 雜湊鏈，錨定每期關帳 snapshot 雜湊與 Journal Entry 的 Merkle 根，確保審計數據防竄改。
- **安全邊界**：AI 僅做分類與語意建議，無自動記帳 (posting) 權限；不保存私鑰，地址所有權驗證採 dApp Kit 簽名挑戰。

## 3. 本次子任務成果
- **已完成工作**：
  - 確認專案名稱為 `TallyMarina`。
  - 根據 `specs/business-spec-v3.md` 的核心業務邏輯，撰寫完成根目錄 [README.md](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/0-Agentic-Web/Sui-Agentic-Subledger/README.md)。
  - README 採用英式英文 (British English) 撰寫，為評審呈現清晰的 6 大 Crypto 會計痛點與對應的 TallyMarina 6 大解決方案。
  - 提供簡短的 GitHub Repository Description 供設置。
- **更動檔案**：
  - [README.md](file:///Users/ramonliao/Documents/Code/Project/Web3/Hackathon/2026_Sui_Overflow/Tracks/0-Agentic-Web/Sui-Agentic-Subledger/README.md) (新建)

## 4. 後續 TODO (未完成事項)
- [ ] 執行 `sui-developer` 相關 Move 模組開發與審計錨定合約的鏈上測試。
- [ ] 實作 off-chain Ingestion 數據同步服務骨架。
- [ ] 實作 Policy / Rules Engine 及會計分錄生成。
- [ ] 串聯鏈下關帳快照 (Snapshot Svc) 與鏈上 AuditAnchor 的調用接口。
