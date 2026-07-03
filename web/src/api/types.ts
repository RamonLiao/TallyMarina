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
  merkleRoot: string | null; // joined from the anchored snapshot (Task 1)
  periodId: string;   // joined from the anchored snapshot (Task 1, export)
  leafCount: number;  // joined from the anchored snapshot (Task 1, export)
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

// ---- Reconciliation types ----

export interface ReconRowDTO {
  wallet: string; coinType: string; decimals: number;
  openingMinor: string; movementMinor: string; computedMinor: string;
  statementMinor: string; breakMinor: string; thresholdMinor: string;
  material: boolean;
  control: { debitMinor: string; creditMinor: string; legs: number };
  provenance: { computed: 'book'; statement: 'mock'; chain: 'live' | 'n/a' | 'unavailable' };
  disposition: { state: string; reasonCode: string; reasonNote: string | null } | null;
}
export interface ReconciliationResponse {
  rows: ReconRowDTO[];
  realWallet: string | null;
  summary: { material: number; openMaterial: number; balanced: number };
}
export interface ReconBreakDispositionDTO { state: string; reasonCode: string; reasonNote: string | null; }
export interface CloseReadiness {
  exceptions: { blocking: number; blockers: unknown[] };
  recon: { blocking: number; blockers: string[] };
  closeable: boolean;
}

// ---- Reopen reason codes ----

// Mirror of services/api/src/periodLock/state.ts REOPEN_REASON_CODES (keep in sync with backend state.ts).
export const REOPEN_REASON_CODES = ['ERROR_CORRECTION', 'ESTIMATE_CHANGE', 'LATE_ARRIVING_TXN', 'RECLASSIFICATION', 'OTHER'] as const;
export type ReopenReasonCode = (typeof REOPEN_REASON_CODES)[number];

// ---- Close Cockpit types ----

// Wire/API LightStatus from the backend is 'green' | 'red' | 'mock'.
// 'derived' is a FRONTEND-ONLY display state computed by effectiveStatus() in lightMeta.ts
// (green + real:false → rendered as derived/≈). The backend never returns 'derived'.
export type LightStatus = 'green' | 'red' | 'derived' | 'mock';
export interface CockpitLight {
  key: string;
  status: LightStatus;
  label: string;
  real: boolean;
}
export interface CloseCockpitResponse {
  lights: CockpitLight[];
  status: 'OPEN' | 'LOCKED';
  anchored: boolean;
  staleAnchor: boolean;
  closeable: boolean;
  reopenCount: number;
  restatementReason: string | null;
  reasonCode: string | null;
}

// ---- Policy types ----

export interface ResolvedPolicySetDTO {
  policySetVersion: string;
  assetPolicyVersion: string;
  eventPolicyVersion: string;
  ruleVersion: string;
  parserVersion: string;
  normalizationVersion: string;
  costBasisMethod: 'FIFO';
  functionalCurrency: string;
  roundingThresholdMinor: string;
  periodOpen: boolean;
}

export interface CoaRuleDTO {
  eventType: string;
  leg: string;
  account: string;
}

export interface PolicyActiveDTO {
  policySet: ResolvedPolicySetDTO;
  // null = fail-closed: unmapped legs raise MAPPING_MISSING instead of a suspense default.
  coaMapping: { rules: CoaRuleDTO[]; defaultAccount: string | null };
  periodId: string;
}

// ---- Onboarding types ----

export interface OnboardingSourceDTO {
  wallet: string;
  eventCount: number;
  isDemoOwned: boolean;
  ownership: { verified: boolean; verifiedAt?: number };
}

export interface OnboardingDTO {
  entity: {
    id: string;
    displayName: string;
    meta: { functionalCurrency: string; reportingCurrency: string; fiscalCalendar: string; timezone: string } | null;
  };
  sources: OnboardingSourceDTO[];
  unlistedVerified: { wallet: string; verifiedAt: number }[];
}

export interface ChallengeDTO {
  nonce: string;
  message: string;
  expiresAt: number;
  wallet: string;
}

export interface VerifyResultDTO {
  verdict: 'VERIFIED';
  attestation: { wallet: string; verifiedAt: number; verifier: string; templateVersion: string };
}

// ---- Exception-Triage Agent types ----

export interface ProposalDTO {
  id: number;
  exceptionId: string;
  eventId: string;
  entityId: string;
  periodId: string;
  action: 'resolved' | 'deferred' | 'dismissed';
  reasonCode: ReasonCode;
  reasonNote: string | null;
  rationale: string;
  confidence: number;
  status: 'proposed' | 'accepted' | 'rejected' | 'stale';
  model: string;
  createdAt: number;
  decidedBy?: string | null;
  decidedAt?: number | null;
  decisionNote?: string | null;
}

export interface ProposalsResponse {
  proposals: ProposalDTO[];
}
