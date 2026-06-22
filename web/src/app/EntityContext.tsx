import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { EntityDTO } from '../api/types';
import { STEPS, type StepId } from './steps';

interface EntityCtx {
  entity: EntityDTO | null;
  setEntity(e: EntityDTO | null): void;
  step: StepId;
  setStep(s: StepId): void;
  goNext(): void;
  periodId: string;
}

const Ctx = createContext<EntityCtx | null>(null);

export function EntityProvider({ children }: { children: ReactNode }) {
  const [entity, setEntity] = useState<EntityDTO | null>(null);
  const [step, setStep] = useState<StepId>('ingest');
  const periodId = '2026-Q2';

  const value = useMemo<EntityCtx>(() => ({
    entity,
    setEntity,
    step,
    setStep,
    periodId,
    goNext: () => {
      setStep((prev) => {
        const idx = STEPS.findIndex((s) => s.id === prev);
        // Clamp at last step (Anchor) — never advance past it
        const clampedIdx = Math.min(idx + 1, STEPS.length - 1);
        return STEPS[clampedIdx]!.id;
      });
    },
  }), [entity, step]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEntityCtx(): EntityCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEntityCtx must be used within EntityProvider');
  return v;
}
