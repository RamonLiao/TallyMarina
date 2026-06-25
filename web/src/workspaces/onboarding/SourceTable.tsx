import { useState } from 'react';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import type { OnboardingDTO } from '../../api/types';
import { usePersonalWalletOwnership } from '../../data/usePersonalWalletOwnership';

function trunc(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

const ERR: Record<string, string> = {
  CHALLENGE_INVALID: 'Challenge expired, retry',
  ADDRESS_MISMATCH: 'Connected wallet ≠ this source',
  BAD_SIGNATURE: 'Signature invalid',
};

function errMsg(code?: string): string {
  if (!code) return 'Verification failed';
  const key = Object.keys(ERR).find((k) => code.includes(k));
  return (key ? ERR[key] : undefined) ?? 'Verification failed';
}

export function SourceTable({ data, onVerified }: { data: OnboardingDTO; onVerified(): void }) {
  const { account, status, errorCode, verify } = usePersonalWalletOwnership();
  const [activeWallet, setActiveWallet] = useState<string | null>(null);

  // Mirror the backend route guard (connectedAccount must match wallet) client-side so the most
  // common slip — wallet A connected, Verify clicked on wallet B's row — surfaces the clear
  // "Connected wallet ≠ this source" instead of a generic round-trip failure.
  function isMismatch(wallet: string): boolean {
    return !!account && normalizeSuiAddress(account.address) !== normalizeSuiAddress(wallet);
  }

  async function onVerify(wallet: string) {
    setActiveWallet(wallet);
    if (isMismatch(wallet)) return; // mismatch surfaced via render-derived state below
    const ok = await verify(wallet);
    if (ok) onVerified();
  }

  return (
    <table className="ob-table">
      <thead>
        <tr>
          <th>Wallet source</th>
          <th>Events</th>
          <th>Ownership</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {data.sources.map((s) => {
          const busy = activeWallet === s.wallet && (status === 'awaiting-signature' || status === 'verifying');
          // Render-derived (no stored error state): isMismatch recomputes when the connected
          // account changes, so a stale "≠ this source" message clears the same frame.
          const shownErr = activeWallet === s.wallet
            ? (isMismatch(s.wallet) ? errMsg('ADDRESS_MISMATCH') : (status === 'error' ? errMsg(errorCode) : null))
            : null;
          return (
            <tr key={s.wallet}>
              <td
                className="td--mono"
                title={s.wallet}
                onClick={() => navigator.clipboard?.writeText(s.wallet)}
              >
                {trunc(s.wallet)}{s.isDemoOwned ? ' (you)' : ''}
              </td>
              <td>{s.eventCount}</td>
              <td>
                {s.ownership.verified
                  ? <span className="ob-badge ob-badge--verified">VERIFIED</span>
                  : <span className="ob-badge ob-badge--unverified">UNVERIFIED</span>}
              </td>
              <td>
                {!s.ownership.verified && (
                  account
                    ? <button className="btn-primary" disabled={busy} onClick={() => { void onVerify(s.wallet); }}>{busy ? 'Signing…' : 'Verify ownership'}</button>
                    : <span className="ob-hint">Connect wallet to verify</span>
                )}
                {shownErr && <span className="ob-bad"> {shownErr}</span>}
              </td>
            </tr>
          );
        })}
        {data.unlistedVerified.map((u) => (
          <tr key={u.wallet}>
            <td className="td--mono" title={u.wallet}>{trunc(u.wallet)}</td>
            <td>—</td>
            <td>
              <span className="ob-badge ob-badge--verified">VERIFIED</span>{' '}
              <span className="ob-tag">unlisted</span>
            </td>
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
