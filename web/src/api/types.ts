export type EventStatus = 'INGESTED' | 'AUTO' | 'NEEDS_REVIEW' | 'APPROVED' | 'POSTED';
export type Side = 'DEBIT' | 'CREDIT';
export type Routing = 'AUTO' | 'NEEDS_REVIEW' | null;

export interface ApiError {
  error: { code: string; message: string };
}

export interface EntityDTO {
  id: string;
  displayName: string;
  chainObjectId: string;
  capObjectId: string;
  originalPackageId: string;
}

export interface EventAi {
  eventType: string;
  purpose: string;
  counterparty: string | null;
  confidence: number | null; // null pre-classify, else 0..1
  reasoning: string;
}

export interface EventFinal {
  eventType: string;
  purpose: string;
}

export interface EventDTO {
  id: string;
  entityId: string;
  status: EventStatus;
  normalized: Record<string, unknown>;
  ai: EventAi | null;
  final: EventFinal | null;
  routing: Routing;
}

export interface JournalLine {
  account: string;
  side: Side;
  amountMinor: string;
  origCoinType: string | null;
  origQtyMinor: string | null;
  priceRef: string | null;
  fxRef: string | null;
  leg: unknown;
}

export interface JournalEntryBody {
  idempotencyKey: string;
  lineageHash: string;
  reversalOf: string | null;
  lines: JournalLine[];
}

export interface JournalDTO {
  id: string;
  eventId: string;
  idempotencyKey: string;
  leafHash: string;
  je: JournalEntryBody;
}

export interface AnchorDTO {
  id: string;
  snapshotId: string;
  seq: number;
  link: string;
  digest: string;
  explorerUrl: string;
  anchoredAt: string;
}

export interface CopilotDraftLine {
  account: string;
  side: Side;
  amountMinor: string;
}

export interface CopilotAdvice {
  explanation: string;
  redFlags: string[];
  suggestedEntry: { lines: CopilotDraftLine[] } | null;
  citations: string[];
}

export interface SnapshotDTO {
  id: string;
  periodId: string;
  manifestHash: string;
  merkleRoot: string;
  leafCount: number;
  supersedesSeq: number | null;
  status: 'FROZEN';
}

export interface PrepareDTO {
  txKind: string;
  expectedSeq: number;
  chainId: string;
  capId: string;
}

export interface InclusionProof {
  idempotencyKey: string;
  leafIndex: number;
  siblings: Array<{ hash: string; position: 'L' | 'R' }>;
  merkleRoot: string;
}

// ---- Exception Queue types ----

export type ExceptionCategory = 'RULES_FAILED' | 'CLASSIFY_REVIEW' | 'LOW_CONFIDENCE_AUTO';
export type DispositionState = 'open' | 'resolved' | 'dismissed' | 'deferred';
export type ReasonCode =
  | 'MAPPING_ADDED' | 'RECLASSIFIED' | 'DUPLICATE_CONFIRMED'
  | 'IMMATERIAL_WAIVED' | 'PENDING_DOC' | 'CARRIED_FORWARD' | 'OTHER';

export interface ExceptionDTO {
  exceptionId: string;
  category: ExceptionCategory;
  eventId: string;
  severity: number;
  reason: string;
  amount: string | null;
  ai: { eventType: string | null; purpose: string | null; confidence: number | null; reasoning: string | null } | null;
  disposition: { state: DispositionState; reasonCode: ReasonCode; decidedBy: string; decidedAt: number } | null;
  anchoredReadOnly: boolean;
}

export interface ExceptionsResponse {
  exceptions: ExceptionDTO[];
  summary: { open: number; blocking: number; byCategory: Record<string, number> };
}
