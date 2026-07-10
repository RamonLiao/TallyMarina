// web/src/workspaces/export/ExportWorkspace.tsx
// CHROME+DATA hybrid — mascot allowed only in empty-state zone (§8.4).
import { useState, useCallback } from 'react';
import { useEntityCtx } from '../../app/EntityContext';
import { useWorkspace } from '../../app/WorkspaceContext';
import { useExportData } from '../../data/useExportData';
import { useCloseCockpit } from '../../data/useCloseCockpit';
import { assembleExport } from './assembleExport';
import type { ExportOutcome } from './assembleExport';
import type { BundleSummary } from './buildBundle';
import { getAnchors } from '../../api/endpoints';
import { EmptyState } from '../../components/chrome/EmptyState';
import './export.css';

// ── functionalCurrency / scale — demo policy constant ─────────────────────
// These mirror the backend's demo policy constant in services/api/src/http/buildRuleInput.ts
// (line ~24, demo-ps-1 policy): functionalCurrency='USD', scale=2 (USD minor units = cents).
// This is intentional — EntityDTO does not carry per-entity currency config, and no policy
// endpoint exists yet. Using USD/2 here is correct and consistent with the sole backend value.
// Named DEMO_* to be explicit: these are not runtime fallbacks but hardcoded demo constants.
// Per-entity / multi-currency policy is deferred to §11 (real policy endpoint).
const DEMO_FUNCTIONAL_CURRENCY = 'USD';
const DEMO_SCALE = 2;

// ── Period selector ───────────────────────────────────────────────────────
// The app currently hard-codes a single period ('2026-Q2' from EntityContext).
// A real multi-period selector can replace this control when the context supports it.
function PeriodDisplay({ periodId }: { periodId: string }) {
  return (
    <div className="export-period-display">
      <span className="export-period-label">Period</span>
      <span className="export-period-id mono">{periodId}</span>
    </div>
  );
}

