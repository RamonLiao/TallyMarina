import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloseCockpitResponse } from '../api/types';
import { API_BASE } from '../api/client';

interface FetchedState {
  entityId: string | null;
  periodId: string;
  data?: CloseCockpitResponse;
  error?: string;
}

export function useCloseCockpit(entityId: string | null, periodId: string) {
  // Store fetched payload paired with the (entityId, periodId) it was fetched FOR.
  // WHY: render-time gate (state.entityId === entityId && state.periodId === periodId)
  // is the ONLY guarantee we need — it ensures the exposed data always belongs to the
  // current entity AND period, even if a prior in-flight fetch resolves late. No
  // post-commit effect can close this race; only a same-render check can.
  const [state, setState] = useState<FetchedState>(() => ({ entityId, periodId }));
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);

  const refetch = useCallback(async () => {
    // periodId is REQUIRED by the backend (400 PERIOD_ID_REQUIRED) — never fire without it.
    if (!entityId || !periodId) return;
    const capturedEntityId = entityId;
    const capturedPeriodId = periodId;
    const gen = ++genRef.current;
    setLoading(true);
    setState(prev => ({ ...prev, error: undefined }));
    try {
      const res = await fetch(
        `${API_BASE}/entities/${encodeURIComponent(capturedEntityId)}/close-cockpit?periodId=${encodeURIComponent(capturedPeriodId)}`,
      );
      if (!res.ok) throw new Error(`close-cockpit ${res.status}`);
      const json = await res.json() as CloseCockpitResponse;
      if (gen === genRef.current) {
        setState({ entityId: capturedEntityId, periodId: capturedPeriodId, data: json });
      }
    } catch (e) {
      if (gen === genRef.current) {
        setState({ entityId: capturedEntityId, periodId: capturedPeriodId, error: (e as Error).message });
      }
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [entityId, periodId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Render-time gate: expose data/error only when the stored (entityId, periodId)
  // matches the current pair. This fires on every render so the moment either
  // changes the consumer sees undefined data — no stale frame, no effect delay.
  const fresh = state.entityId === entityId && state.periodId === periodId;
  const data = fresh ? state.data : undefined;
  const error = fresh ? state.error : undefined;

  return { data, loading, error, refetch };
}
