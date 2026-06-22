import { createDAppKit } from '@mysten/dapp-kit-core';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';

export const dAppKit = createDAppKit({
  networks: ['testnet', 'mainnet'] as const,
  defaultNetwork: (import.meta.env.VITE_SUI_NETWORK as 'testnet' | 'mainnet') ?? 'testnet',
  createClient: (network) =>
    new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network }),
});

declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
