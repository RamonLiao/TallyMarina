import { useCallback, useEffect, useState } from 'react';
import type { ReconciliationResponse } from '../api/types';
import { API_BASE } from '../api/client';

export function useReconciliation(entityId: string | null) {
  const [data, setData] = useState<ReconciliationResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const refetch = useCallback(async () => {
    if (!entityId) return;
    setLoading(true); setError(undefined);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(entityId)}/reconciliation`);
      if (!res.ok) throw new Error(`reconciliation ${res.status}`);
      setData(await res.json() as ReconciliationResponse);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [entityId]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}
