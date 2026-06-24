// services/api/src/onboarding/constants.ts
export const OWNERSHIP_VERIFIER = 'subledger-api/onboarding-verifier@v1';
export const OWNERSHIP_INITIATED_BY = 'demo-operator';
export const OWNERSHIP_TEMPLATE_VERSION = 'v1';
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// A real testnet address the demo presenter controls, seeded as a listed source
// so the happy-path verify row is clickable. Overridable via env for live demos.
export const DEMO_OWNED_WALLET =
  process.env.ONBOARDING_DEMO_WALLET ?? '0x0000000000000000000000000000000000000000000000000000000000000abc';

export interface EntityMeta {
  functionalCurrency: string;
  reportingCurrency: string;
  fiscalCalendar: string;
  timezone: string;
}

// Entity meta lives here (entities table has no currency/calendar columns; see spec §2).
export const DEMO_ENTITY_META: Record<string, EntityMeta> = {
  'acme:pilot-001': {
    functionalCurrency: 'USD',
    reportingCurrency: 'USD',
    fiscalCalendar: 'Jan–Dec (calendar year)',
    timezone: 'America/New_York',
  },
};
