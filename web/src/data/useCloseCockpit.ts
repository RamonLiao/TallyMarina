import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloseCockpitResponse } from '../api/types';
import { API_BASE } from '../api/client';

export function useCloseCockpit(entityId: string | null) {
  const [data, setData] = useState<CloseCockpitResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const genRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!entityId) return;
    const gen = ++genRef.current;
    setLoading(true); setError(undefined);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/close-cockpit`);
      if (!res.ok) throw new Error(`close-cockpit ${res.status}`);
      const json = await res.json() as CloseCockpitResponse;
      if (gen === genRef.current) setData(json);
    } catch (e) {
      if (gen === genRef.current) setError((e as Error).message);
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}
