# Sui Agentic Subledger 規格書盡職調查審查報告（R1）

審查對象：

- `specs/business-spec-v1.md`
- `specs/accounting-spec-v1.md`

審查立場：新創 CEO／天使投資人。判斷標準不是文件是否完整，而是產品是否有可證明的需求、可守住的差異化、可交付的 MVP、可承擔的會計責任，以及可形成正毛利的商業模式。

## 執行摘要

這兩份文件寫得比多數 hackathon 規格完整，但目前仍是「廣泛而審慎的產品構想」，不是可投資的商業規格。最大問題不是少寫功能，而是同時想做 Sui indexer、protocol parser、crypto accounting engine、valuation system、lot engine、close workflow、ERP integration、AI review、audit evidence、IFRS、US GAAP、穩定幣與 DeFi edge cases。這不是 MVP，是數個高責任產品疊在一起。

文件大量使用「由客戶／專業人士確認」降低準則責任，但產品又承諾 policy-driven JE、披露資料與 audit-ready output。若不能把準則結論落成受簽核、可測試的政策模板，免責聲明不會降低錯帳、索賠與審計失敗風險。

目前沒有可信的市場規模、競品實測、客戶訪談、LOI、付費意願、導入成本、價格區間或單位經濟。Sui-native 是切入點，不是已證明的 moat；Walrus 是 demo 亮點，不是已證明的採購理由。

投資判斷：**不投；可允許進入問題驗證／design-partner 階段，但不能以「commercial subledger」估值。**

---

## A. 致命問題（Blocker）

### A1. 沒有證明 Sui-only 痛點足以支撐一家企業軟體公司

文件沒有 Sui 生態中符合條件的法人數、每月交易量、使用 ERP／外部會計師比例、平均關帳成本、可觸達買方數或預算。L1 ICP 可能太小，L2/L3 又立即要求多鏈、CEX、銀行、ERP、法遵與企業安全能力，等於切入市場和目標市場不是同一個產品。

**必須補齊：**列出可命名的 30–50 個目標帳戶、其中至少 15 次訪談、5 份資料樣本、3 個願意做付費 parallel close 的 design partners。若做不到，停止把 Sui-native 當商業楔子。

### A2. 差異化尚未成立

「Sui parser、DeepBook、AI 建議、PolicySet、Walrus snapshot」都是功能組合，不是 moat。成熟競品可新增 Sui connector；客戶也可用既有 subledger 加客製 parser。文件沒有證明競品做不到、做得慢、成本更高，或本產品能取得排他資料／通路。

**必須補齊：**用同一組真實 Sui transactions 對至少 3 個競品與自建流程做 benchmark，量測 coverage、錯誤率、close 工時、導入時間與總成本。差異化必須是可量化結果，不是元件名稱。

### A3. MVP 實際範圍遠超團隊可驗證範圍

MVP 同時承諾 ingestion、DeepBook、AI、IFRS/US GAAP、pricing/FX、FIFO/WAC、JE、reconciliation、CSV、Walrus、RBAC、period close 與 audit lineage。任何一項做錯都會污染帳務；任何一項做成 demo 都不代表可商用。

**必須補齊：**把 MVP 收斂為「單一 entity、單一功能性貨幣、Sui wallet、4 個 event types、單一會計框架、FIFO、人工核准、generic CSV、wallet quantity recon」。US GAAP/IFRS 二選一；staking、CEX、WAC、披露、Walrus 完整包全部退出首個付費 pilot。

### A4. 會計責任邊界自相矛盾

產品聲稱不自動決定準則，但又提供「IFRS／US GAAP 基礎 PolicySet」、自動分類、衡量、JE 與 disclosure facts。這會讓客戶合理期待產品結果符合準則。把關鍵判斷標成 `[需查證]` 或交由客戶確認，不構成產品控制。

**必須補齊：**定義 RACI、會計政策簽核 artifact、模板維護責任、錯誤責任上限、專業顧問合作模式、每個 policy 的 authoritative citation、測試案例與版本生效流程。沒有 CPA／會計師正式 sign-off，不得宣稱 IFRS／US GAAP ready。

### A5. ASU 2023-08 被當成完整 US GAAP 路徑，實際只是有限 scope 的後續衡量模型

`US_GAAP_ASU_2023_08` 被設計成與 `IFRS_COST`、`IFRS_REVALUATION` 平行的 entity-level `measurement_path`，但 ASU 2023-08 只涵蓋符合條件的特定 crypto assets；同一 entity 必然可能同時持有 in-scope、out-of-scope、stablecoin claim、CEX claim、receivable、LP/receipt token。單一 PolicySet measurement path 無法正確表達。

**必須補齊：**將準則框架與資產衡量模型拆開：`accounting_standard = US_GAAP`，再於 asset/book 層設定 scope 與模型。定義 out-of-scope routing，禁止整個 entity 套用 ASU 路徑。

### A6. 穩定幣沒有可執行的分類與持續監控模型

文件知道不能只看 peg，但仍只列問卷與 `stablecoin_treatment`。缺少法律意見有效期、發行人／贖回條款版本、持有人資格、司法管轄區、直接／間接贖回權、限制、信用風險、depeg 後重分類與 ECL／減損 routing。這不足以驅動 JE。

