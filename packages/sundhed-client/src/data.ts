// Shapes sundhed.dk responses for an AI: CPR numbers out, noise out, text readable.

/** Field names that carry a CPR number or the login identity. Dropped whole. */
const CPR_KEYS = /^(cpr|cprnumber|cprnr|personidentifier|patientcpr|selectedcpr)$/i;

/** DDMMYY-SSSS or DDMMYYSSSS, standing alone (not part of a longer id). */
const CPR_PATTERN = /(?<![\d])(\d{2})(\d{2})(\d{2})-?(\d{4})(?![\d])/g;

function looksLikeCpr(dd: string, mm: string): boolean {
  const d = Number(dd), m = Number(mm);
  // Replacement CPR numbers add 60 to the day; keep those too.
  return m >= 1 && m <= 12 && ((d >= 1 && d <= 31) || (d >= 61 && d <= 91));
}

export function redactCpr(text: string): string {
  return text.replace(CPR_PATTERN, (match, dd: string, mm: string) => (looksLikeCpr(dd, mm) ? "[CPR]" : match));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Drops nulls, empty strings and empty arrays and objects, which make up much of
 * every response. Booleans stay: `SubstitutionAllowed: false` means something.
 * Strings get HTML entities decoded and CPR numbers masked. Keys that name a
 * CPR field are removed entirely.
 */
export function clean(value: unknown): unknown {
  if (typeof value === "string") {
    const s = redactCpr(decodeEntities(value)).trim();
    return s === "" ? undefined : s;
  }
  if (Array.isArray(value)) {
    const items = value.map(clean).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (CPR_KEYS.test(k)) continue;
      const c = clean(v);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null) return undefined;
  return value;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function monthsAgo(months: number, from = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() - months);
  return d;
}
