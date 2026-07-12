import { fetchJson } from './client';
import type {
  EntityDTO, EventDTO, JournalDTO, AnchorDTO, CopilotAdvice,
  SnapshotDTO, PrepareDTO, InclusionProof, PolicyActiveDTO,
  OnboardingDTO, ChallengeDTO, VerifyResultDTO,
  PolicyDocDTO, CoaRuleDTO, PolicyHistoryDTO,
  PricePointDTO, RevaluationPreviewDTO, RevaluationRunResultDTO,
} from './types';

const enc = encodeURIComponent;

// 1. GET /entities
export async function listEntities(): Promise<EntityDTO[]> {
  return (await fetchJson<{ entities: EntityDTO[] }>('/entities')).entities;
}

// 2. POST /entities/:id/ingest
export async function ingest(entityId: string): Promise<{ ingested: number; events: EventDTO[] }> {
  return fetchJson(`/entities/${enc(entityId)}/ingest`, { method: 'POST', body: '{}' });
}

// 3. GET /entities/:id/events
export async function listEvents(entityId: string): Promise<EventDTO[]> {
  return (await fetchJson<{ events: EventDTO[] }>(`/entities/${enc(entityId)}/events`)).events;
}

// 4. POST /events/:id/classify
export async function classifyEvent(eventId: string): Promise<{ event: EventDTO; degraded: boolean }> {
  return fetchJson(`/events/${enc(eventId)}/classify`, { method: 'POST', body: '{}' });
}

// 5. GET /entities/:id/review-queue
export async function reviewQueue(entityId: string): Promise<EventDTO[]> {
  return (await fetchJson<{ events: EventDTO[] }>(`/entities/${enc(entityId)}/review-queue`)).events;
}

// 6. POST /reviews/:eventId/copilot
export async function copilot(eventId: string): Promise<CopilotAdvice> {
  return (await fetchJson<{ advice: CopilotAdvice }>(`/reviews/${enc(eventId)}/copilot`, { method: 'POST', body: '{}' })).advice;
}

// 7. POST /reviews/:eventId/decide
export async function decide(
  eventId: string,
  body: { finalEventType: string; finalPurpose: string },
): Promise<EventDTO> {
  return (await fetchJson<{ event: EventDTO }>(`/reviews/${enc(eventId)}/decide`, {
    method: 'POST', body: JSON.stringify(body),
  })).event;
}

// 8. POST /entities/:id/run-rules
export async function runRules(
  entityId: string,
  periodId: string,
): Promise<{ posted: number; skipped: number; journal: JournalDTO[] }> {
  return fetchJson(`/entities/${enc(entityId)}/run-rules`, {
    method: 'POST', body: JSON.stringify({ periodId }),
  });
}

// 9. GET /entities/:id/journal
export async function getJournal(entityId: string): Promise<JournalDTO[]> {
  return (await fetchJson<{ journal: JournalDTO[] }>(`/entities/${enc(entityId)}/journal`)).journal;
}

// 10. POST /entities/:id/snapshot
export async function snapshot(entityId: string, periodId: string): Promise<SnapshotDTO> {
  return (await fetchJson<{ snapshot: SnapshotDTO }>(`/entities/${enc(entityId)}/snapshot`, {
    method: 'POST', body: JSON.stringify({ periodId }),
  })).snapshot;
}