**必須補齊：**建立 issuer-instrument-jurisdiction-policy 四層主檔、法律文件證據、assessment expiry、觸發事件與人工重評流程；不同 stablecoin 不得共用單一 treatment。

### A7. 沒有可靠資料完整性證明，就不能叫 subledger

`Ingestion completeness = received / source records` 是循環定義：若來源 API 漏資料，系統不知道 denominator。Sui address、object changes、events、balance changes、checkpoint、CEX corrections 的完整性證明未定義。

**必須補齊：**為每種來源定義獨立 completeness assertion、checkpoint coverage、opening/closing balance proof、movement roll-forward、provider reconciliation、重組／回補策略與可量化 parser coverage。

### A8. 定價、估值與授權資料成本未進入產品可行性

文件把價格 waterfall 寫成規則，卻沒有 provider、授權、historical depth、Sui long-tail token coverage、bid/ask、principal market 判定、API 成本與 redistribution 權利。沒有可用價格就不能產生可審計 JE；人工 override 會把 SaaS 變成服務業。

**必須補齊：**選定 provider、完成 30 天資產 coverage 測試、定義每資產 principal market、資料授權與成本，並將缺價率及人工估值工時納入 unit economics。

### A9. 沒有定價數字與單位經濟，商業模式不可評估

「月訂閱＋導入費＋用量」不是定價。沒有 ACV、implementation fee、毛利、人日、support load、data cost、AI cost、sales cycle、churn 或 payback 假設。

**必須補齊：**至少提出三個具體價格包、每包 COGS 與導入人日，並以 3 個客戶報價測試。若每個客戶都需要 protocol parser、COA mapping 與會計顧問，必須按專業服務公司估值，而非 SaaS。

### A10. Walrus 可能增加風險，尚未證明增加客戶價值

審計證據需要完整性、保密性、保留、legal hold、刪除、存取控制與可讀性；把 hash 或加密包放 Walrus 只解決部分 tamper evidence。若金鑰遺失、資料不可刪除、服務可用性不足或審計師不接受，反而成為治理負擔。

**必須補齊：**首個 pilot 僅存 manifest hash；以客戶／審計師訪談驗證採購價值。未證明前，Walrus 不得列為核心商業差異化或 close blocker。

---

## B. 商業規格書問題清單

### 第 1 章：背景與問題定義

1. **[1.1、1.4] 問題：沒有 TAM/SAM/SOM，也沒有 bottom-up 市場容量。**「全球、IFRS/US GAAP」只是適用範圍，不是市場規模。  
   **嚴重度：高**  
   **具體修改建議：**用目標帳戶數 × 可實現 ACV 建模；分開 Sui-native、multi-chain crypto-native、Web2 stablecoin 三個市場，列出資料來源、年份與可服務條件。

2. **[1.1] 問題：痛點敘述合理，但沒有量化頻率、成本與替代方案滿意度。**  
   **嚴重度：中**  
   **具體修改建議：**加入訪談樣本、每月人工時數、錯帳／未分類比例、close days、外包費與現有工具。

3. **[1.2、1.4] 問題：把「Sui 需要專門解析」直接推論成可付費需求。**技術特殊不等於預算存在。  
   **嚴重度：高**  
   **具體修改建議：**要求 design partner 提供因 Sui 導致的具體人工步驟與失敗案例，並以節省金額驗證。

### 第 2 章：產品定位與目標

4. **[2.3] 問題：ICP 橫跨項目方、CEX、custodian、基金、做市商、支付商與 Web2 treasury。**買方、控制、資料與會計模型完全不同。  
   **嚴重度：高**  
   **具體修改建議：**首個 ICP 限定為「有法人、單一 Sui 主體、月交易量 1,000–20,000、使用外部會計師、目前用 CSV close」。

5. **[2.3] 問題：L1 內部也不一致。**項目方、CEX、託管商的 customer assets、收入模型與責任風險差距巨大。  
   **嚴重度：高**  
   **具體修改建議：**把 CEX／custody 移出 L1；首期不處理代管客戶資產。

6. **[2.5] 問題：MVP 目標同時覆蓋多事件、雙準則、AI、recon、export、Walrus。**  
   **嚴重度：高**  
   **具體修改建議：**建立「demo MVP」與「paid pilot MVP」兩套明確範圍及驗收，不得混用。

### 第 3 章：使用者與角色

7. **[3.1] 問題：角色完整但沒有實際 buyer、economic buyer、champion 與 blocker。**  
   **嚴重度：中**  
   **具體修改建議：**為首個 ICP 畫出採購流程、預算 owner、法務／資安／外部會計師的否決點。

8. **[3.2] 問題：SoD 只寫原則，未處理小公司只有 1–2 名財務人員的現實。**  
   **嚴重度：中**  
   **具體修改建議：**定義外部會計師 approval、金額門檻、補償性控制與 break-glass 流程。

### 第 4 章：核心使用情境

9. **[4.1–4.9] 問題：User stories 多數沒有 Given/When/Then、錯誤路徑與可驗收資料。**  
   **嚴重度：中**  
   **具體修改建議：**每個 P0 story 加入輸入 fixture、成功條件、fail-closed 條件、權限與 audit log。

