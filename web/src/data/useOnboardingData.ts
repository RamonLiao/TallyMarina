import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnboardingDTO } from '../api/types';
import { getOnboarding } from '../api/endpoints';

interface FetchedState { entityId: string; value?: OnboardingDTO; error?: string }

export function useOnboardingData(entityId: string) {
  const [state, setState] = useState<FetchedState>(() => ({ entityId }));
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!entityId) return;
    const captured = entityId;
    const gen = ++genRef.current;
    setLoading(true);
    setState((prev) => ({ ...prev, error: undefined }));
    try {
      const value = await getOnboarding(captured);
      if (gen === genRef.current) setState({ entityId: captured, value });
    } catch (e) {
      if (gen === genRef.current) setState({ entityId: captured, error: (e as Error).message });
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Render-time cross-key gate: expose only data fetched FOR the current entity.
  const data = state.entityId === entityId ? state.value : undefined;
  const error = state.entityId === entityId ? state.error : undefined;
  return { data, loading, error, refetch };
}
