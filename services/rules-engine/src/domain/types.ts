// Canonical event codes (paid-pilot 5; 其餘暫不支援)
export type EventType =
  | 'DIGITAL_ASSET_RECEIPT' | 'DIGITAL_ASSET_PAYMENT'
  | 'INTERNAL_TRANSFER' | 'SPOT_TRADE_SWAP' | 'GAS_FEE' | 'OPENING_LOT';

export type RunMode = 'PREVIEW' | 'POST' | 'REPLAY';
export type Decision = 'POSTABLE' | 'REVIEW_REQUIRED' | 'REJECTED';

export type ExceptionCode =
  | 'SCHEMA_INVALID' | 'ENTITY_BOUNDARY' | 'NOT_IMPLEMENTED_IN_SLICE'
  | 'SCOPE_UNKNOWN' | 'PRICE_MISSING' | 'FX_MISSING' | 'INSUFFICIENT_LOT'
  | 'MAPPING_MISSING' | 'JE_OUT_OF_BALANCE' | 'RULE_CONFLICT'
  | 'IDEMPOTENT_REPLAY' | 'PERIOD_CLOSED' | 'INPUT_ERROR'
  | 'REVALUED_LOT_NON_SWAP_DISPOSAL';

export interface RuleException { phase: number; code: ExceptionCode; detail: unknown; }

export interface NormalizedEvent {
  schemaVersion: string;
  eventId: string;
  eventType: EventType;
  eventGroupId: string | null;          // §3.0.2 多腿綁定；receipt slice 填 null
  entityId: string;
  bookId: string;
  wallet: string;
  counterparty: string | null;
  coinType: string;
  assetDecimals: number;
  quantityMinor: string;                // minor-unit integer string
  eventTime: string;                    // ISO
  economicPurpose: string;              // e.g. 'RECEIVABLE_SETTLEMENT'
  ownershipChange: boolean;
  considerationAsset: string | null;
  considerationQtyMinor: string | null;
  considerationDecimals: number | null;
  // lineage refs
  rawPayloadHash: string;
  txDigest: string;
  eventIndex: number;
  openingCostMinor?: string;            // OPENING_LOT only: historical cost basis, minor units
}

export interface ResolvedPolicySet {
  policySetVersion: string;
  assetPolicyVersion: string;
  eventPolicyVersion: string;
  ruleVersion: string;
  parserVersion: string;
  normalizationVersion: string;
  costBasisMethod: 'FIFO';
  functionalCurrency: string;           // e.g. 'USD'
  roundingThresholdMinor: string;       // 純小數差上限
  periodOpen: boolean;
}

export type AssessmentStatus = 'APPROVED' | 'PENDING_ACCOUNTING_REVIEW' | 'SCOPE_UNKNOWN';
export interface ClassificationAssessment {
  coinType: string;
  status: AssessmentStatus;
  accountingClass: string;              // e.g. 'INTANGIBLE_IAS38_COST'
  measurementModel: string;             // e.g. 'IAS38_COST'
}

export interface PricePoint {
  id: string;
  coinType: string;
  priceCurrency: string;                // 報價幣別
  asOfDate: string;                     // YYYY-MM-DD
  unitPriceMinor: string;               // priceCurrency minor per 1 whole asset unit
}

export interface FxRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  asOfDate: string;
  rateMinor: string;                    // toCurrency minor per 1 fromCurrency minor (scaled)
  scale: number;                        // rateMinor = rate * 10^scale
}

export interface PositionLot {
  lotId: string;
  seq: number;                 // 單調遞增，FIFO 排序鍵（上游 lot store 賦值）
  coinType: string;
  wallet: string;
  remainingQtyMinor: string;
  costMinor: string;                    // functional ccy
  // §4.5 處分吃重估後 carrying（CPA B1）：api 端 fold 後按剩餘量比例攤好餵入，缺省 = 未曾重估／減損（現狀行為）。
  // 兩欄互斥（GAAP_FV lot 帶 delta；GAAP_COST/IFRS_COST lot 帶 impair），由上游 basis 分派保證。
  valuationDeltaMinor?: string;         // 該 lot 累計重估 delta（可為負；含 ASU 過渡的權益分量，用於 carrying 計算）
  valuationImpairMinor?: string;        // 該 lot 累計減損（正數）
  // external review fix（§4.5 CPA B1）：valuationDeltaMinor 的子集，僅 P&L 認列的期間重估份額
  // （UnrealizedGainCryptoPnL/Loss），排除 ASU 過渡（OPENING_FV，記入 RetainedEarnings 權益，
  // 永不進 P&L）。處分重分類 line 必須只吃這個子集，不能吃整個 valuationDeltaMinor——否則會把
  // 從未入 P&L 的權益金額誤轉進 UnrealizedGainCryptoPnL/DisposalGain。缺省 = 0（無 P&L 份額可轉）。
  valuationPnlDeltaMinor?: string;
}

export interface Measurement {
  name: string;                // consideration_fv | disposal_carrying | realized_gain
  amountMinor: string;
  currency: string;
  track: 'FV' | 'CARRYING' | 'GAIN' | 'TAX_BASIS' | 'REVAL_RESERVE';
}

export interface CoaMapping {
  // event/leg → 科目
  resolve(args: { eventType: EventType; leg: string; coinType: string }): string | null;
}

export interface JeLine {
  account: string;
  side: 'DEBIT' | 'CREDIT';
  amountMinor: string;                  // functional ccy
  // 保留原幣/數量/價格/匯率/lineage
  origCoinType: string | null;
  origQtyMinor: string | null;
  priceRef: string | null;
  fxRef: string | null;
  leg: string;
}

export interface LotMovement {
  lotId: string;
  coinType: string;
  wallet: string;
  deltaQtyMinor: string;                // +acquire / -dispose
  deltaCostMinor: string;
}

export interface DisclosureFact { kind: string; detail: Record<string, unknown>; }

export interface RunContext {
  runId: string; entityId: string; bookId: string; periodId: string;
  mode: RunMode; asOf: string;
  // §4.4.1 (D9): as-of-this-event cumulative GasFeeExpense recognized this period, in
  // event-time order, NOT including the current event. Caller (api run-rules loop)
  // maintains this per-event as an accumulator so a full replay of the same event set
  // reproduces the identical negative-gas contra/income split. Optional; defaults to '0'
  // (no prior gas expense recognized) when omitted.
  gasExpenseToDateMinor?: string;
}

export interface RuleInput {
  runContext: RunContext;
  event: NormalizedEvent;
  policySet: ResolvedPolicySet;
  assetAssessment: ClassificationAssessment;
  lots: PositionLot[];
  prices: PricePoint[];
  fxRates: FxRate[];
  coaMapping: CoaMapping;
  priorJournalEntries?: Record<string, JournalEntry>;  // idempotencyKey → prior JE (replay)
}

export interface JournalEntry {
  idempotencyKey: string;
  lineageHash: string;         // resolved refs（off-chain sidecar，不進 merkle leaf）
  lines: JeLine[];
  reversalOf: string | null;            // prior idempotencyKey if reversal
}

export interface RuleOutput {
  decision: Decision;
  assessment: { eventType: EventType; accountingClass: string; measurementModel: string };
  measurements: Measurement[];
  lotMovements: LotMovement[];
  journalEntries: JournalEntry[];
  disclosureFacts: DisclosureFact[];
  exceptions: RuleException[];
  explanation: { ruleIds: string[]; policyVersions: string[]; priceRefs: string[]; fxRefs: string[] };
}