10. **[4.3] 問題：AI confidence 沒有校準方法。**不同 event type 的 confidence 不可直接比較。  
    **嚴重度：中**  
    **具體修改建議：**按 event type 定義 precision/recall、calibration、abstention、drift 與人工 gold set。

11. **[4.4] 問題：對準則的描述仍會讓產品承擔「建議正確處理」的期待。**  
    **嚴重度：高**  
    **具體修改建議：**Policy activation 必須綁定具名 approver、evidence、適用資產、有效期與模板版本。

12. **[4.7] 問題：MVP 只有 CSV，卻把成功匯出近似「ERP 採用」。**無 acknowledgement 無法證明入帳成功或防止人工作業重複。  
    **嚴重度：中**  
    **具體修改建議：**要求使用者回傳 ERP batch ID／import report；建立 manual acknowledgement 與 duplicate control。

### 第 5 章：MVP 範圍

13. **[5.1] 問題：事件 taxonomy 過大且與會計規格不一致。**商業文件列 14 類，會計文件稱 8 大類。  
    **嚴重度：高**  
    **具體修改建議：**建立唯一 canonical event registry；MVP 只保留 receipt、payment、internal transfer、swap、gas。

14. **[5.1] 問題：FIFO 與兩種 WAC 在 accounting spec 中被承諾，實作和重跑複雜度被低估。**  
    **嚴重度：中**  
    **具體修改建議：**首期只做 FIFO；WAC 待有付費需求再加。

15. **[5.2] 問題：排除 consolidation，卻在路線圖 Commercial v1 納入多實體，缺少跨實體資料與 intercompany 邊界。**  
    **嚴重度：中**  
    **具體修改建議：**明確寫「多 entity view 不等於 consolidation」，不得暗示提供合併財報能力。

### 第 6 章：功能模組

16. **[6.1] 問題：完整性控制不足以證明 source population。**  
    **嚴重度：高**  
    **具體修改建議：**加入 checkpoint range、address/object/event coverage、balance roll-forward 與 provider cross-check。

17. **[6.3] 問題：Pricing/FX 被當成一般模組，實際是高風險資料產品。**  
    **嚴重度：高**  
    **具體修改建議：**獨立估值政策、provider SLA、授權、fallback、manual valuation review 與 price challenge workflow。

18. **[6.4] 問題：規則引擎規格沒有模板治理、回歸測試與變更影響分析。**  
    **嚴重度：中**  
    **具體修改建議：**每個 rule pack 必須有 authoritative source、golden fixtures、coverage、owner、effective dates。

19. **[6.8] 問題：Walrus 被放進 MVP P0 demo，會排擠真正的 accounting correctness。**  
    **嚴重度：中**  
    **具體修改建議：**降為 optional demo；close 成功不得依賴 Walrus availability。

20. **[6.10] 問題：企業安全只列控制名稱，沒有安全基線與責任分界。**  
    **嚴重度：中**  
    **具體修改建議：**加入 threat model、tenant isolation tests、RPO/RTO、subprocessor、key management、incident SLA。

### 第 7 章：Sui Stack

21. **[7.2] 問題：GraphQL、gRPC/RPC、Walrus、Seal、Nautilus、zkLogin、Clock 的清單有 buzzword 堆砌傾向。**多數未連到首個付費 use case 或可量化需求。  
    **嚴重度：中**  
    **具體修改建議：**每個元件加「不用它會失敗什麼、替代方案、成熟度、成本、退出條件」；MVP 只保留 SDK/RPC、必要 indexer、DeepBook parser。

22. **[7.5] 問題：Demo happy path 不能證明 accounting product。**  
    **嚴重度：中**  
    **具體修改建議：**增加漏事件、缺價、unmatched transfer、policy change、replay 五個 failure demos。

### 第 8 章：非功能性需求

23. **[8.2] 問題：50,000 transactions、p95、10 分鐘等目標沒有 workload 定義與測試環境。**  
    **嚴重度：低**  
    **具體修改建議：**定義 raw/event ratio、資產數、lot 數、query shape、硬體與 benchmark dataset。

24. **[8.4、8.7] 問題：資料保留、跨境、AI provider 與刪除義務未形成可售企業方案。**  
    **嚴重度：高**  
    **具體修改建議：**首個市場限定資料區域；完成 DPA、retention matrix、subprocessor list、customer deletion/export 流程。

### 第 9 章：路線圖

25. **[Phase 0–2] 問題：從 hackathon 到 Commercial v1 跨越資料、會計、安全、ERP、SSO、審計，沒有時間、人力或依賴。**  
    **嚴重度：高**  
    **具體修改建議：**改成 evidence-gated roadmap；每階段以付費客戶證據與錯誤率門檻解鎖，不以功能清單解鎖。

26. **[Phase 3–4] 問題：stablecoin treasury 與 agentic finance 稀釋早期焦點。**  
    **嚴重度：低**  
    **具體修改建議：**移到 vision appendix，不列入 18 個月資源規劃。

### 第 10 章：競品

