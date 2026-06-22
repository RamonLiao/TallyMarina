import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { createDAppKit } from '@mysten/dapp-kit-core';
import { DAppKitProvider } from '@mysten/dapp-kit-react';

const queryClient = new QueryClient();

const dAppKit = createDAppKit({
  networks: ['testnet', 'mainnet'] as const,
  createClient: (network) =>
    new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network }),
  defaultNetwork: 'testnet',
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <DAppKitProvider dAppKit={dAppKit}>
        {children}
      </DAppKitProvider>
    </QueryClientProvider>
  );
}
