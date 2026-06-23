// DATA ZONE (spec §8.4) — NEVER import Mascot here. The four-stage forensic walkthrough.
import type { EventDTO, JournalDTO, JournalLine } from '../../api/types';
import { ConfidenceBar } from './ConfidenceBar';
import { JournalTable } from './JournalTable';
import { ProofBadge } from './ProofBadge';
import { sumFunctional, origMemo } from '../../lib/balance';

const ARROW = '→'; // mirrors HashChain's mono arrow (rotates to ↓ via CSS on stacked layouts)

function StageCard({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="card audit-stage" style={{ flex: 1, minWidth: 0 }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{n}</div>
      <h4 style={{ margin: '2px 0 var(--s-3)' }}>{title}</h4>
      {children}
    </div>
  );
}

function Pending({ label }: { label: string }) {
  return <div className="mono" style={{ fontSize: 13, color: 'var(--ink-soft)' }}>◌ {label}</div>;
}

function RefRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mono" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
      {label} <span style={{ color: 'var(--ink)' }}>{value}</span> · <em>unresolved pointer</em>
    </div>
  );
}

function BalanceFooter({ lines }: { lines: JournalLine[] }) {
  const b = sumFunctional(lines);
  const memo = origMemo(lines);
  return (
    <div className="mono" style={{ fontSize: 13, marginTop: 'var(--s-2)' }}>
      <span>Σ DR {b.functionalDebit.toString()} · Σ CR {b.functionalCredit.toString()} · </span>
      <span style={{ color: b.balanced ? 'var(--credit)' : 'var(--debit)', fontWeight: 600 }}>
        Δ {b.delta.toString()} {b.balanced ? '✓' : '✗'}
      </span>
      {Object.keys(memo).length > 0 && (
        <div style={{ color: 'var(--ink-soft)' }}>
          memo (orig ccy, not part of balance): {Object.entries(memo).map(([c, q]) => `${c}:${q.toString()}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

export function EventLineage({ event, entityId, journal }: { event: EventDTO; entityId: string; journal: JournalDTO[] }) {
  const jes = journal.filter((j) => j.eventId === event.id);
  // reverse index: which JE (if any) reverses one of this event's JEs
  const reversedBy = (key: string) => journal.find((j) => j.je.reversalOf === key);

  return (
    <div className="audit-lineage" style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'stretch' }}>
      {/* ① RAW */}
      <StageCard n="①" title="Raw event">
        <pre className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
          {JSON.stringify(event.normalized, null, 2)}
        </pre>
      </StageCard>
      <span aria-hidden className="audit-arrow mono" style={{ alignSelf: 'center', color: 'var(--brass)' }}>{ARROW}</span>

      {/* ② AI */}
      <StageCard n="②" title="Classification">
        {event.ai === null ? (
          <Pending label="awaiting classification" />
        ) : (
          <>
            <div style={{ fontSize: 13 }}>{event.ai.eventType} · {event.ai.purpose}</div>
            <div style={{ margin: 'var(--s-2) 0' }}><ConfidenceBar confidence={event.ai.confidence} compact /></div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>AI opinion — backend assertion, not evidence</div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 'var(--s-2)' }}>{event.ai.reasoning}</div>
          </>
        )}
      </StageCard>
      <span aria-hidden className="audit-arrow mono" style={{ alignSelf: 'center', color: 'var(--brass)' }}>{ARROW}</span>

      {/* ③ JE */}
      <StageCard n="③" title="Journal entry">
        {jes.length === 0 ? (
          <Pending label="not yet posted" />
        ) : (
          jes.map((j) => (
            <div key={j.id} style={{ marginBottom: 'var(--s-3)' }}>
              {j.je.reversalOf && (
                <div style={{ fontSize: 11, color: 'var(--brass)', fontWeight: 600 }}>REVERSAL OF → {j.je.reversalOf}</div>
              )}
              {reversedBy(j.idempotencyKey) && (
                <div style={{ fontSize: 11, color: 'var(--brass)', fontWeight: 600 }}>REVERSED BY ← {reversedBy(j.idempotencyKey)!.idempotencyKey}</div>
              )}
              <JournalTable journal={[j]} />
              <BalanceFooter lines={j.je.lines} />
              {j.je.lines.map((l, i) => (
                <div key={i}>
                  <RefRow label="priceRef" value={l.priceRef} />
                  <RefRow label="fxRef" value={l.fxRef} />
                </div>
              ))}
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>rule version not retained in journal (deferred §11)</div>
            </div>
          ))
        )}
      </StageCard>
      <span aria-hidden className="audit-arrow mono" style={{ alignSelf: 'center', color: 'var(--brass)' }}>{ARROW}</span>

      {/* ④ CHAIN (austere) */}
      <div className="austere audit-stage" style={{ flex: 1, minWidth: 0, padding: 'var(--s-4)' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--austere-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>④</div>
        <h4 className="mono" style={{ margin: '2px 0 var(--s-3)', color: 'var(--austere-mono)' }}>On-chain anchor</h4>
        {jes.length === 0 ? (
          <div className="mono" style={{ fontSize: 13, color: 'var(--austere-dim)' }}>◌ not yet anchored</div>
        ) : (
          jes.map((j) => (
            <ProofBadge key={j.id} leafHash={j.leafHash} idempotencyKey={j.idempotencyKey} lineageHash={j.je.lineageHash} entityId={entityId} />
          ))
        )}
      </div>
    </div>
  );
}