27. **[10.1] 問題：競品表明示未重新查證，不能支持投資或 GTM 決策。**  
    **嚴重度：高**  
    **具體修改建議：**實際試用／demo 至少 3 家，記錄 Sui coverage、DeepBook、ERP、定價、implementation、security、IFRS 能力。

28. **[10.2] 問題：差異化欄位多是未證明 claim。**Walrus evidence、可解釋 AI、policy trace 是否是買方優先需求未知。  
    **嚴重度：高**  
    **具體修改建議：**以 win/loss interview 和 willingness-to-pay 排序，刪除不能影響成交的差異化。

### 第 11 章：KPI

29. **[11.1] 問題：North Star 是內部吞吐量，不是客戶結果。**事件數可因拆分粒度增加而膨脹。  
    **嚴重度：中**  
    **具體修改建議：**North Star 改為「在相同控制範圍下，每次 close 節省的人工小時／完成一次無重大調整的 close」。

30. **[11.2] 問題：`expected records/source records` 不可量測；AI precision 的抽樣母體也未定義。**  
    **嚴重度：高**  
    **具體修改建議：**為每 KPI 定義 numerator、denominator、排除項、資料來源、owner、frequency 與 anti-gaming test。

31. **[11.3] 問題：商業 KPI 缺 pipeline conversion、ACV、CAC、sales cycle、gross margin 與 payback。**  
    **嚴重度：高**  
    **具體修改建議：**加入 LOI→paid pilot→production funnel、ACV、服務人日、COGS、NRR、CAC payback。

### 第 12 章：風險

32. **[12] 問題：風險表缺 likelihood、owner、trigger、residual risk 與日期。**  
    **嚴重度：中**  
    **具體修改建議：**改成正式 risk register；Blocker 必須綁定 go/no-go gate。

33. **[12.1] 問題：商用門檻沒有會計師 sign-off、資安測試、資料授權、保險與契約責任。**  
    **嚴重度：高**  
    **具體修改建議：**加入 external accounting review、penetration test、DPA/MSA、limitation of liability、cyber/E&O insurance 評估。

### 第 13 章：定價與商業模式

34. **[13.2] 問題：完全沒有價格。**無法判斷 willingness-to-pay 或毛利。  
    **嚴重度：高**  
    **具體修改建議：**提出例如付費 pilot、Growth ACV、Enterprise minimum 三個實數區間並測試。

35. **[13.3] 問題：normalized event 計價可被 parser 拆分方式操控，客戶難預算。**  
    **嚴重度：中**  
    **具體修改建議：**以 source transaction tier 為基礎，超額 protocol complexity 另計；公開 event expansion 規則。

36. **[13.5] 問題：成本只列項目，沒有 unit economics。**  
    **嚴重度：高**  
    **具體修改建議：**建立每客戶 data、AI、storage、support、accounting advisory、implementation 成本模型與毛利門檻。

### 第 14 章：GTM

37. **[14.2] 問題：GTM 高度依賴 Sui ecosystem/grants，但沒有可控渠道或 pipeline。**  
    **嚴重度：高**  
    **具體修改建議：**建立 named-account list、每週 outreach、intro source、meeting→data access→pilot conversion 目標。

38. **[14.3–14.4] 問題：從 Sui 項目方跳到 CEX、基金與 Web2 treasury，需要不同產品與信任資產。**  
    **嚴重度：高**  
    **具體修改建議：**在首個 segment 達到 5 個付費 production 客戶前，不啟動下一 segment。

39. **[14.6] 問題：pilot 成功交付物過多，極易變成客製顧問專案。**  
    **嚴重度：中**  
    **具體修改建議：**固定資料範圍、事件類型、工時與 exception 上限；超出範圍另報價。

### 第 15–17 章與附錄

40. **[15] 問題：資料模型是概念清單，缺唯一鍵、狀態機、基數、effective dating、tenant boundary 與 deletion rules。**  
    **嚴重度：中**  
    **具體修改建議：**補 ERD、state transitions、idempotency keys、revision chain、book/entity separation。

41. **[16] 問題：最關鍵決策（pricing provider、首個 ERP、政策審查、Walrus 策略）仍未決，卻宣稱正式初版。**  
    **嚴重度：高**  
    **具體修改建議：**文件狀態改為 `DRAFT FOR VALIDATION`；每個決策指定 owner、deadline、decision criteria。

42. **[17] 問題：驗收條件沒有 accuracy threshold、golden dataset、外部 sign-off 與 production readiness。**  
    **嚴重度：高**  
    **具體修改建議：**加入 parser coverage、zero material JE error、replay determinism、security/accounting sign-off、pilot acceptance。

---

## C. 會計規格書問題清單

### 第 1 章：準則與適用範圍

1. **[1.1] 問題：把 `measurement_path` 設為 entity/book 單一路徑會造成錯誤。**同一帳簿可同時有 IAS 38、IAS 2、IFRS 9；US GAAP 也有 ASU in-scope/out-of-scope。  
   **嚴重度：高**  
   **具體修改建議：**準則框架設在 book；分類與 measurement model 設在 asset/position，允許同一 book 多模型。

2. **[1.1] 問題：`IFRS_COST` 暗示 IAS 38 是 IFRS 預設。**只有在不適用其他準則且符合無形資產條件時才落到 IAS 38；不能先預設再例外。  
   **嚴重度：高**  
   **具體修改建議：**改為 scope-first decision tree；任何預設只能是 `PENDING_CLASSIFICATION`。

