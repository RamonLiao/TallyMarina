import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloseCockpitResponse } from '../api/types';
import { API_BASE } from '../api/client';

interface FetchedState {
  entityId: string | null;
  data?: CloseCockpitResponse;
  error?: string;
}

export function useCloseCockpit(entityId: string | null) {
  // Store fetched payload paired with the entityId it was fetched FOR.
  // WHY: render-time gate (state.entityId === entityId) is the ONLY guarantee
  // we need — it ensures the exposed data always belongs to the current entity,
  // even if a prior-entity in-flight fetch resolves late. No post-commit effect
  // can close this race; only a same-render check can.
  const [state, setState] = useState<FetchedState>(() => ({ entityId }));
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!entityId) return;
    const capturedEntityId = entityId;
    const gen = ++genRef.current;
    setLoading(true);
    setState(prev => ({ ...prev, error: undefined }));
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(capturedEntityId)}/close-cockpit`);
      if (!res.ok) throw new Error(`close-cockpit ${res.status}`);
      const json = await res.json() as CloseCockpitResponse;
      if (gen === genRef.current) {
        setState({ entityId: capturedEntityId, data: json });
      }
    } catch (e) {
      if (gen === genRef.current) {
        setState({ entityId: capturedEntityId, error: (e as Error).message });
      }
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Render-time gate: expose data/error only when the stored entityId matches
  // the current entityId. This fires on every render so the moment entityId
  // changes the consumer sees undefined data — no stale frame, no effect delay.
  const data = state.entityId === entityId ? state.data : undefined;
  const error = state.entityId === entityId ? state.error : undefined;

  return { data, loading, error, refetch };
}
