import { useCallback, useEffect, useRef, useState } from 'react';
import type { JournalDTO, EventDTO, PolicyActiveDTO } from '../api/types';
import { getJournal, listEvents, getPolicyActive } from '../api/endpoints';

interface PolicyValue {
  policy: PolicyActiveDTO;
  journal: JournalDTO[];
  events: EventDTO[];
}

interface FetchedState {
  entityId: string;
  value?: PolicyValue;
  error?: string;
}

export function usePolicyData(entityId: string) {
  // Store fetched payload paired with the entityId it was fetched FOR.
  // Render-time gate (state.entityId === entityId) ensures the exposed data
  // always belongs to the current entity, even if a prior-entity in-flight fetch
  // resolves late. No post-commit effect can close this race; only a same-render
  // check can.
  const [state, setState] = useState<FetchedState>(() => ({ entityId }));
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!entityId) return;
    const capturedEntityId = entityId;
    const gen = ++genRef.current;
    setLoading(true);
    setState((prev) => ({ ...prev, error: undefined }));
    try {
      const [policy, journal, events] = await Promise.all([
        getPolicyActive(),
        getJournal(capturedEntityId),
        listEvents(capturedEntityId),
      ]);
      if (gen === genRef.current) {
        setState({ entityId: capturedEntityId, value: { policy, journal, events } });
      }
    } catch (e) {
      if (gen === genRef.current) {
        setState({ entityId: capturedEntityId, error: (e as Error).message });
      }
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Render-time gate: expose data/error only when the stored entityId matches
  // the current entityId. This fires on every render so the moment entityId
  // changes the consumer sees undefined data — no stale frame, no effect delay.
  const data = state.entityId === entityId ? state.value : undefined;
  const error = state.entityId === entityId ? state.error : undefined;

  return { data, loading, error, refetch };
}
