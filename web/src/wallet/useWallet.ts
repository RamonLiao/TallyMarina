import { useCallback } from 'react';
import { useDAppKit, useCurrentAccount } from '@mysten/dapp-kit-react';
import { Transaction } from '@mysten/sui/transactions';

export interface WalletSeam {
  address: string | null;
  signAndExecute(txKind: string): Promise<{ digest: string }>;
}

export function useWallet(): WalletSeam {
  const dAppKit = useDAppKit();
  const account = useCurrentAccount();

  const signAndExecute = useCallback(
    async (txKind: string): Promise<{ digest: string }> => {
      const transaction = Transaction.from(txKind);
      const result = await dAppKit.signAndExecuteTransaction({ transaction });
      if ('FailedTransaction' in result && result.FailedTransaction) {
        const msg =
          (result.FailedTransaction as { status?: { error?: { message?: string } } })
            ?.status?.error?.message ?? 'Transaction failed';
        throw new Error(msg);
      }
      return { digest: (result as { Transaction: { digest: string } }).Transaction.digest };
    },
    [dAppKit],
  );

  return { address: account?.address ?? null, signAndExecute };
}
