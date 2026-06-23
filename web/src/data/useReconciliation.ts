import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReconciliationResponse } from '../api/types';
import { API_BASE } from '../api/client';

export function useReconciliation(entityId: string | null) {
  const [data, setData] = useState<ReconciliationResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  // Tracks the current request generation so stale resolutions are dropped.
  const genRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!entityId) return;
    const gen = ++genRef.current;
    setLoading(true); setError(undefined);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/reconciliation`);
      if (!res.ok) throw new Error(`reconciliation ${res.status}`);
      const json = await res.json() as ReconciliationResponse;
      if (gen === genRef.current) setData(json);
    } catch (e) {
      if (gen === genRef.current) setError((e as Error).message);
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