// 11. POST /entities/:id/anchor/prepare
export async function prepareAnchor(
  entityId: string,
  body: { snapshotId: string; walletAddress: string },
): Promise<PrepareDTO> {
  return fetchJson(`/entities/${enc(entityId)}/anchor/prepare`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

// 12. POST /entities/:id/anchor/confirm
export async function confirmAnchor(
  entityId: string,
  body: { snapshotId: string; digest: string; expectedSeq: number },
): Promise<AnchorDTO> {
  return (await fetchJson<{ anchor: AnchorDTO }>(`/entities/${enc(entityId)}/anchor/confirm`, {
    method: 'POST', body: JSON.stringify(body),
  })).anchor;
}

// 13. GET /entities/:id/anchors?idempotencyKey=<k>
export async function getAnchors(
  entityId: string,
  idempotencyKey?: string,
): Promise<{ anchors: AnchorDTO[]; inclusionProof: InclusionProof | null }> {
  const q = idempotencyKey ? `?idempotencyKey=${enc(idempotencyKey)}` : '';
  return fetchJson(`/entities/${enc(entityId)}/anchors${q}`);
}

// 14. GET /policy/active
export async function getPolicyActive(entityId?: string): Promise<PolicyActiveDTO> {
  return fetchJson<PolicyActiveDTO>(`/policy/active${entityId ? `?entity=${enc(entityId)}` : ''}`);
}

// 14a. PATCH /policy/policy-set
export async function patchPolicySet(body: {
  entity: string; actor: string; reason: string; changes: Partial<PolicyDocDTO>;
}): Promise<{ policyVersion: number; policyDoc: PolicyDocDTO }> {
  return fetchJson('/policy/policy-set', { method: 'PATCH', body: JSON.stringify(body) });
}

// 14b. PUT /policy/coa-mapping
export async function putCoaMapping(body: {
  entity: string; actor: string; reason: string; rules: CoaRuleDTO[];
}): Promise<{ coaVersion: number; ruleVersion: string; policyVersion: number; rules: CoaRuleDTO[] }> {
  return fetchJson('/policy/coa-mapping', { method: 'PUT', body: JSON.stringify(body) });
}

// 14c. GET /policy/history
export async function getPolicyHistory(entityId: string): Promise<PolicyHistoryDTO> {
  return fetchJson(`/policy/history?entity=${enc(entityId)}`);
}

// 15. GET /onboarding/:entityId
export function getOnboarding(entityId: string): Promise<OnboardingDTO> {
  return fetchJson<OnboardingDTO>(`/onboarding/${enc(entityId)}`);
}

// 16. POST /onboarding/challenge
export function postOnboardingChallenge(wallet: string): Promise<ChallengeDTO> {
  return fetchJson<ChallengeDTO>('/onboarding/challenge', { method: 'POST', body: JSON.stringify({ wallet }) });
}

// 17. POST /onboarding/verify
export function postOnboardingVerify(body: { wallet: string; nonce: string; signature: string; connectedAccount: string }): Promise<VerifyResultDTO> {
  return fetchJson<VerifyResultDTO>('/onboarding/verify', { method: 'POST', body: JSON.stringify(body) });
}

// ---- Period-end revaluation (Task 6/11) ----

// 18. GET /entities/:id/prices?coinType=
export async function getPrices(entityId: string, coinType?: string): Promise<PricePointDTO[]> {
  const q = coinType ? `?coinType=${enc(coinType)}` : '';
  return (await fetchJson<{ prices: PricePointDTO[] }>(`/entities/${enc(entityId)}/prices${q}`)).prices;
}

// 19. POST /entities/:id/prices
export function postPrice(
  entityId: string,
  body: { coinType: string; asOf: string; price: string },
): Promise<PricePointDTO> {
  return fetchJson<PricePointDTO>(`/entities/${enc(entityId)}/prices`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

// 20. GET /entities/:id/revaluation/preview?periodId=
export function getRevaluationPreview(entityId: string, periodId: string): Promise<RevaluationPreviewDTO> {
  return fetchJson<RevaluationPreviewDTO>(
    `/entities/${enc(entityId)}/revaluation/preview?periodId=${enc(periodId)}`,
  );
}

// 21. POST /entities/:id/revaluation/run
export function postRevaluationRun(entityId: string, periodId: string): Promise<RevaluationRunResultDTO> {
  return fetchJson<RevaluationRunResultDTO>(`/entities/${enc(entityId)}/revaluation/run`, {
    method: 'POST', body: JSON.stringify({ periodId }),
  });
}