3. **[1.4] 問題：finality、block time、交易執行與會計認列時點混在一起。**法律控制／履約時點不一定等於鏈上確認時間。  
   **嚴重度：中**  
   **具體修改建議：**分開 technical finality、economic execution、settlement、recognition date、accounting date。

### 第 2 章：資產分類

4. **[2.2] 問題：IFRS 9 判斷只問「收取現金或金融資產的合約權利」，不足以完成分類衡量。**還需要業務模式、現金流特徵、衍生工具／嵌入式條款等。  
   **嚴重度：高**  
   **具體修改建議：**若宣稱 IFRS 9 支援，加入完整 classification/measurement routing；否則明確只輸出 assessment evidence，不自動定案。

5. **[2.3] 問題：`stablecoin_treatment` 粒度過粗。**分類應依 instrument、holder eligibility、jurisdiction、terms version、use，不是 entity 單欄位。  
   **嚴重度：高**  
   **具體修改建議：**建立 StablecoinAssessment entity，具版本、證據、有效期、review triggers。

6. **[2.3] 問題：depeg「不改變既有分類」表述過度絕對。**depeg 本身未必改分類，但可能伴隨贖回權、流動性、信用或業務用途改變，必須重新評估。  
   **嚴重度：中**  
   **具體修改建議：**改為「depeg 不自動重分類，但觸發分類、估值、減損及流動性重評」。

7. **[2.4] 問題：ASU scope 問卷方向大致正確，但沒有逐資產、逐版本證據與 related-party issuer 判斷。**  
   **嚴重度：高**  
   **具體修改建議：**每項 criterion 必須保存 answer、source、reviewer、effective period；`UNKNOWN` 必須 fail closed。

8. **[2.5] 問題：edge cases 多數仍是敘述，不是可執行規則。**例如「權利實質不變」「可可靠衡量」沒有判斷欄位與證據門檻。  
   **嚴重度：高**  
   **具體修改建議：**每個 edge case 定義 facts schema、decision table、required evidence、allowed outcomes、JE templates、manual override。

### 第 3 章：事件類型與處理

9. **[3.1] 問題：Receipt 把客戶收款、資本投入、借款、贈與、airdrop、fork 放同一 event type。**經濟性質與對方科目完全不同。  
   **嚴重度：高**  
   **具體修改建議：**technical receipt 與 accounting event 分離；至少以 `economic_purpose` 強制 routing 且無 purpose 不得過帳。

10. **[3.2] 問題：AP 1,000、token FV 980 的 JE 用 balancing amount，未明示服務／清償差異的性質。**  
    **嚴重度：中**  
    **具體修改建議：**範例必須給 token carrying amount，分開 settlement difference、disposal gain/loss、FX，禁止用未分類 balancing line。

11. **[3.3] 問題：bridge/wrap 預設 rollover 的條件不可由 parser 單獨證明。**  
    **嚴重度：高**  
    **具體修改建議：**未有合約權利 assessment 時預設 `REVIEW_REQUIRED`，不得預設 internal representation change。

12. **[3.4] 問題：CEX 存款可能由 crypto asset 轉為對交易所的合約請求權，這不是邊緣例外。**多數 omnibus／custodial arrangements 都需要條款評估。  
    **嚴重度：高**  
    **具體修改建議：**為每個 CEX/custodian 建 custody legal model；沒有核准 assessment 不得自動 rollover classification。

13. **[3.5] 問題：swap 以「較可靠者」作交易價值仍缺 fair-value hierarchy、transaction cost、principal market 與 nonmonetary exchange routing。**  
    **嚴重度：中**  
    **具體修改建議：**將 valuation conclusion 保存為 MeasurementResult，不能只保存價格。

14. **[3.6] 問題：staking reward 一律 Dr asset / Cr income 是未證實的模板。**不同協議的 earned、claimable、vesting、控制與服務義務可能不同。  
    **嚴重度：高**  
    **具體修改建議：**預設不過帳；按協議建立 recognition facts 與外部 accounting memo。

15. **[3.7] 問題：gas／fee 的資本化規則沒有對應標的準則與成本構成。**  
    **嚴重度：中**  
    **具體修改建議：**只允許明確 target asset、directly attributable test、policy citation 與 approved evidence 時資本化。

16. **[3.8] 問題：IAS 38 重估模式在 crypto 上高度依賴 active market，文件卻把它做成一級產品路徑。**實際可用範圍可能極窄。  
    **嚴重度：高**  
    **具體修改建議：**首期移除 IFRS revaluation，除非外部會計師對特定 class 明確認可 active market。

### 第 4 章：成本基礎與 Lot

17. **[4.1] 問題：book accounting 的 cost formula 與 tax-lot identification 被混稱 `cost_basis`。**這會導致使用者誤以為財報與稅務方法可互換。  
    **嚴重度：高**  
    **具體修改建議：**拆成 `book_cost_formula`、`tax_lot_method`、`management_lot_method`，禁止跨 book 共用結果。

