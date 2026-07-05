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
  | 'IDEMPOTENT_REPLAY' | 'PERIOD_CLOSED' | 'INPUT_ERROR';

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
