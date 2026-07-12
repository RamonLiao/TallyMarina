import type { FastifyInstance } from 'fastify';
import { ACME_FIXTURE_ASSETS } from './registerTestAsset.js';

/**
 * Task 7: the cockpit's revaluation light is red until a revaluation run exists for the
 * period AND its dual fingerprints (price set + lot set) match the current position. Every
 * pre-existing "lock a period" test helper assumed a 6-light cockpit where lock only needed
 * classification/je/recon/registry/completeness green — this call posts a manual price for
 * every acme fixture coin (registerAcmeFixtureAssets's registration precondition already
 * satisfied by callers) and runs the revaluation once so the new light goes green too.
 *
 * Posting a price for a coin the entity doesn't actually hold this period is harmless — the
 * run only consumes prices for held coins (orchestrate.ts's heldCoins loop); unused rows just
 * sit unread. Uses the manual-price route + revaluation/run route exactly as a real caller
 * would (no store-level shortcuts), so it exercises the identical path revaluationLight reads.
 */
export async function makeRevaluationGreen(
  app: FastifyInstance,
  entityId: string,
  periodId: string,
  asOf = '2026-06-30',
): Promise<void> {
  for (const [coinType] of ACME_FIXTURE_ASSETS) {
    await app.inject({
      method: 'POST', url: `/entities/${entityId}/prices`,
      payload: { coinType, asOf, price: '1.00' },
    });
  }
  const r = await app.inject({
    method: 'POST', url: `/entities/${entityId}/revaluation/run`, payload: { periodId },
  });
  // 201 = fresh run; 409 REVAL_ALREADY_CURRENT means a prior call in this test already made
  // the light green (idempotent from the light's point of view) — anything else is a real bug.
  if (r.statusCode !== 201 && r.statusCode !== 409) {
    throw new Error(`makeRevaluationGreen: revaluation/run failed ${r.statusCode} ${r.body}`);
  }
}
