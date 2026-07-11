// DATA ZONE — NEVER import Mascot here.
const INJECTION = new Set(['=', '+', '-', '@']);

/** Returns true if value starts with a CSV injection character after stripping
 *  leading whitespace and control chars (but NOT '-', which is itself an
 *  injection trigger).  Single source of truth for injection detection. */
function hasCsvInjectionPrefix(value: string): boolean {
  const stripped = value.replace(/^[\s\x00-\x1f]+/, '');
  return stripped.length > 0 && INJECTION.has(stripped[0] as string);
}

export function csvField(value: string): string {
  let v = value;
  // Strip leading whitespace and control chars (not '-') to detect injection
  // chars that Excel/Sheets normalise after leading spaces/tabs/CR.
  const needsInjectionGuard = hasCsvInjectionPrefix(v);
  // Guard applies to the original value (prefix ' before original), not stripped.
  if (needsInjectionGuard) v = `'${v}`;
  const needsQuote = needsInjectionGuard || /[",\n\r]/.test(v);
  if (needsQuote) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function csvRows(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((cols) => cols.map(csvField).join(','));
  return lines.join('\n');
}

// Guard meta values: strip newlines (prevent injecting new CSV rows) and apply
// formula guard if the first non-whitespace char is an injection character.
// Also sanitise keys (defense-in-depth: keys are currently hardcoded strings,
// but guard anyway to prevent header-row injection if keys ever come from data).
function guardMetaValue(v: string): string {
  // Replace CR/LF with space to prevent new-row injection in the header block.
  const sanitised = v.replace(/[\r\n]+/g, ' ');
  if (hasCsvInjectionPrefix(sanitised)) {
    return `'${sanitised}`;
  }
  return sanitised;
}

function guardMetaKey(k: string): string {
  // Strip CR/LF from key to prevent injecting new rows via a malicious key.
  return k.replace(/[\r\n]+/g, ' ');
}

export function headerBlock(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([k, v]) => `# ${guardMetaKey(k)}: ${guardMetaValue(v)}`)
    .join('\n');
}

export function formatMinor(amountMinor: string, scale: number): string {
  // A quantity's scale is not optional. A null/undefined/fractional scale reaching this
  // function means an unregistered asset (unknown decimals), not a formatting edge —
  // refusing is the only honest answer (mirrors fmtMinor, Task 9). Pre-guard, `null` slipped
  // through as `padStart(1)`/`slice>0 ? … : ''` and returned the raw minor string at scale 0;
  // `undefined` returned '0'. Both are silent scale errors — the exact class this spec kills.
  if (!Number.isInteger(scale) || scale < 0) {
    throw new Error(`formatMinor: scale must be a non-negative integer, got ${String(scale)}`);
  }
  const neg = amountMinor.startsWith('-');
  const digits = (neg ? amountMinor.slice(1) : amountMinor).padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale) || '0';
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}
