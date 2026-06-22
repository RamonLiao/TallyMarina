import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EntityProvider } from '../app/EntityContext';
import { ReviewStep } from './ReviewStep';
import * as endpoints from '../api/endpoints';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><EntityProvider>{ui}</EntityProvider></QueryClientProvider>;
}
const ev = {
  id: 'e9', entityId: 'acme:pilot-001', status: 'NEEDS_REVIEW' as const,
  normalized: { coinType: '0x2::sui::SUI' },
  ai: { eventType: 'DIGITAL_ASSET_PAYMENT', purpose: 'VENDOR_PAYMENT', counterparty: '0xcp', confidence: 0.6, reasoning: 'low signal' },
  final: null, routing: 'NEEDS_REVIEW' as const,
};

it('asks the copilot and renders red flags, then approves', async () => {
  // seed entity so ctx has an id
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'reviewQueue').mockResolvedValue([ev]);
  vi.spyOn(endpoints, 'copilot').mockResolvedValue({
    explanation: 'Looks like a vendor payment.',
    redFlags: ['Counterparty not in vendor list'],
    suggestedEntry: { lines: [{ account: 'Expense', side: 'DEBIT', amountMinor: '100' }, { account: 'Cash', side: 'CREDIT', amountMinor: '100' }] },
    citations: ['policy:AP-1'],
  });
  vi.spyOn(endpoints, 'decide').mockResolvedValue({ ...ev, status: 'APPROVED', final: { eventType: 'DIGITAL_ASSET_PAYMENT', purpose: 'VENDOR_PAYMENT' } });

  render(wrap(<ReviewStep />));
  await screen.findByText('e9');
  await userEvent.click(screen.getByRole('button', { name: /ask copilot/i }));
  await screen.findByText('Counterparty not in vendor list');
  await userEvent.click(screen.getByRole('button', { name: /approve/i }));
  await waitFor(() => expect(endpoints.decide).toHaveBeenCalled());
});

// KEY TEST: avatar pose maps to hook state (isPending → thinking) — must fail if mapping breaks
it('avatar pose is "thinking" while copilot isPending, "confident" after advice, "raising-hand" before ask', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'reviewQueue').mockResolvedValue([ev]);

  let resolveAdvice!: (v: import('../api/types').CopilotAdvice) => void;
  vi.spyOn(endpoints, 'copilot').mockReturnValue(new Promise((res) => { resolveAdvice = res; }));

  render(wrap(<ReviewStep />));
  await screen.findByText('e9');

  // Before asking: raising-hand (NEEDS_REVIEW default)
  expect(screen.getByRole('img', { name: /raising hand/i })).toBeInTheDocument();

  // Click ask — while pending: thinking
  await userEvent.click(screen.getByRole('button', { name: /ask copilot/i }));
  await waitFor(() => expect(screen.getByRole('img', { name: /thinking/i })).toBeInTheDocument());

  // Resolve — after advice: confident
  resolveAdvice({
    explanation: 'OK', redFlags: [], suggestedEntry: null, citations: [],
  });
  await waitFor(() => expect(screen.getByRole('img', { name: /confident/i })).toBeInTheDocument());
});

// KEY TEST: "Adopt" only pre-fills the form, does NOT call decide
it('Adopt AI draft pre-fills form fields and does NOT call decide', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'reviewQueue').mockResolvedValue([ev]);
  vi.spyOn(endpoints, 'copilot').mockResolvedValue({
    explanation: 'Vendor payment.',
    redFlags: [],
    suggestedEntry: { lines: [{ account: 'Expense', side: 'DEBIT', amountMinor: '50' }] },
    citations: [],
  });
  const decideSpy = vi.spyOn(endpoints, 'decide').mockResolvedValue({ ...ev, status: 'APPROVED', final: { eventType: 'DIGITAL_ASSET_PAYMENT', purpose: 'VENDOR_PAYMENT' } });

  render(wrap(<ReviewStep />));
  await screen.findByText('e9');
  await userEvent.click(screen.getByRole('button', { name: /ask copilot/i }));
  await screen.findByText('Vendor payment.');

  // Click Adopt — form gets pre-filled but decide NOT called
  await userEvent.click(screen.getByRole('button', { name: /adopt ai draft/i }));
  expect(decideSpy).not.toHaveBeenCalled();

  // Fields should now reflect ai values (pre-filled, not empty)
  const inputs = screen.getAllByRole('textbox');
  const values = inputs.map((i) => (i as HTMLInputElement).value);
  expect(values.some((v) => v.length > 0)).toBe(true);
});

// KEY TEST: Approve calls useDecide with human-entered values (AI has no direct posting path)
it('Approve calls decide with human-entered final values, not AI values', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'reviewQueue').mockResolvedValue([ev]);
  const decideSpy = vi.spyOn(endpoints, 'decide').mockResolvedValue({ ...ev, status: 'APPROVED', final: { eventType: 'HUMAN_TYPE', purpose: 'HUMAN_PURPOSE' } });

  render(wrap(<ReviewStep />));
  await screen.findByText('e9');

  // Clear and type human-entered values
  const [eventTypeInput, purposeInput] = screen.getAllByRole('textbox') as HTMLInputElement[];
  await userEvent.clear(eventTypeInput!);
  await userEvent.type(eventTypeInput!, 'HUMAN_TYPE');
  await userEvent.clear(purposeInput!);
  await userEvent.type(purposeInput!, 'HUMAN_PURPOSE');

  await userEvent.click(screen.getByRole('button', { name: /approve/i }));

  await waitFor(() => expect(decideSpy).toHaveBeenCalledWith(
    'e9',
    { finalEventType: 'HUMAN_TYPE', finalPurpose: 'HUMAN_PURPOSE' }
  ));
});

// AI-unavailable/degraded: copilot error surfaces gracefully
it('surfaces gracefully when copilot call fails', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'reviewQueue').mockResolvedValue([ev]);
  vi.spyOn(endpoints, 'copilot').mockRejectedValue(new Error('Gemini unavailable'));

  render(wrap(<ReviewStep />));
  await screen.findByText('e9');
  await userEvent.click(screen.getByRole('button', { name: /ask copilot/i }));

  // Decide form still present — human can still approve without AI
  await waitFor(() => expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument());
  // No crash, no red-flags rendered
  expect(screen.queryByText(/red flags/i)).toBeNull();
});

// Empty queue renders "queue clear" message
it('renders queue-clear message when reviewQueue is empty', async () => {
  vi.spyOn(endpoints, 'listEntities').mockResolvedValue([{ id: 'acme:pilot-001', displayName: 'Acme', chainObjectId: '0x1', capObjectId: '0x2', originalPackageId: '0x3' }]);
  vi.spyOn(endpoints, 'reviewQueue').mockResolvedValue([]);

  render(wrap(<ReviewStep />));
  await screen.findByText(/review queue clear/i);
  expect(screen.getByRole('button', { name: /post the journal/i })).toBeInTheDocument();
});
