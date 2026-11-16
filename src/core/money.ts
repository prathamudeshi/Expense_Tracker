/**
 * Indian-format currency helpers.
 *
 * Hand-rolled rather than using Intl.NumberFormat so the output is identical on
 * both platforms and matches the native widget formatter exactly (Hermes ships
 * different ICU data depending on build flags).
 */
const RUPEE = '\u20B9';

function groupIndian(digits: string): string {
  if (digits.length <= 3) {
    return digits;
  }
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  let out = '';
  while (rest.length > 2) {
    out = `,${rest.slice(-2)}${out}`;
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) {
    out = `${rest}${out}`;
  }
  return `${out},${last3}`;
}

/** e.g. 123456.5 -> "₹1,23,457" (rounded, for headline numbers). */
export function money(value: number): string {
  const sign = value < 0 ? '-' : '';
  const rounded = Math.round(Math.abs(value));
  return `${sign}${RUPEE}${groupIndian(String(rounded))}`;
}

/** e.g. 1234.5 -> "₹1,234.50" (exact, for transaction rows and editing). */
export function moneyExact(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute);
  const paise = Math.round((absolute - whole) * 100);
  const grouped = groupIndian(String(whole));
  return paise === 0
    ? `${sign}${RUPEE}${grouped}`
    : `${sign}${RUPEE}${grouped}.${String(paise).padStart(2, '0')}`;
}

/** Compact form for chart axes: 1250 -> "1.3k", 250000 -> "2.5L". */
export function moneyCompact(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10_000_000) {
    return `${RUPEE}${(value / 10_000_000).toFixed(1)}Cr`;
  }
  if (absolute >= 100_000) {
    return `${RUPEE}${(value / 100_000).toFixed(1)}L`;
  }
  if (absolute >= 1_000) {
    return `${RUPEE}${(value / 1_000).toFixed(1)}k`;
  }
  return `${RUPEE}${Math.round(value)}`;
}

/** Tolerant of "1,234.50", "₹1234", " 1234 ". Returns null when unusable. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^\d.]/g, '');
  if (!cleaned) {
    return null;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value * 100) / 100;
}
