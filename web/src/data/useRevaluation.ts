import { useCallback, useEffect, useRef, useState } from 'react';
import type { RevaluationPreviewDTO } from '../api/types';
import { getRevaluationPreview, postRevaluationRun } from '../api/endpoints';

interface FetchedState {
  entityId: string | null;
  periodId: string;
  value?: RevaluationPreviewDTO;
  error?: string;
}

// Task 11: data layer for period-end revaluation (spec §6). Modeled on usePolicyData's
// render-time gate — data/error are only exposed when the stored (entityId, periodId)
// still matches the current pair, so a late-resolving fetch from a prior period/entity
// can never flash stale numbers into the UI.
export function useRevaluation(entityId: string | null, periodId: string) {
  const [state, setState] = useState<FetchedState>(() => ({ entityId, periodId }));
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runPending, setRunPending] = useState(false);
  const genRef = useRef(0);

  const recompute = useCallback(async () => {
    if (!entityId || !periodId) return;
    const capturedEntityId = entityId;
    const capturedPeriodId = periodId;
    const gen = ++genRef.current;
    setPreviewLoading(true);
    setState((prev) => ({ ...prev, error: undefined }));
    try {
      const preview = await getRevaluationPreview(capturedEntityId, capturedPeriodId);
      if (gen === genRef.current) {
        setState({ entityId: capturedEntityId, periodId: capturedPeriodId, value: preview });
      }
    } catch (e) {
      if (gen === genRef.current) {
        setState({ entityId: capturedEntityId, periodId: capturedPeriodId, error: (e as Error).message });
      }
    } finally {
      if (gen === genRef.current) setPreviewLoading(false);
    }
  }, [entityId, periodId]);

  useEffect(() => {
    void recompute();
  }, [recompute]);

  // Render-time gate — see useCloseCockpit/usePolicyData for the same pattern & rationale.
  const fresh = state.entityId === entityId && state.periodId === periodId;
  const preview = fresh ? state.value : undefined;
  const error = fresh ? state.error : undefined;

  // Throws on API error (caller renders the message — never swallow), same contract as
  // usePolicyData's mutations. On success, refetches the preview so the UI reflects the
  // just-run valuation immediately. Does NOT refetch the close cockpit itself — the
  // 'stale' revaluation light only clears once the caller also refetches cockpit data
  // (wired by the UI card in the next task).
  const run = useCallback(async () => {
    if (!entityId || !periodId) return;
    setRunPending(true);
    try {
      await postRevaluationRun(entityId, periodId);
      await recompute();
    } finally {
      setRunPending(false);
    }
  }, [entityId, periodId, recompute]);

  return { preview, previewLoading, error, recompute, run, runPending };
}
