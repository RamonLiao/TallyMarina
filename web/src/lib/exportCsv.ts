// DATA ZONE — NEVER import Mascot here.
const INJECTION = new Set(['=', '+', '-', '@']);

export function csvField(value: string): string {
  let v = value;
  const needsInjectionGuard = v.length > 0 && INJECTION.has(v[0] as string);
  if (needsInjectionGuard) v = `'${v}`;
  const needsQuote = needsInjectionGuard || /[",\n\r]/.test(v);
  if (needsQuote) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function csvRows(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((cols) => cols.map(csvField).join(','));
  return lines.join('\n');
}

export function headerBlock(meta: Record<string, string>): string {
  return Object.entries(meta).map(([k, v]) => `# ${k}: ${v}`).join('\n');
}

export function formatMinor(amountMinor: string, scale: number): string {
  const neg = amountMinor.startsWith('-');
  const digits = (neg ? amountMinor.slice(1) : amountMinor).padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale) || '0';
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}
