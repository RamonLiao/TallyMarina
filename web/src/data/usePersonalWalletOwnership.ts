import { useCallback, useState } from 'react';
import { useDAppKit, useCurrentAccount } from '@mysten/dapp-kit-react';
import { postOnboardingChallenge, postOnboardingVerify } from '../api/endpoints';

type Status = 'idle' | 'awaiting-signature' | 'verifying' | 'verified' | 'error';

export function usePersonalWalletOwnership() {
  const dAppKit = useDAppKit();
  const account = useCurrentAccount();
  const [status, setStatus] = useState<Status>('idle');
  const [errorCode, setErrorCode] = useState<string | undefined>();

  const verify = useCallback(async (wallet: string): Promise<boolean> => {
    setErrorCode(undefined);
    try {
      setStatus('awaiting-signature');
      const { nonce, message } = await postOnboardingChallenge(wallet);
      const { signature } = await dAppKit.signPersonalMessage({ message: new TextEncoder().encode(message) });
      setStatus('verifying');
      await postOnboardingVerify({ wallet, nonce, signature, connectedAccount: account?.address ?? wallet });
      setStatus('verified');
      return true;
    } catch (e) {
      setErrorCode((e as Error).message);
      setStatus('error');
      return false;
    }
  }, [dAppKit, account]);

  const reset = useCallback(() => { setStatus('idle'); setErrorCode(undefined); }, []);

  return { account: account ? { address: account.address } : null, status, errorCode, verify, reset };
}