// ── Self-verification summary ─────────────────────────────────────────────
function SelfVerifySummary({
  summary,
  verified,
}: {
  summary: BundleSummary;
  verified: boolean;
}) {
  return (
    <div data-testid="self-verify-summary" className="export-self-verify mono">
      <div className="export-self-verify__row">
        <span>✓</span>
        <span>
          {summary.jeCount} JE · {summary.legCount} legs
        </span>
      </div>
      <div className="export-self-verify__row">
        <span>✓</span>
        <span>
          Debits = Credits ✓ ({summary.totalDebit} = {summary.totalCredit})
        </span>
      </div>
      {verified && (
        <>
          <div className="export-self-verify__row">
            <span>✓</span>
            <span>
              merkleRoot matches ✓
            </span>
          </div>
          {summary.leavesBound != null && (
            <div className="export-self-verify__row">
              <span>✓</span>
              <span>{summary.leavesBound} leaves bound ✓</span>
            </div>
          )}
          {summary.proofsVerified != null && (
            <div className="export-self-verify__row">
              <span>✓</span>
              <span>{summary.proofsVerified} proofs verified ✓</span>
            </div>
          )}
          {summary.bundledJeCount != null && summary.anchoredLeafCount != null && (
            <div className="export-self-verify__row">
              <span>✓</span>
              <span>
                bundledJeCount={summary.bundledJeCount} = anchoredLeafCount={summary.anchoredLeafCount} ✓
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Verified card ─────────────────────────────────────────────────────────
function VerifiedCard({
  summary,
  merkleRoot,
  explorerUrl,
}: {
  summary: BundleSummary;
  merkleRoot?: string;
  explorerUrl?: string;
}) {
  return (
    <div data-testid="verified-card" className="austere export-status-card">
      <div className="export-status-card__head">
        <span className="export-status-badge export-status-badge--verified">TAMPER-EVIDENT</span>
        <span className="export-status-card__label">On-chain anchored · Merkle-verified</span>
      </div>
      {merkleRoot && (
        <div className="export-merkle-row">
          <span className="export-merkle-label mono">merkleRoot</span>
          <span
            data-testid="merkle-root"
            className="mono export-merkle-hash"
            style={{ overflowWrap: 'anywhere', wordBreak: 'break-all' }}
          >
            {merkleRoot}
          </span>
          {explorerUrl && (
            <a
              data-testid="explorer-link"
              href={explorerUrl}
              className="aqua-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              ↗ explorer
            </a>
          )}
        </div>
      )}
      <SelfVerifySummary summary={summary} verified />
    </div>
  );
}

// ── Draft card ────────────────────────────────────────────────────────────
function DraftCard({ summary }: { summary: BundleSummary }) {
  return (
    <div data-testid="draft-card" className="card export-status-card export-draft-card">
      <div className="export-status-card__head">
        <span data-testid="draft-marker" className="export-status-badge export-status-badge--draft">
          ⚠ DRAFT
        </span>
        <span className="export-status-card__label">Not anchored on-chain</span>
      </div>
      <div className="light--red export-draft-warn">
        <span className="mono">🔓 NOT TAMPER-EVIDENT</span>
        <p className="export-draft-note">
          This period has not been anchored on-chain. The export is not cryptographically
          tamper-evident and cannot be independently verified.
        </p>
      </div>
      <SelfVerifySummary summary={summary} verified={false} />
    </div>
  );
}

// ── Stale-restatement disclosure card (C-F3) ────────────────────────────────
function StaleRestatementCard({
  anchoredSeq,
  latestSnapshotSeq,
}: {
  anchoredSeq: number;
  latestSnapshotSeq: number;
}) {
  return (
    <div data-testid="stale-restatement-card" className="card light--red export-status-card">
      <div className="export-status-card__head">
        <span className="export-status-badge">⚠ RESTATEMENT IN PROGRESS</span>
      </div>
      <p className="export-imbalance-msg">
        <strong>
          Restatement in progress — on-chain anchor corresponds to superseded v{anchoredSeq}; re-anchor
          v{latestSnapshotSeq} before distributing.
        </strong>
      </p>
    </div>
  );
}

// ── Unregistered-assets block card ──────────────────────────────────────────
// A genuine blocker (red): an asset with no registered scale cannot be exported, because a
// quantity at an unknown scale entering an ERP is read at *some* scale. Lists the offending
// coinTypes and routes to the registry so the user can fix it. Calls useWorkspace() — rendered
// only on the 'unregistered' outcome, so it must sit under a WorkspaceProvider.
function UnregisteredAssetsCard({ coinTypes }: { coinTypes: string[] }) {
  const { setWorkspace } = useWorkspace();
  return (
    <div data-testid="unregistered-assets-card" className="card light--red export-status-card">
      <div className="export-status-card__head">
        <span className="export-status-badge">⛔ UNREGISTERED ASSETS</span>
      </div>
      <p className="export-imbalance-msg">
        <strong>Cannot export — {coinTypes.length} asset(s) have no registered decimals.</strong>
      </p>
      <div className="mono export-asset-list">
        {coinTypes.map((ct) => (
          <span key={ct}>{ct}</span>
        ))}
      </div>
      <button
        type="button"
        data-testid="register-assets-link"
        className="export-register-link"
        onClick={() => setWorkspace('onboarding')}
      >
        Register assets →
      </button>
    </div>
  );
}

// ── Manual-source disclosure card (NOT red — a disclosure, not a defect) ─────
// Surfaces assets whose decimals a human declared rather than the chain verifying. Brass, never
// red: red would nudge an operator to fabricate a chain value under close pressure (V7).
function ManualDisclosureCard({ coinTypes }: { coinTypes: string[] }) {
  return (
    <div data-testid="manual-disclosure-card" className="card export-status-card export-manual-disclosure">
      <div className="export-status-card__head">
        <span className="export-status-badge export-manual-badge">ⓘ SOURCE DISCLOSURE</span>
      </div>
      <p className="export-disclosure-note">
        {coinTypes.length} asset(s) 為人工宣稱的 decimals（未經鏈上驗證）。These export correctly;
        this is a disclosure of provenance, not a defect.
      </p>
      <div className="mono export-asset-list">
        {coinTypes.map((ct) => (
          <span key={ct}>{ct}</span>
        ))}
      </div>
    </div>
  );
}

// ── Imbalance card ────────────────────────────────────────────────────────
function ImbalanceCard({ debit, credit }: { debit: string; credit: string }) {
  const delta = (BigInt(debit) - BigInt(credit)).toString();
  return (
    <div data-testid="imbalance-card" className="card light--red export-status-card">
      <div className="export-status-card__head">
        <span className="export-status-badge">⛔ IMBALANCE</span>
      </div>
      <p className="export-imbalance-msg">
        <strong>Cannot export — books do not balance.</strong>
      </p>
      <div className="mono export-imbalance-detail">
        <div>Debits:&nbsp;&nbsp;{debit}</div>
        <div>Credits:&nbsp;{credit}</div>
        <div className="export-imbalance-delta">Delta:&nbsp;&nbsp;&nbsp;{delta}</div>
      </div>
      <p className="export-imbalance-hint">
        Correct the journal entries so debits equal credits, then retry.
      </p>
    </div>
  );
}

// ── Filename preview ──────────────────────────────────────────────────────
function FilenamePreview({ filename }: { filename: string }) {
  return (
    <span className="mono export-filename-preview" aria-label={`File: ${filename}`}>
      {filename}
    </span>
  );
}

// ── Main workspace ────────────────────────────────────────────────────────
export function ExportWorkspace({ entityId }: { entityId: string }) {
  const { entity, periodId } = useEntityCtx();
  const { data, loading, error } = useExportData(entityId);
  const { data: cockpitData } = useCloseCockpit(entityId, periodId);
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);

  const journal = data?.journal ?? [];
  const events = data?.events ?? [];
  const anchors = data?.anchors ?? [];
  const policySetVersion = data?.policySetVersion ?? null;

  const handlePreview = useCallback(async () => {
    if (!data) return;
    setAssembling(true);
    setAssembleError(null);
    setOutcome(null);
    try {
      const result = await assembleExport({
        entityId,
        periodId,
        functionalCurrency: DEMO_FUNCTIONAL_CURRENCY,
        scale: DEMO_SCALE,
        generatedAt: new Date().toISOString(),
        journal,
        events,
        anchors,
        fetchProof: async (idempotencyKey) => {
          const res = await getAnchors(entityId, idempotencyKey);
          return { anchors: res.anchors, inclusionProof: res.inclusionProof ?? null };
        },
        policySetVersion,
        anchorStaleness: cockpitData?.anchorStaleness ?? null,
      });
      setOutcome(result);
    } catch (e) {
      setAssembleError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssembling(false);
    }
  }, [data, entityId, periodId, cockpitData]);

  const handleDownload = useCallback(() => {
    if (!outcome || !outcome.ok) return;
    const blob = new Blob([outcome.zip.buffer as ArrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outcome.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [outcome]);

  // Empty journal — no need for preview CTA
  if (!loading && data && journal.length === 0) {
    return (
      <div data-testid="empty-export-state" className="export-workspace">
        <header className="export-header">
          <p className="export-purpose">Download a tamper-evident ZIP of this period's journal entries.</p>
          {entity && <p className="export-entity-subhead">{entity.displayName}</p>}
        </header>
        <EmptyState
          title="Nothing to export"
          body="No journal entries found for this period. Ingest and journal events first."
        />
      </div>
    );
  }

  const canPreview = !!data && !loading && !assembling;
  const isImbalance = outcome && !outcome.ok && outcome.kind === 'imbalance';
  const isEmpty = outcome && !outcome.ok && (outcome as { kind: string }).kind === 'empty';
  const isStaleRestatement = outcome && !outcome.ok && (outcome as { kind: string }).kind === 'stale-restatement';
  const isUnregistered = outcome && !outcome.ok && (outcome as { kind: string }).kind === 'unregistered';
  // ?? [] guards runtime shapes (e.g. test mocks) that omit manualAssets; not a decimals default.
  const manualAssets = outcome?.ok ? (outcome.manualAssets ?? []) : [];
  const downloadEnabled = outcome?.ok === true && !isImbalance;

  // merkleRoot and explorerUrl are returned by assembleExport on verified path (spec §7).
  const merkleRootDisplay: string | undefined = outcome?.ok ? outcome.merkleRoot : undefined;
  const explorerUrlDisplay: string | undefined = outcome?.ok ? outcome.explorerUrl : undefined;

  return (
    <div className="export-workspace">
      {/* ── Header ── */}
      <header className="export-header">
        <p className="export-purpose">
          Download a tamper-evident ZIP of this period's journal entries, including
          on-chain Merkle proofs where the period has been anchored.
        </p>
        {entity && (
          <p className="export-entity-subhead">
            {entity.displayName} <span className="mono export-entity-id">({entity.id})</span>
          </p>
        )}
      </header>

      {/* ── Period display ── */}
      <PeriodDisplay periodId={periodId} />

      {/* ── Loading / error states ── */}
      {loading && <p className="export-loading">Loading export data…</p>}
      {error && (
        <div className="card light--red export-fetch-error">
          <strong>Failed to load data:</strong> {error}
        </div>
      )}

      {/* ── Status card (visual anchor) ── */}
      {outcome && (
        <div className="export-card-zone">
          {isEmpty && (
            <div data-testid="empty-export-state">
              <EmptyState
                title="Nothing to export"
                body="No journal entries found for this period."
              />
            </div>
          )}
          {isImbalance && (
            <ImbalanceCard
              debit={(outcome as { debit: string }).debit}
              credit={(outcome as { credit: string }).credit}
            />
          )}
          {isStaleRestatement && (
            <StaleRestatementCard
              anchoredSeq={(outcome as { anchoredSeq: number }).anchoredSeq}
              latestSnapshotSeq={(outcome as { latestSnapshotSeq: number }).latestSnapshotSeq}
            />
          )}
          {isUnregistered && (
            <UnregisteredAssetsCard coinTypes={(outcome as { coinTypes: string[] }).coinTypes} />
          )}
          {outcome.ok && manualAssets.length > 0 && (
            <ManualDisclosureCard coinTypes={manualAssets} />
          )}
          {outcome.ok && outcome.verified && (
            <VerifiedCard
              summary={outcome.summary}
              merkleRoot={merkleRootDisplay}
              explorerUrl={explorerUrlDisplay}
            />
          )}
          {outcome.ok && !outcome.verified && (
            <DraftCard summary={outcome.summary} />
          )}
          {!outcome.ok && (outcome as { kind: string }).kind === 'error' && (
            <div className="card light--red export-status-card">
              <strong>Export error:</strong>{' '}
              {(outcome as { message: string }).message}
            </div>
          )}
        </div>
      )}

      {assembleError && (
        <div className="card light--red export-fetch-error">
          <strong>Assembly error:</strong> {assembleError}
        </div>
      )}

      {/* ── Self-verification summary (shown inline in cards above) ── */}

      {/* ── Download CTA ── */}
      <div className="export-cta-row">
        {canPreview && !outcome && (
          <button
            type="button"
            className="btn-primary"
            onClick={handlePreview}
            aria-label="Preview export"
          >
            Preview export
          </button>
        )}
        {outcome && (
          <>
            <button
              data-testid="download-btn"
              type="button"
              className="btn-primary"
              onClick={handleDownload}
              disabled={!downloadEnabled}
              aria-label="Download export ZIP"
            >
              ↓ Download ZIP
            </button>
            {outcome.ok && (
              <FilenamePreview filename={outcome.filename} />
            )}
            <button
              type="button"
              className="export-retry-btn"
              onClick={handlePreview}
              disabled={assembling}
            >
              Refresh preview
            </button>
          </>
        )}
      </div>

      {/* ── Functional currency demo-constant notice (dev only) ── */}
      {import.meta.env.DEV && (
        <p className="export-fc-notice mono">
          functionalCurrency={DEMO_FUNCTIONAL_CURRENCY} scale={DEMO_SCALE} (demo policy constant, see buildRuleInput.ts)
        </p>
      )}
    </div>
  );
}
