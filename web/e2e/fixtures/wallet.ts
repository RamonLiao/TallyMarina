import type { Page } from '@playwright/test';

export interface MockWalletOptions {
  /** Must be a valid normalized Sui address (0x + 64 hex chars). */
  address: string;
  /**
   * Controls what signPersonalMessage resolves with.
   * - 'success'  → returns { bytes: '<hex>', signature: '<hex>' }
   * - 'garbage'  → returns an invalid signature string
   * - 'hang'     → never resolves (simulates busy/timeout)
   */
  signResult?: 'success' | 'garbage' | 'hang';
  /**
   * When true, seed dapp-kit's selected-wallet localStorage key so it
   * auto-reconnects to the mock wallet on load — bypassing the connect
   * dialog (which is fragile/unreliable headless). dapp-kit's autoConnect
   * defaults to true and restores `${walletId}:${address}`.
   */
  autoConnect?: boolean;
}

/**
 * Injects a Wallet-Standard mock wallet into the page via addInitScript
 * so it runs BEFORE app scripts. dapp-kit-react v2 will find it in the
 * wallet registry and show it in the connect dialog.
 *
 * Full feature set is required — dapp-kit filters out wallets missing
 * sui:signTransaction / sui:signAndExecuteTransaction.
 */
export async function installMockWallet(
  page: Page,
  { address, signResult = 'success', autoConnect = false }: MockWalletOptions,
): Promise<void> {
  await page.addInitScript(
    ({ addr, sigMode, auto }: { addr: string; sigMode: string; auto: boolean }) => {
      // dapp-kit reconnects to `${walletId}:${address}` on load (autoConnect
      // defaults to true). walletId falls back to the wallet name ("Mock Wallet").
      if (auto) {
        try {
          window.localStorage.setItem(
            'mysten-dapp-kit:selected-wallet-and-address',
            `Mock Wallet:${addr}`,
          );
        } catch {
          // localStorage unavailable — connect dialog fallback still applies
        }
      }
      // ── Wallet Standard mock ──────────────────────────────────────────────
      const accounts = [
        {
          address: addr,
          publicKey: new Uint8Array(32),
          chains: ['sui:testnet'],
          features: [
            'standard:connect',
            'standard:events',
            'sui:signPersonalMessage',
            'sui:signTransaction',
            'sui:signAndExecuteTransaction',
          ],
          label: 'Mock Wallet Account',
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        },
      ];

      let _listeners: Record<string, Array<(params: unknown) => void>> = {};

      const wallet = {
        version: '1.0.0' as const,
        name: 'Mock Wallet',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' as `data:image/${'svg+xml' | 'webp' | 'png'};base64,${string}`,
        chains: ['sui:testnet' as `${string}:${string}`],
        accounts,
        features: {
          'standard:connect': {
            version: '1.0.0' as const,
            connect: async () => ({ accounts }),
          },
          'standard:disconnect': {
            version: '1.0.0' as const,
            disconnect: async () => {},
          },
          'standard:events': {
            version: '1.0.0' as const,
            on: (event: string, cb: (params: unknown) => void) => {
              (_listeners[event] = _listeners[event] || []).push(cb);
              return () => {
                _listeners[event] = (_listeners[event] || []).filter(
                  (fn) => fn !== cb,
                );
              };
            },
          },
          'sui:signPersonalMessage': {
            version: '1.0.0' as const,
            signPersonalMessage: async (_params: unknown) => {
              if (sigMode === 'hang') {
                return new Promise(() => {}); // never resolves
              }
              if (sigMode === 'garbage') {
                return { bytes: 'bad', signature: 'not-a-real-sig' };
              }
              // success — return plausible hex stubs
              return {
                bytes: '68656c6c6f',
                signature:
                  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
              };
            },
          },
          'sui:signTransaction': {
            version: '2.0.0' as const,
            signTransaction: async (_params: unknown) => ({
              bytes: '00',
              signature: 'AAAA',
            }),
          },
          'sui:signAndExecuteTransaction': {
            version: '2.0.0' as const,
            signAndExecuteTransaction: async (_params: unknown) => ({
              digest: '0x0000000000000000000000000000000000000000000000000000000000000000',
              bytes: '00',
              signature: 'AAAA',
              effects: '00',
            }),
          },
        },
      };

      // Register via Wallet Standard event (for any listener already present)
      window.dispatchEvent(
        new CustomEvent('wallet-standard:register-wallet', {
          detail: (api: { register: (w: typeof wallet) => void }) => {
            api.register(wallet);
          },
          bubbles: false,
          cancelable: false,
        }),
      );

      // This init script runs BEFORE the app mounts, so the register-wallet
      // event above has no listener yet and is lost. The Wallet Standard
      // contract: when the app initializes it dispatches `app-ready` with a
      // register callback — respond to it so the mock is (re)registered and
      // becomes connectable / auto-connectable.
      window.addEventListener(
        'wallet-standard:app-ready',
        (e: Event) => {
          const detail = (e as CustomEvent).detail as
            | { register?: (w: typeof wallet) => void }
            | undefined;
          detail?.register?.(wallet);
        },
        false,
      );

      // Also attach to window for frameworks that poll window on mount
      (window as unknown as Record<string, unknown>).__mockWallet__ = wallet;
    },
    { addr: address, sigMode: signResult, auto: autoConnect },
  );
}