18. **[4.1] 問題：Specific identification、periodic WAC、moving WAC 的適用條件及資產群組一致性未定義。**  
    **嚴重度：中**  
    **具體修改建議：**定義 pool scope、negative inventory、backdated event、period reopen、precision 與 method-change migration。

19. **[4.2] 問題：PositionLot 缺 acquisition source type、legal owner、location history、original currency cost、valuation layers 與 disposal allocation version。**  
    **嚴重度：中**  
    **具體修改建議：**補欄位並以 immutable LotMovement 重建任何時點狀態。

20. **[4.3] 問題：late-arriving／backdated transaction 對 FIFO/WAC 的全面重算與已 posted JE 處理未定義。**  
    **嚴重度：高**  
    **具體修改建議：**定義 cut-off、reallocation、downstream dependency graph、reversal/replacement 與 materiality workflow。

21. **[4.3] 問題：負 rebase「carrying amount 是否維持或認列損失由政策決定」過度自由。**政策不能取代準則分析。  
    **嚴重度：中**  
    **具體修改建議：**允許的 treatment 必須綁定 token mechanics、accounting class 與核准 memo。

22. **[4.5] 問題：數位資產的 IAS 21 monetary/non-monetary 判斷與穩定幣分類高度耦合，但資料模型未連結。**  
    **嚴重度：高**  
    **具體修改建議：**ClassificationAssessment 必須直接輸出 monetary status、FX remeasurement model 與 evidence。

### 第 5 章：PolicySet

23. **[5.1] 問題：`measurement_path` 單值與 `AssetPolicy.measurement_model` 重複且可能衝突。**  
    **嚴重度：高**  
    **具體修改建議：**PolicySet 只定 standard/book defaults；最終模型由 resolved asset policy 決定，並設 conflict validation。

24. **[5.1] 問題：`stablecoin_treatment`、`default_token_classification` 允許危險預設。**  
    **嚴重度：高**  
    **具體修改建議：**對 stablecoin、wrapped、LP、receipt、issuer token 禁止 default auto-post；只能 pending review。

25. **[5.2] 問題：AssetPolicy 缺合約版本、法律意見、assessment expiry、issuer relationship 與 holder eligibility。**  
    **嚴重度：高**  
    **具體修改建議：**加入 evidence package 與 revalidation triggers。

26. **[5.4] 問題：只由核准人選擇政策變更或估計變更，缺乏準則評估與影響計算。**  
    **嚴重度：中**  
    **具體修改建議：**要求 change memo、citation、retrospective/prospective treatment、impact report、reviewer。

### 第 6 章：規則引擎

27. **[6.1–6.4] 問題：輸入沒有 explicit accounting date、recognition date、settlement date、contract/evidence version。**  
    **嚴重度：高**  
    **具體修改建議：**補齊並將時間欄位納入 idempotency/input hash。

28. **[6.3] 問題：Event classification 在 ownership/entity boundary 後，但某些 classification 需要 business purpose、counterparty、contract facts；執行順序未表達 iterative assessment。**  
    **嚴重度：中**  
    **具體修改建議：**將 technical event、economic event、accounting assessment 分層，不用單一步驟覆蓋。

29. **[6.6] 問題：相同輸入 hash 產生相同輸出，不足以處理外部資料被撤回或 provider correction。**  
    **嚴重度：中**  
    **具體修改建議：**價格／FX／source payload 都需 immutable version 和 provenance；撤回以新版本觸發 impact analysis。

30. **[6.7] 問題：ERP rejected 只保留狀態，沒有 partial acceptance、manual modification、ERP period closure 與 reconciliation。**  
    **嚴重度：中**  
    **具體修改建議：**定義 batch/line acknowledgement、ERP-side JE ID、reject reason、resubmit/reversal。

### 第 7 章：JE 範例

31. **[7.1] 問題：`Settlement Difference` 是未分類暫記科目。**文件自己禁止 miscellaneous balancing，卻在核心範例中使用模糊差額。  
    **嚴重度：高**  
    **具體修改建議：**給定具體事實後分成 FX、contractual discount、credit loss 或 disposal difference；否則標記 review，不產生 JE。

32. **[7.2] 問題：US GAAP swap 範例假設 USDC 直接列 `Stablecoin Asset` 300，未先判斷 USDC 是否 ASU in-scope 或其他金融／receivable 模型。**  
    **嚴重度：高**  
    **具體修改建議：**範例明示 USDC classification；若 out-of-scope，展示對應模型或停在 assessment。

33. **[7.3] 問題：IFRS staking reward 期末 FV 120 直接說 impairment 30，沒有 recoverable amount 測試。**FV 下降不等於 IAS 36 impairment 金額。  
    **嚴重度：高**  
    **具體修改建議：**把 120 明確定義為 recoverable amount，或刪除此簡化。

34. **[7.5] 問題：bridge fee JE `Cr Digital Asset 10` 忽略所處分 token carrying amount 與處分損益。**若用 token 支付且 carrying amount 不等於 FV，分錄不完整。  
    **嚴重度：高**  
    **具體修改建議：**展示 Dr fee 10 / Cr asset carrying / Cr或Dr disposal gain/loss。

