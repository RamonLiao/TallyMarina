// services/api/src/config.ts
export interface ApiConfig {
  port: number;
  dbPath: string;
  suiNetwork: string;
  suiGrpcUrl: string;
  anchorPackageId: string;
  anchorOriginalPackageId: string;
  entityId: string;
  entityChainId: string;
  entityCapId: string;
  suiPk?: string;
  geminiApiKey: string;
  aiModelClassify: string;
  aiModelCopilot: string;
  aiConfidenceThreshold: number;
  explorerBase: string;
}

function req(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (v === undefined || v === '') throw new Error(`missing required env: ${key}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const threshold = Number(req(env, 'AI_CONFIDENCE_THRESHOLD'));
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`AI_CONFIDENCE_THRESHOLD must be a number in [0,1], got ${env['AI_CONFIDENCE_THRESHOLD']}`);
  }
  const port = Number(req(env, 'PORT'));
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT must be a positive integer, got ${env['PORT']}`);
  return {
    port,
    dbPath: req(env, 'DB_PATH'),
    suiNetwork: req(env, 'SUI_NETWORK'),
    suiGrpcUrl: req(env, 'SUI_GRPC_URL'),
    anchorPackageId: req(env, 'ANCHOR_PACKAGE_ID'),
    anchorOriginalPackageId: req(env, 'ANCHOR_ORIGINAL_PACKAGE_ID'),
    entityId: req(env, 'ENTITY_ID'),
    entityChainId: req(env, 'ENTITY_CHAIN_ID'),
    entityCapId: req(env, 'ENTITY_CAP_ID'),
    suiPk: env['SUI_PK'] && env['SUI_PK'] !== '' ? env['SUI_PK'] : undefined,
    geminiApiKey: req(env, 'GEMINI_API_KEY'),
    aiModelClassify: req(env, 'AI_MODEL_CLASSIFY'),
    aiModelCopilot: req(env, 'AI_MODEL_COPILOT'),
    aiConfidenceThreshold: threshold,
    explorerBase: req(env, 'EXPLORER_BASE'),
  };
}
