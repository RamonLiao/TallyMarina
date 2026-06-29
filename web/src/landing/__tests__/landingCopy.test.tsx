import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from '../Landing';

const renderLanding = () =>
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );

describe('landing copy guardrails (accountant review)', () => {
  it('hero says "audit-ready close", never the overclaim "audit-ready books"', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/audit-ready close/i);
    expect(document.body.textContent).not.toMatch(/audit-ready books/i);
  });

  it('does not flatly claim IFRS/US GAAP compliance', () => {
    renderLanding();
    // "templated to" framing is allowed; a bare "GAAP compliant" claim is not.
    expect(document.body.textContent).not.toMatch(/gaap compliant|compliant switch/i);
  });

  it('surfaces the controls story: period close & lock + maker-checker', () => {
    renderLanding();
    expect(document.body.textContent).toMatch(/period close/i);
    expect(document.body.textContent).toMatch(/maker-checker|segregation of duties/i);
  });

  it('presents Walrus as optional, not the audit headline', () => {
    // Walrus MUST be present (the snapshot/audit story references it) AND framed
    // as optional — a non-conditional assertion so deleting the Walrus line fails
    // here instead of silently passing (anti-vacuous, per lessons.md).
    renderLanding();
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/walrus/i);
    expect(text).toMatch(/optional[^.]*walrus|walrus[^.]*optional/i);
  });

  it('keeps a working Launch App CTA', () => {
    renderLanding();
    expect(screen.getAllByRole('button', { name: /launch app/i }).length).toBeGreaterThan(0);
  });
});