35. **[7.6] 問題：fork 範例直接認收入 400，跨準則依據未建立。**  
    **嚴重度：高**  
    **具體修改建議：**改成不可自動過帳的候選範例；只有核准 memo 指定 recognition basis 後才產生模板。

36. **[7.7] 問題：rebase reward income 範例把 token supply mechanics 等同收入。**  
    **嚴重度：高**  
    **具體修改建議：**預設只做 quantity movement；收入路徑需證明新增經濟資源及認列依據。

37. **[7.8] 問題：LP token 以 FV 1,000 認列 disposal/acquisition，未處理交易成本、權利性質與估值可靠性。**  
    **嚴重度：中**  
    **具體修改建議：**標為 manual valuation scenario，不得成為通用 golden template。

38. **[7 全章] 問題：列出的 JE 在算術上大多平衡，但「平衡」不代表會計正確。**尤其 AP、settlement difference、bridge fee、fork、rebase 的科目性質或金額來源不完整。  
    **嚴重度：高**  
    **具體修改建議：**每個 JE fixture 必須包含 facts、scope conclusion、measurement calculation、lot movement、citation、expected disclosure。

### 第 8 章：披露與報表

39. **[8.2] 問題：列出 IFRS 支援資料不等於符合 disclosure requirements。**缺 materiality、comparatives、accounting policy、judgments、sensitivity、credit/liquidity risk 等 routing。  
    **嚴重度：高**  
    **具體修改建議：**不要宣稱 IFRS disclosure support；改稱 supporting data，並建立逐準則 disclosure matrix。

40. **[8.3] 問題：ASU 2023-08 揭露要求仍標需查證，卻已設計 roll-forward。**可能多做錯欄位或漏 mandatory presentation。  
    **嚴重度：高**  
    **具體修改建議：**先取得 authoritative checklist，再鎖定 DisclosureFact schema。

41. **[8.4] 問題：現金流分類只留 tag，未定義非現金交易與 stablecoin cash-equivalent 決策如何避免誤列。**  
    **嚴重度：中**  
    **具體修改建議：**未核准 cash classification 時全部標 `UNDETERMINED_NONCASH_REVIEW`，禁止自動輸出現金流分類。

42. **[8.6] 問題：Walrus 被納入關帳控制，會讓外部服務故障阻擋 accounting close。**  
    **嚴重度：高**  
    **具體修改建議：**關帳以內部 immutable manifest 為準；Walrus 是 asynchronous optional publication，不得是 accounting dependency。

### 第 9 章與附錄

43. **[9、附錄 A] 問題：「三條不可混算路徑」過度簡化，尤其 US GAAP entity 內必須混合不同資產模型。**  
    **嚴重度：高**  
    **具體修改建議：**改成「每個 asset position 必須有唯一 resolved model；同一 book 可並存多模型」。

44. **[附錄 B] 問題：golden tests 只按事件×路徑，沒有按資產分類、權利、角色、時間與價格品質形成組合測試。**  
    **嚴重度：中**  
    **具體修改建議：**建立 decision-table coverage，測試 facts permutation，而非只測 24 個 happy-path 模板。

---

## D. 兩份文件間的不一致

| 類型 | 商業規格 | 會計規格 | 風險／修改 |
|---|---|---|---|
| Event receipt | `ASSET_RECEIPT` | `DIGITAL_ASSET_RECEIPT` | 建立 canonical code；禁止 UI、rule、DB 各自命名。 |
| Event payment/disposal | `ASSET_DISPOSAL` | `DIGITAL_ASSET_PAYMENT` | disposal 不等於 payment；拆 technical disposal 與 economic payment。 |
| Trade | `TRADE_BUY`、`TRADE_SELL`、`SWAP` | `SPOT_TRADE_SWAP` + legs | 定義 parent event 與 leg taxonomy。 |
| Gas | `FEE_GAS` | `GAS_FEE` | 統一 code。 |
| CEX | `CEX_DEPOSIT`、`CEX_WITHDRAWAL` | `CEX_DEPOSIT_WITHDRAWAL` | 決定單一 event + direction，或兩個 event。 |
| 期末事件 | `PERIOD_END_REMEASUREMENT` | 另有 `IMPAIRMENT`、`IMPAIRMENT_REVERSAL` | 商業規格漏列後兩者。 |
| 8 大類說法 | 商業規格列 14 類 | 會計規格稱 8 大類，實際 event codes 超過 8 | 不可用「8 大類」作 schema；建立 registry。 |
| PolicySet 成本方法 | 商業 MVP：FIFO、WAC | 會計：FIFO、periodic WAC、moving WAC、specific ID | 首期能力與 UI 必須一致。 |
| Policy 欄位 | 商業：`crypto_classification_default`、`staking_income_policy`、`fee_expense_policy`、`impairment_or_fair_value_mode` | 會計：`default_token_classification`、多個 `*_policy_id`、`measurement_path` | 以會計規格為 canonical schema；商業附錄不得另造欄位。 |
| Posted 狀態 | 商業：`posted／acknowledged` 並列 | 會計：ERP 是 SoR，rejected 為 `APPROVED_NOT_POSTED` | 定義 state machine：approved、exported、acknowledged、posted、rejected、reversed。 |
| 模組名 | 商業：Pricing, FX & Position Lots | 會計另有 MeasurementResult、LotMovement、FxRate | 商業資料模型漏列關鍵實體。 |
| MVP 框架 | 商業承諾 IFRS／US GAAP switch | 會計顯示大量準則結論尚待查證 | demo switch 不得被描述成 compliant accounting support。 |
| Reconciliation | 商業含 ERP acknowledgement／book balance（有回傳時） | MVP CSV 無原生回傳 | 加入 manual acknowledgement，否則只能 wallet-to-subledger。 |
| Walrus close | 商業：snapshot 失敗不得 close | 會計：可寫入 Walrus 或其他儲存 | 改為內部 manifest 必須成功；Walrus publication 可延後。 |
| AssetProfile/AssetPolicy | 商業以單一 AssetProfile 保存 accounting class | 會計允許 entity/book/period 不同分類 | 技術資產主檔與帳簿政策必須分離。 |
| `review_status` | 商業要求 approved event 才產 JE | 會計規則範例同樣依賴 approved，但輸出 decision 又包含 review routing | 明確分 classification approval、policy approval、JE approval。 |

