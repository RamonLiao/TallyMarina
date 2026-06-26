const REGISTRY: Record<string, () => Promise<{ run: () => Promise<void> }>> = {
  S1: () => import('./s1-close-happy.js'),
  S2: () => import('./s2-exceptions.js'),
  S3: () => import('./s3-reconciliation.js'),
  S4: () => import('./s4-cockpit.js'),
  S5: () => import('./s5-audit.js'),
  S6: () => import('./s6-onboarding.js'),
};
async function main() {
  const only = process.argv[2]; // e.g. "S2"
  const ids = only ? [only.toUpperCase()] : Object.keys(REGISTRY);
  let failed = 0;
  for (const id of ids) {
    const loader = REGISTRY[id];
    if (!loader) { console.error(`unknown scenario ${id}`); process.exit(2); }
    process.stdout.write(`\n▶ ${id} … `);
    try { const m = await loader(); await m.run(); console.log('PASS'); }
    catch (e) { failed++; console.log('FAIL'); console.error(e); }
  }
  console.log(`\n${ids.length - failed}/${ids.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
