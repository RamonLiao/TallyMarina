import { describe, it, expect } from 'vitest';
import { dispatchTarget } from './lightMeta';

describe('dispatchTarget routes every real cockpit light', () => {
  it('routes the registry light to onboarding', () => {
    // WHY: the registry light arrives as status:'red' and LightCard marks it actionable
    // (dispatchTarget(key) !== null). Without the 'registry' case it falls to default:null —
    // the light still renders, sorts to the top, and looks clickable, but clicking does nothing.
    // No component test exercises this key, so this is the only guard that fails when the case is
    // removed (mutation check #3).
    expect(dispatchTarget('registry')).toBe('onboarding');
  });

  it('routes recon and classification lights', () => {
    expect(dispatchTarget('recon')).toBe('reconciliation');
    expect(dispatchTarget('classification')).toBe('review');
  });

  it('returns null for a light with no destination', () => {
    expect(dispatchTarget('pricing')).toBeNull();
  });
});
