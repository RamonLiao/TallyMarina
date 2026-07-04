// services/api/src/config.ts
export type MemoryMode = 'off' | 'local' | 'memwal';
export interface MemoryConfig {
  mode: MemoryMode;
  namespacePrefix: string;         // namespace = `${prefix}:${entityId}`
  recallLimit: number;
  recallMaxDistance: number | null;
  recallTimeoutMs: number;
  privateKey?: string;             // memwal mode only
  accountId?: string;              // memwal mode only
  serverUrl?: string;              // optional relayer override
}

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
  /** AUTO events with confidence below this band surface as LOW_CONFIDENCE_AUTO exceptions. Optional; defaults to 0.85. Recommended above the AUTO routing threshold for meaningful signal. */
  exceptionLowConfidence: number;
  explorerBase: string;
  reconLiveWallet?: string;
  /** Triage scheduler tick in ms. 0 (default) = scheduler OFF. */
  triageIntervalMs: number;
  /** Agent may not propose dismiss/IMMATERIAL_WAIVED above this amount (deterministic gate, CPA F5). */
  triageMaterialityThreshold: number;
  /** Triage decision-memory config (round 2). mode=off (default) = round-1 behavior. */
  memory: MemoryConfig;
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
  const exLowRaw = env['EXCEPTION_LOW_CONFIDENCE'];
  const exceptionLowConfidence = exLowRaw === undefined || exLowRaw === '' ? 0.85 : Number(exLowRaw);
  if (!Number.isFinite(exceptionLowConfidence) || exceptionLowConfidence < 0 || exceptionLowConfidence > 1) {
    throw new Error(`EXCEPTION_LOW_CONFIDENCE must be a number in [0,1], got ${exLowRaw}`);
  }
  const port = Number(req(env, 'PORT'));
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT must be a positive integer, got ${env['PORT']}`);
  const triageIntervalRaw = env['TRIAGE_INTERVAL_MS'];
  const triageIntervalMs = triageIntervalRaw === undefined || triageIntervalRaw === '' ? 0 : Number(triageIntervalRaw);
  if (!Number.isInteger(triageIntervalMs) || triageIntervalMs < 0) {
    throw new Error(`TRIAGE_INTERVAL_MS must be a non-negative integer, got ${triageIntervalRaw}`);
  }
  const triageMatRaw = env['TRIAGE_MATERIALITY_THRESHOLD'];
  const triageMaterialityThreshold = triageMatRaw === undefined || triageMatRaw === '' ? 1000 : Number(triageMatRaw);
  if (!Number.isFinite(triageMaterialityThreshold) || triageMaterialityThreshold <= 0) {
    throw new Error(`TRIAGE_MATERIALITY_THRESHOLD must be a positive number, got ${triageMatRaw}`);
  }
  const memMode = (env['TRIAGE_MEMORY_MODE'] ?? 'off') as string;
  if (!['off', 'local', 'memwal'].includes(memMode)) {
    throw new Error(`TRIAGE_MEMORY_MODE must be off|local|memwal, got ${memMode}`);
  }
  const recallLimitRaw = env['TRIAGE_MEMORY_RECALL_LIMIT'];
  const recallLimit = recallLimitRaw === undefined || recallLimitRaw === '' ? 5 : Number(recallLimitRaw);
  if (!Number.isInteger(recallLimit) || recallLimit <= 0) {
    throw new Error(`TRIAGE_MEMORY_RECALL_LIMIT must be a positive integer, got ${recallLimitRaw}`);
  }
  const timeoutRaw = env['TRIAGE_MEMORY_RECALL_TIMEOUT_MS'];
  const recallTimeoutMs = timeoutRaw === undefined || timeoutRaw === '' ? 3000 : Number(timeoutRaw);
  if (!Number.isInteger(recallTimeoutMs) || recallTimeoutMs <= 0) {
    throw new Error(`TRIAGE_MEMORY_RECALL_TIMEOUT_MS must be a positive integer, got ${timeoutRaw}`);
  }
  const maxDistRaw = env['TRIAGE_MEMORY_RECALL_MAXDISTANCE'];
  const recallMaxDistance = maxDistRaw === undefined || maxDistRaw === '' ? null : Number(maxDistRaw);
  if (recallMaxDistance !== null && !Number.isFinite(recallMaxDistance)) {
    throw new Error(`TRIAGE_MEMORY_RECALL_MAXDISTANCE must be a number, got ${maxDistRaw}`);
  }
  const memory: MemoryConfig = {
    mode: memMode as MemoryMode,
    namespacePrefix: env['MEMWAL_NAMESPACE_PREFIX'] && env['MEMWAL_NAMESPACE_PREFIX'] !== '' ? env['MEMWAL_NAMESPACE_PREFIX']! : 'triage',
    recallLimit, recallMaxDistance, recallTimeoutMs,
    serverUrl: env['MEMWAL_SERVER_URL'] && env['MEMWAL_SERVER_URL'] !== '' ? env['MEMWAL_SERVER_URL'] : undefined,
  };
  if (memMode === 'memwal') {
    memory.privateKey = req(env, 'MEMWAL_PRIVATE_KEY');   // req() throws fail-loud if missing/empty
    memory.accountId = req(env, 'MEMWAL_ACCOUNT_ID');
  }
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
    exceptionLowConfidence,
    explorerBase: req(env, 'EXPLORER_BASE'),
    reconLiveWallet: env['RECON_LIVE_WALLET'] && env['RECON_LIVE_WALLET'] !== '' ? env['RECON_LIVE_WALLET'] : undefined,
    triageIntervalMs,
    triageMaterialityThreshold,
    memory,
  };
}
