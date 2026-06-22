export type StepId = 'ingest' | 'classify' | 'review' | 'journal' | 'anchor';

export const STEPS: { id: StepId; label: string; n: number }[] = [
  { id: 'ingest', label: 'Ingest', n: 1 },
  { id: 'classify', label: 'Classify', n: 2 },
  { id: 'review', label: 'Review', n: 3 },
  { id: 'journal', label: 'Journal', n: 4 },
  { id: 'anchor', label: 'Anchor', n: 5 },
];
