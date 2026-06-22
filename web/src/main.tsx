import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { createDAppKit } from '@mysten/dapp-kit-core';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import './tokens.css';
import App from './App';

// NOTE: @mysten/dapp-kit-react 2.1.3 uses createDAppKit({ networks, createClient }) + DAppKitProvider.
// The deprecated @mysten/dapp-kit useSignAndExecuteTransaction is NOT used.
// Wallet signing: useWalletConnection() → walletConnection.signAndExecuteTransaction().
// SuiClient/getFullnodeUrl no longer exported from @mysten/sui/client in 2.x;
// use SuiJsonRpcClient + getJsonRpcFullnodeUrl from @mysten/sui/jsonRpc.

const queryClient = new QueryClient();

const dAppKit = createDAppKit({
  networks: ['testnet'] as const,
  createClient: (network) =>
    new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network }),
  defaultNetwork: 'testnet',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DAppKitProvider dAppKit={dAppKit}>
        <App />
      </DAppKitProvider>
    </QueryClientProvider>
  </StrictMode>,
);
