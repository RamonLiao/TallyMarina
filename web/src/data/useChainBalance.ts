import { useEffect, useState } from 'react';
import { useCurrentClient } from '@mysten/dapp-kit-react';

export type ChainState = 'idle' | 'loading' | 'live' | 'unavailable';

// SUI-only live read; fail-loud — never returns a silent 0 on error.
export function useChainBalance(wallet: string | null, coinType: string) {
  const client = useCurrentClient();
  const [state, setState] = useState<ChainState>('idle');
  const [balanceMinor, setBalanceMinor] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    if (!wallet || coinType !== '0x2::sui::SUI') { setState('idle'); return; }
    setState('loading');
    client.getBalance({ owner: wallet, coinType })
      .then((b: { totalBalance: string }) => { if (!cancelled) { setBalanceMinor(b.totalBalance); setState('live'); } })
      .catch(() => { if (!cancelled) { setBalanceMinor(undefined); setState('unavailable'); } });
    return () => { cancelled = true; };
  }, [client, wallet, coinType]);
  return { state, balanceMinor };
}
