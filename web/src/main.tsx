import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/mona-sans';
import './tokens.css';
import './styles/base.css';
import { Providers } from './Providers';
import App from './App';

// NOTE: @mysten/dapp-kit-react 2.1.3 uses createDAppKit({ networks, createClient }) + DAppKitProvider.
// The deprecated @mysten/dapp-kit useSignAndExecuteTransaction is NOT used.
// Wallet signing: useWalletConnection() → walletConnection.signAndExecuteTransaction().
// SuiClient/getFullnodeUrl no longer exported from @mysten/sui/client in 2.x;
// use SuiJsonRpcClient + getJsonRpcFullnodeUrl from @mysten/sui/jsonRpc.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
