import type { PositionLot, PricePoint, JournalEntry, RuleException } from '../domain/types.js';

export type ValuationBasis = 'GAAP_FV' | 'GAAP_COST' | 'IFRS_COST';

export interface ValuationState {          // api 從 lot_valuation fold 後餵入（per lot）
  lotId: string;
  cumulativeDeltaMinor: string;            // 未被 supersede 的 delta 總和（法幣 minor，可負）
  cumulativeImpairmentMinor: string;       // 累計已認列減損（正數；IFRS/GAAP_COST 用）
  qtyAtLastValuationMinor: string;         // 最近一次估值當下數量（per-unit 化分母）
  hasOpeningSeq0: boolean;                 // ASU 過渡列是否已存在
}

export interface LotValuationDraft {
  lotId: string;
  seq: number;                             // 0 = OPENING_FV；run 時由 api 以 runSeq 覆寫 ≥1
  basis: ValuationBasis;
  qtyMinor: string;
  priorCarryingMinor: string;
  currentValueMinor: string;
  deltaMinor: string;
  pricePointId: string;
  reason: 'REVALUE' | 'IMPAIR' | 'REVERSE' | 'OPENING_FV';
}

export interface RevalueInput {
  basis: ValuationBasis;
  entityId: string;
  periodId: string;
  keyBase: string;                         // api 給：`${entityId}:${periodId}:${runSeq}`
  lots: PositionLot[];                     // remaining（foldRemainingLots 輸出）
  valuations: Record<string, ValuationState>;  // by lotId；無列 = zero-state
  prices: PricePoint[];                    // 該 period cut-off 的 as_of 價
  decimalsByCoin: Record<string, number>;  // asset_registry 提供
  policySetVersion: string;
}

export interface RevalueOutput {
  journalEntries: JournalEntry[];          // per coinType 一張；idempotencyKey 已帶 `reval:` 前綴
  valuations: LotValuationDraft[];
  exceptions: RuleException[];             // 缺價 → {phase:12, code:'PRICE_MISSING', detail:{coinType}}
}
