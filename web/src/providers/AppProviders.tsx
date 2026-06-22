import type { ReactNode } from 'react';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { dAppKit } from '../wallet/dapp-kit';
import { appQueryClient } from '../api/queryClient';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={appQueryClient}>
      <DAppKitProvider dAppKit={dAppKit}>{children}</DAppKitProvider>
    </QueryClientProvider>
  );
}
