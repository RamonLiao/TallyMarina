// Pure compare-matrix builder (Rule 5: deterministic). Audit-useful dimensions
// (spec §5 / accountant 3.1): not cosmetic leg-count, but control-consistency.
import type { EventDTO, JournalDTO } from '../api/types';
import { sumFunctional } from './balance';

const CAP = 4;

export interface MatrixDim { key: string; label: string; cells: string[]; differs: boolean }
export interface Matrix { dimensions: MatrixDim[]; shown: EventDTO[]; truncated: number }

function jesFor(journal: JournalDTO[], eventId: string): JournalDTO[] {
  return journal.filter((j) => j.eventId === eventId);
}

export function buildMatrix(events: EventDTO[], journal: JournalDTO[]): Matrix {
  const shown = events.slice(0, CAP);
  const truncated = Math.max(0, events.length - CAP);

  const cellsFor = (fn: (e: EventDTO) => string): { cells: string[]; differs: boolean } => {
    const cells = shown.map(fn);
    const differs = new Set(cells).size > 1;
    return { cells, differs };
  };

  const eventType = cellsFor((e) => e.final?.eventType ?? e.ai?.eventType ?? '—');
  const confidence = cellsFor((e) => (e.ai?.confidence == null ? '—' : e.ai.confidence >= 0.85 ? 'AUTO' : 'REVIEW'));
  const accountSet = cellsFor((e) => {
    const accts = jesFor(journal, e.id).flatMap((j) => j.je.lines.map((l) => l.account));
    return [...new Set(accts)].sort().join(',') || '—';
  });
  const balanced = cellsFor((e) => {
    const jes = jesFor(journal, e.id);
    if (jes.length === 0) return '—';
    return jes.every((j) => sumFunctional(j.je.lines).balanced) ? 'balanced' : 'UNBALANCED';
  });
  const anchorStatus = cellsFor((e) => (jesFor(journal, e.id).length > 0 ? 'posted' : 'unposted'));

  return {
    shown,
    truncated,
    dimensions: [
      { key: 'eventType', label: 'AI type', ...eventType },
      { key: 'confidence', label: 'Confidence', ...confidence },
      { key: 'accountSet', label: 'Account set', ...accountSet },
      { key: 'balanced', label: 'Balanced', ...balanced },
      { key: 'anchorStatus', label: 'Posted', ...anchorStatus },
    ],
  };
}
