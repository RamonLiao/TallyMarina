import { fetchJson } from './client';
import type {
  EntityDTO, EventDTO, JournalDTO, AnchorDTO, CopilotAdvice,
  SnapshotDTO, PrepareDTO, InclusionProof, PolicyActiveDTO,
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
export async function getPolicyActive(): Promise<PolicyActiveDTO> {
  return fetchJson<PolicyActiveDTO>('/policy/active');
}