---

## E. `[需查證]` 風險判斷

兩份文件共有 **68 處** `[需查證]`。不能一律留到「正式上線前」處理；其中多數會改變資料模型、規則引擎或 GTM，若延後確認會造成重做。

### E1. 真風險：設計／開發前必須確認

以下項目會直接改變 schema、JE、lot、scope 或 disclosure，屬 blocker：

- ASU 2023-08 scope criteria、effective date、transition、presentation、annual/interim disclosures、roll-forward。
- 穩定幣是否為現金、現金等價物、金融資產、無形資產，以及可執行贖回權。
- CEX/custody 後企業持有的是 token 還是對平台的合約請求權。
- IAS 38 active market 與 revaluation availability。
- IAS 2 broker-trader FVLCTS 適用條件。
- staking reward recognition point。
- bridge、wrapped、LP、fork、rebase 的 rights/control 與 recognition。
- IFRS impairment/reversal、revaluation reserve 與 OCI/P&L waterfall。
- fee/gas transaction cost 的資本化或費用化。
- monetary/non-monetary、IAS 21 與 stablecoin FX routing。
- fair value principal market、valuation technique、hierarchy。
- cost formula change、specific ID、LIFO/HIFO book/tax 邊界。
- cash-flow classification 與 noncash disclosure。
- IFRS/US GAAP disclosure matrix。

**處置：**不得只保留 `[需查證]`。每項建立 accounting decision record，包含 authoritative source、結論、適用 facts、owner、reviewer、version、effective date、test cases。

### E2. 真風險：付費 pilot 前必須確認

- 競品 Sui/DeepBook/ERP/AI 實際能力與價格。
- Sui API／GraphQL／gRPC、DeepBook schema 的穩定性與歷史完整性。
- pricing/FX provider 的 coverage、授權與成本。
- Walrus 持久性、成本、保密、retention、法律證據效力。
- SOC 2／ISO 27001、資料駐留與 retention 的客戶要求。
- Sui ecosystem program、partner support 與渠道可用性。
- 市場採用、ERP 原生不足、subledger 類別與 stablecoin 成長等外部 claim。

**處置：**轉成商業驗證 backlog，每項有 evidence link、日期與 decision impact。

### E3. 可忽略或可延後，但不得用於對外 claim

- SuiNS、Seal、Nautilus、zkLogin／Enoki、Clock 等 Phase 1/2 元件的最新 API。
- 長期全球 retention 年限。
- 尚未進入的 Web2 stablecoin treasury 細分需求。
- 非首期 ERP connector 的即時能力比較。

**處置：**從 MVP 正文移至 future research；不要讓未用元件增加架構負擔。

### E4. 不該標 `[需查證]`，而應直接改寫為已知控制原則

- 「穩定幣不因 peg 自動成為現金」：這應是明確 fail-closed 原則。
- 「客戶代管資產不因企業控制錢包就當然認列」：這應是 ownership/recognition gate。
- 「價格與 FX 不可缺省為 1」：這是系統控制，不是待查證。
- 「AI 不得直接核准政策或 posted JE」：這是產品治理決策。
- 「敏感資料不得明文公開」：這是安全要求。

---

## 優先修改順序

1. 收斂首個 ICP、單一準則、事件與資料來源；重寫 MVP。
2. 建立 canonical event registry、PolicySet schema 與 state machine，消除兩文件不一致。
3. 由具資格會計專業人士簽核 ASU scope、stablecoin、CEX、staking、bridge/wrap、IFRS revaluation 與 disclosure matrix。
4. 用真實資料完成 completeness、parser、price coverage 與 JE golden tests。
5. 完成 15 次訪談、3 個付費 pilot、競品 benchmark 與具體 pricing/unit economics。
6. Walrus 降為 optional evidence publication；先證明 close correctness 與客戶願付費。

## F. 一句話總結

**以投資人身分，現在不能說服我投資：它證明了團隊會寫完整規格，尚未證明有足夠大的可付費市場、不可輕易複製的優勢、可交付的窄 MVP、經專業簽核的會計正確性，以及能在高導入成本下成立的 SaaS 單位經濟。**
