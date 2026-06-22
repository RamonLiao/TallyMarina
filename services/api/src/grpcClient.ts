// services/api/src/grpcClient.ts
// Constructs the real SuiGrpcClient and wires a SuiGrpcChainAdapter.
// Called by server.ts and scripts (grpc-probe, demo-e2e).
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiGrpcChainAdapter } from '@subledger/anchor-svc';
import type { ApiConfig } from './config.js';

// Testnet gRPC fullnode — the documented production endpoint.
const TESTNET_GRPC_URL = 'https://fullnode.testnet.sui.io:443';

export function makeGrpcClient(cfg: Pick<ApiConfig, 'suiNetwork' | 'suiGrpcUrl'>): SuiGrpcClient {
  const baseUrl = cfg.suiGrpcUrl || TESTNET_GRPC_URL;
  return new SuiGrpcClient({
    network: cfg.suiNetwork as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
    baseUrl,
  });
}

export interface GrpcAdapterResult {
  grpc: SuiGrpcClient;
  adapter: SuiGrpcChainAdapter;
  walletAddress?: string;
}

/**
 * makeGrpcAdapter — builds adapter with optional signer.
 * Pass cfg.suiPk for write paths; omit for read-only paths.
 */
export function makeGrpcAdapter(cfg: Pick<ApiConfig, 'suiNetwork' | 'suiGrpcUrl' | 'suiPk'>): GrpcAdapterResult {
  const grpc = makeGrpcClient(cfg);
  if (cfg.suiPk) {
    const { secretKey } = decodeSuiPrivateKey(cfg.suiPk);
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    return {
      grpc,
      adapter: new SuiGrpcChainAdapter(grpc, keypair),
      walletAddress: keypair.toSuiAddress(),
    };
  }
  return { grpc, adapter: new SuiGrpcChainAdapter(grpc) };
}
