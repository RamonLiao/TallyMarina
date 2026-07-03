/**
 * grpc-probe.ts — read-only shape verification against live testnet objects.
 *
 * Purpose: confirms the real gRPC getObject response shape matches the assumptions in
 * grpcChainAdapter.ts (res.object.json populated, owner.$kind==='AddressOwner').
 * No private key required — purely read-only.
 *
 * Run: npx tsx services/api/scripts/grpc-probe.ts
 */
import { SuiGrpcClient } from '@mysten/sui/grpc';

const TESTNET_GRPC_URL = 'https://fullnode.testnet.sui.io:443';

// Deployed testnet objects:
const ENTITY_ANCHOR_CHAIN = '0x4194290ec2e4d28617f7cae463ebfb4e37f173ed7b06b495cf203e015d1de869';
const ANCHOR_CAP = '0xaa1f65d8a2238ec0012d14413ee069207fa493274a71c53129a322489c8e8a73';

async function probe(grpc: SuiGrpcClient, label: string, objectId: string): Promise<void> {
  console.log(`\n--- ${label} (${objectId}) ---`);
  const res = await grpc.getObject({ objectId, include: { json: true } });

  const obj = res.object;
  console.log('objectId :', obj.objectId);
  console.log('type     :', obj.type);
  console.log('version  :', obj.version);
  console.log('owner    :', JSON.stringify(obj.owner));

  // Assert owner shape used by grpcChainAdapter.getCapOwner
  const owner = obj.owner as { $kind?: string; AddressOwner?: string } | null | undefined;
  if (owner && owner.$kind === 'AddressOwner') {
    console.log('owner.$kind === AddressOwner ✓  address:', owner.AddressOwner);
  } else {
    console.log('owner.$kind:', owner?.$kind, '(not AddressOwner — shared/immutable/other)');
  }

  const json = obj.json;
  if (json) {
    console.log('json populated ✓');
    console.log('json keys      :', Object.keys(json).join(', '));
    // Print the chain-specific fields the adapter reads
    for (const k of ['seq', 'cap_epoch', 'latest_link', 'entity_ref', 'epoch']) {
      if (k in json) console.log(`  json.${k} =`, JSON.stringify(json[k]));
    }
  } else {
    console.log('json: null/undefined ✗ — adapter will throw');
  }
}

async function main(): Promise<void> {
  console.log('gRPC probe — testnet', TESTNET_GRPC_URL);
  const grpc = new SuiGrpcClient({ network: 'testnet', baseUrl: TESTNET_GRPC_URL });

  await probe(grpc, 'EntityAnchorChain (shared)', ENTITY_ANCHOR_CHAIN);
  await probe(grpc, 'AnchorCap (owned)', ANCHOR_CAP);

  console.log('\nProbe complete.');
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
