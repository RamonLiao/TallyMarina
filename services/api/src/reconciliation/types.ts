export type Provenance = 'book' | 'mock' | 'live' | 'n/a';
export type ReconReasonCode = 'timing' | 'error' | 'fee' | 'fx' | 'in-transit' | 'unidentified' | 'OTHER';
export const RECON_REASON_CODES: ReconReasonCode[] = ['timing', 'error', 'fee', 'fx', 'in-transit', 'unidentified', 'OTHER'];

export interface ReconFixtureRow {
  wallet: string; coinType: string;
  openingMinor: string; statementMinor: string; thresholdMinor: string;
}
