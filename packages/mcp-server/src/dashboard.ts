// The dashboard at /connect/record: an overview of the saved copy, one page
// per part, and the lab results drawn over time. Everything comes from the
// saved copy; the only action is fetching it again. When the server allows
// it, a renewal page also asks the GP to renew a prescription, the one write
// to sundhed.dk (renewal.ts). Rendered on the server, with no script, so it
// keeps the strict Content-Security-Policy of the other pages.
//
// sundhed.dk's field names are not documented and differ between its apps,
// so the lab results are read by shape (labSeries), not by fixed keys.
import { esc, type Lang, shell, view, when } from "./pages.ts";
import { PART_NAMES, type PartName, type Snapshot } from "./snapshot.ts";
import type { SyncStatus } from "./sync.ts";
import type { RenewalOverview, RenewalPackage, RenewableMedicine } from "./renewal.ts";

/** URL path of each part, the same as in /api/v1. */
export const PART_SLUGS: Record<PartName, string> = {
  summary: "summary",
  medicationCard: "medication-card",
  prescriptions: "prescriptions",
  vaccinations: "vaccinations",
  labResults: "lab-results",
  referrals: "referrals",
};
export const partOfSlug = (slug: string): PartName | undefined => PART_NAMES.find((p) => PART_SLUGS[p] === slug);

// The details saved next to a list part, by id.
const DETAILS: Partial<Record<PartName, "medicationDetails" | "prescriptionDetails" | "vaccinationDetails">> = {
  medicationCard: "medicationDetails",
  prescriptions: "prescriptionDetails",
  vaccinations: "vaccinationDetails",
};

const T = {
  da: {
    title: "Din journal", pill: "Gemt kopi",
    note: "Serverens gemte kopi af din journal på sundhed.dk. Den hentes igen af sig selv, mens du er logget ind.",
    none: "Der er ingen gemt kopi endnu. Log på med MitID, så henter serveren din journal.",
    session: "sundhed.dk-session", loggedIn: "logget ind", notLoggedIn: "ikke logget ind", login: "Log på med MitID",
    savedAt: "Gemt", fetchedAt: "Hentet", nextRun: "Næste hentning", waitsForLogin: "venter på login", syncOff: "slået fra",
    fetching: "Henter nu …", refreshAll: "Hent alt igen", refreshPart: "Hent igen", notFetched: "Ikke hentet",
    items: (n: number) => (n === 1 ? "1 post" : `${n} poster`), series: (n: number) => (n === 1 ? "1 analyse" : `${n} analyser`),
    failed: "Fejl", overview: "Overblik", open: "Åbn", details: "Detaljer", all: "Alle data",
    latest: "Seneste", range: "Referenceinterval", outside: "uden for interval", unit: "Enhed", date: "Dato", analysis: "Analyse", values: "Målinger",
    noLab: "Ingen prøvesvar med talværdier i den gemte kopi.",
    api: "API", apiBody: "Samme data som JSON, til scripts og egne dashboards. Kald den med et adgangstoken; se SELF-HOSTING.md for, hvordan du får et.",
    parts: { summary: "Overblik", medicationCard: "Medicinkort", prescriptions: "Recepter", vaccinations: "Vaccinationer", labResults: "Prøvesvar", referrals: "Henvisninger" },
    renewals: "Forny recept",
    renewalNote: "Bed din læge om at forny en recept. Listen hentes direkte fra sundhed.dk, ikke fra den gemte kopi. Lægen afgør anmodningen.",
    renewalLogin: "Fornyelse læser dit medicinkort direkte, så du skal være logget ind.",
    noDoctor: "sundhed.dk har ingen praktiserende læge registreret, som anmodningen kan sendes til.",
    noRenewable: "Der er ingen medicin på dit medicinkort, der kan fornyes her.",
    medicine: "Medicin", status: "Status", renew: "Forny", cannot: "Kan ikke fornyes",
    requests: "Tidligere anmodninger",
    choose: "Vælg pakning og antal", pkg: "Pakning", quantity: "Antal pakninger",
    confirm: "Jeg vil bede min læge om at forny denne recept.", send: "Send anmodning", cancel: "Fortryd",
    sent: "Anmodningen er sendt", sentBody: (drug: string, pkg: string, n: number) => `Din læge er bedt om at forny ${drug}: ${n} × ${pkg}. Svaret vises under Tidligere anmodninger.`,
    notSent: "Anmodningen blev ikke sendt", mustConfirm: "Sæt kryds for at bekræfte, før anmodningen sendes.",
  },
  en: {
    title: "Your record", pill: "Saved copy",
    note: "The server's saved copy of your sundhed.dk record. It is fetched again on its own while you are logged in.",
    none: "There is no saved copy yet. Log in with MitID and the server fetches your record.",
    session: "sundhed.dk session", loggedIn: "logged in", notLoggedIn: "not logged in", login: "Log in with MitID",
    savedAt: "Saved", fetchedAt: "Fetched", nextRun: "Next fetch", waitsForLogin: "waits for a login", syncOff: "turned off",
    fetching: "Fetching now …", refreshAll: "Fetch everything again", refreshPart: "Fetch again", notFetched: "Not fetched",
    items: (n: number) => (n === 1 ? "1 item" : `${n} items`), series: (n: number) => (n === 1 ? "1 test" : `${n} tests`),
    failed: "Failed", overview: "Overview", open: "Open", details: "Details", all: "All data",
    latest: "Latest", range: "Reference range", outside: "outside the range", unit: "Unit", date: "Date", analysis: "Test", values: "Results",
    noLab: "No lab results with numbers in the saved copy.",
    api: "API", apiBody: "The same data as JSON, for scripts and your own dashboards. Call it with an access token; SELF-HOSTING.md says how to get one.",
    parts: { summary: "Overview", medicationCard: "Medication card", prescriptions: "Prescriptions", vaccinations: "Vaccinations", labResults: "Lab results", referrals: "Referrals" },
    renewals: "Renew prescription",
    renewalNote: "Ask your GP to renew a prescription. The list is read live from sundhed.dk, not from the saved copy. Your GP decides on the request.",
    renewalLogin: "Renewal reads your medicine card live, so you need to be logged in.",
    noDoctor: "sundhed.dk has no GP registered to send the request to.",
    noRenewable: "No medicine on your medicine card can be renewed here.",
    medicine: "Medicine", status: "Status", renew: "Renew", cannot: "Cannot be renewed",
    requests: "Earlier requests",
    choose: "Choose package and quantity", pkg: "Package", quantity: "Number of packages",
    confirm: "I want to ask my GP to renew this prescription.", send: "Send request", cancel: "Cancel",
    sent: "The request was sent", sentBody: (drug: string, pkg: string, n: number) => `Your GP was asked to renew ${drug}: ${n} × ${pkg}. The answer shows under Earlier requests.`,
    notSent: "The request was not sent", mustConfirm: "Tick the box to confirm before the request is sent.",
  },
} as const;

export interface DashboardInput {
  snapshot: Snapshot | null;
  loggedIn: boolean;
  refreshing: boolean;
  sync: SyncStatus | null;
  apiUrl: string;
  /** The server allows prescription renewal: show its page in the menu. */
  renewal?: boolean;
}

// --- Reading the copy ---

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** How many entries a part holds: a list's length, or the lists inside an object added up. */
export function countItems(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (!isRecord(data)) return null;
  const lists = Object.values(data).filter(Array.isArray);
  return lists.length ? lists.reduce((n, l) => n + l.length, 0) : null;
}

export interface LabPoint {
  at: string;
  value: number;
  /** The value as sundhed.dk wrote it, such as "<5". */
  text: string;
}
export interface LabSeries {
  name: string;
  unit?: string;
  low?: number;
  high?: number;
  points: LabPoint[];
}

const NAME_KEY = /^(analyse|analysis|analysenavn|analysisname|analysekortnavn|kortnavn|undersoegelse|undersøgelse|navn|name|title|titel)$/i;
const VALUE_KEY = /^(vaerdi|værdi|value|resultat|result|svar|resultvalue|svarvaerdi)$/i;
const DATE_KEY = /(dato|date|tidspunkt|time|prøvetagning|proevetagning)/i;
const UNIT_KEY = /^(enhed|unit)$/i;
const LOW_KEY = /(nedre|lower|min)/i;
const HIGH_KEY = /(oevre|øvre|upper|max)/i;
const RANGE_KEY = /(reference|interval)/i;

/** A number as sundhed.dk writes it: "5,4", "<5" or 5.4. */
export function labNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const m = /^\s*[<>≤≥]?\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(v);
  return m ? Number(m[1]!.replace(",", ".")) : undefined;
}

const fieldOf = (obj: Record<string, unknown>, key: RegExp) => Object.keys(obj).find((k) => key.test(k) && obj[k] !== undefined && typeof obj[k] !== "object");
const dateOf = (obj: Record<string, unknown>) => {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (DATE_KEY.test(k) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v))) return v;
  }
  return undefined;
};

/** "3,5 - 5,0" as its two ends. */
function rangeOf(text: string): { low?: number; high?: number } {
  const m = /(-?\d+(?:[.,]\d+)?)\s*[-–]\s*(-?\d+(?:[.,]\d+)?)/.exec(text);
  return m ? { low: Number(m[1]!.replace(",", ".")), high: Number(m[2]!.replace(",", ".")) } : {};
}

/**
 * Lab results as one series per test, oldest first. A result is any object
 * with a test name, a value that reads as a number, and a date, its own or
 * one of the objects it sits in (a requisition, say). Only tests with a
 * number are kept; results written as text cannot be drawn.
 */
export function labSeries(results: unknown): LabSeries[] {
  const byName = new Map<string, LabSeries>();
  const walk = (node: unknown, inheritedDate: string | undefined, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, inheritedDate, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    const at = dateOf(node) ?? inheritedDate;
    const nameKey = fieldOf(node, NAME_KEY);
    const valueKey = fieldOf(node, VALUE_KEY);
    const value = valueKey ? labNumber(node[valueKey]) : undefined;
    if (nameKey && valueKey && value !== undefined && at) {
      const name = String(node[nameKey]);
      const series = byName.get(name) ?? { name, points: [] };
      const unitKey = fieldOf(node, UNIT_KEY);
      if (unitKey) series.unit ??= String(node[unitKey]);
      const lowKey = Object.keys(node).find((k) => LOW_KEY.test(k) && labNumber(node[k]) !== undefined);
      const highKey = Object.keys(node).find((k) => HIGH_KEY.test(k) && labNumber(node[k]) !== undefined);
      const rangeKey = fieldOf(node, RANGE_KEY);
      const range = rangeKey ? rangeOf(String(node[rangeKey])) : {};
      series.low ??= lowKey ? labNumber(node[lowKey]) : range.low;
      series.high ??= highKey ? labNumber(node[highKey]) : range.high;
      series.points.push({ at, value, text: String(node[valueKey]) });
      byName.set(name, series);
    }
    for (const v of Object.values(node)) if (typeof v === "object" && v !== null) walk(v, at, depth + 1);
  };
  walk(results, undefined, 0);
  const out = [...byName.values()];
  for (const s of out) {
    // The same result can sit under two parents; keep it once.
    const seen = new Set<string>();
    s.points = s.points.filter((p) => !seen.has(`${p.at}|${p.text}`) && seen.add(`${p.at}|${p.text}`)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  // Tests with the most results first: those are the ones worth a chart.
  return out.sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name, "da"));
}

const outside = (s: LabSeries, v: number) => (s.low !== undefined && v < s.low) || (s.high !== undefined && v > s.high);

// --- Drawing ---

/** A small line chart of one test, with its reference range as a band. */
export function labChart(s: LabSeries): string {
  const W = 320, H = 120, PAD = 8;
  const values = s.points.map((p) => p.value);
  const times = s.points.map((p) => Date.parse(p.at));
  let lo = Math.min(...values, s.low ?? Infinity), hi = Math.max(...values, s.high ?? -Infinity);
  if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const x = (t: number) => (t1 === t0 ? W / 2 : PAD + ((t - t0) / (t1 - t0)) * (W - 2 * PAD));
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD);
  const r = (n: number) => n.toFixed(1);
  const band =
    s.low !== undefined || s.high !== undefined
      ? `<rect class="band" x="0" width="${W}" y="${r(y(s.high ?? hi))}" height="${r(Math.max(0, y(s.low ?? lo) - y(s.high ?? hi)))}"/>`
      : "";
  const line = s.points.length > 1 ? `<polyline class="line" points="${s.points.map((p, i) => `${r(x(times[i]!))},${r(y(p.value))}`).join(" ")}"/>` : "";
  const dots = s.points
    .map((p, i) => `<circle class="${outside(s, p.value) ? "dot out" : "dot"}" cx="${r(x(times[i]!))}" cy="${r(y(p.value))}" r="3"><title>${esc(p.at.slice(0, 10))}: ${esc(p.text)}${s.unit ? ` ${esc(s.unit)}` : ""}</title></circle>`)
    .join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.name)}">${band}${line}${dots}</svg>`;
}

const CSS = `<style>
  .nav{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 18px}
  .nav a{padding:6px 12px;border-radius:999px;border:1px solid var(--line);color:var(--ink);text-decoration:none;font-size:14px}
  .nav a[aria-current="page"]{background:var(--ink);color:var(--on-ink);border-color:var(--ink)}
  .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin:18px 0}
  .tile{display:block;padding:16px;border-radius:16px;border:1px solid var(--line);background:var(--bg);color:var(--ink);text-decoration:none}
  .tile:hover{border-color:var(--line-strong)}
  .tile h2{font-size:16px;margin:0 0 6px}.tile .big{font-size:26px;font-weight:500;margin:0}
  .tile.bad{border-color:var(--err)}
  section{margin:28px 0 0;padding:24px 0 0;border-top:1px solid var(--line)}
  h2{font-size:18px;margin:0 0 4px}h3{font-size:15px;margin:0 0 2px}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .row form{margin:0}.row button{padding:8px 16px;font-size:14px}
  .charts{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin:14px 0}
  .lab{padding:14px;border-radius:14px;border:1px solid var(--line);background:var(--bg)}
  .chart{display:block;width:100%;height:auto;margin:8px 0 4px}
  .chart .band{fill:var(--ok);opacity:.12}.chart .line{fill:none;stroke:var(--ink);stroke-width:1.5}
  .chart .dot{fill:var(--ink)}.chart .dot.out{fill:var(--err)}
  .out{color:var(--err)}
  .scroll{overflow-x:auto;margin:8px 0}
  table{border-collapse:collapse;font-size:14px;width:100%}
  th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-weight:500;color:var(--muted);white-space:nowrap}
  dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:4px 16px;margin:8px 0;font-size:14px}
  dt{color:var(--muted)}dd{margin:0;min-width:0;overflow-wrap:anywhere}
  ul.plain{margin:0;padding-left:18px}
  details{margin:6px 0;font-size:13px}summary{cursor:pointer;color:var(--muted)}
  pre{overflow-x:auto;max-height:360px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font:12px "IBM Plex Mono",ui-monospace,monospace}
</style>`;

const BASE = "/connect/record";
export const RENEWALS = `${BASE}/renewals`;

function nav(lang: Lang, current: PartName | "renewals" | null, renewal = false): string {
  const t = T[lang];
  const link = (href: string, label: string, on: boolean) => `<a href="${href}"${on ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="nav">${link(BASE, t.overview, current === null)}${PART_NAMES.filter((p) => p !== "summary")
    .map((p) => link(`${BASE}/${PART_SLUGS[p]}`, t.parts[p], current === p))
    .join("")}${renewal ? link(RENEWALS, t.renewals, current === "renewals") : ""}</nav>`;
}

function refreshButton(lang: Lang, input: DashboardInput, part?: PartName): string {
  const t = T[lang];
  if (input.refreshing) return `<span class="muted">${t.fetching}</span>`;
  if (!input.loggedIn) return `<a href="/connect">${t.login}</a>`;
  return `<form method="post" action="${BASE}/refresh">${part ? `<input type="hidden" name="part" value="${part}">` : ""}<button class="ghost" type="submit">${part ? t.refreshPart : t.refreshAll}</button></form>`;
}

function nextRun(lang: Lang, sync: SyncStatus | null, part: PartName): string {
  const t = T[lang];
  if (!sync) return "";
  if (!sync.enabled) return `${t.nextRun}: ${t.syncOff}`;
  const next = sync.parts[part]?.nextRun;
  return `${t.nextRun}: ${next ? when(lang, next) : t.waitsForLogin}`;
}

function status(lang: Lang, input: DashboardInput): string {
  const t = T[lang];
  const snap = input.snapshot;
  return `<div class="row"><span>${t.session}: <b class="${input.loggedIn ? "" : "muted"}">${input.loggedIn ? t.loggedIn : t.notLoggedIn}</b></span>${snap ? `<span class="muted">${t.savedAt} ${when(lang, snap.savedAt)}</span>` : ""}${refreshButton(lang, input)}</div>`;
}

const page = (lang: Lang, title: string, body: string, kind: "ok" | "neutral", back: string) => shell(lang, title, body, { pill: T[lang].pill, kind, head: CSS, wide: true, back });

/** The overview: session, one tile per part, and where the API is. */
export function dashboardPage(lang: Lang, input: DashboardInput): string {
  const t = T[lang];
  const snap = input.snapshot;
  const kind = input.loggedIn ? "ok" : "neutral";
  if (!snap) return page(lang, t.title, `${nav(lang, null, input.renewal)}<p>${t.none}</p>${status(lang, input)}`, kind, BASE);
  const tiles = PART_NAMES.filter((p) => p !== "summary").map((part) => {
    const data = part === "labResults" ? snap.labResults?.results : snap[part];
    const error = snap.errors[part];
    const n = part === "labResults" ? (data === undefined ? null : labSeries(data).length) : countItems(data);
    const big = data === undefined ? t.notFetched : n === null ? "—" : part === "labResults" ? t.series(n) : t.items(n);
    return `<a class="tile${error ? " bad" : ""}" href="${BASE}/${PART_SLUGS[part]}"><h2>${t.parts[part]}</h2><p class="big">${big}</p>
      <p class="muted small">${data === undefined ? "" : `${t.fetchedAt} ${when(lang, snap.fetchedAt[part])}`}<br>${nextRun(lang, input.sync, part)}</p>
      ${error ? `<p class="error small">${t.failed}: ${esc(error)}</p>` : ""}</a>`;
  });
  const summary = snap.summary === undefined ? "" : `<section><h2>${t.parts.summary}</h2>${view(lang, snap.summary)}</section>`;
  const api = `<section><h2>${t.api}</h2><p class="muted">${t.apiBody}</p><p><code>${esc(input.apiUrl)}</code></p><p class="small"><a href="/api/v1/openapi.json">openapi.json</a></p></section>`;
  return page(lang, t.title, `${nav(lang, null, input.renewal)}<p class="muted small">${t.note}</p>${status(lang, input)}<div class="tiles">${tiles.join("")}</div>${summary}${api}`, kind, BASE);
}

/** One part: when it was fetched, its data, and the details of each entry. Lab results are drawn. */
export function partPage(lang: Lang, part: PartName, input: DashboardInput): string {
  const t = T[lang];
  const snap = input.snapshot;
  const back = `${BASE}/${PART_SLUGS[part]}`;
  const kind = input.loggedIn ? "ok" : "neutral";
  const data = part === "labResults" ? snap?.labResults?.results : snap?.[part];
  const head = `${nav(lang, part, input.renewal)}<div class="row"><span class="muted small">${data === undefined ? t.notFetched : `${t.fetchedAt} ${when(lang, snap?.fetchedAt[part])}`}${part === "labResults" && snap?.labResults ? ` · ${esc(snap.labResults.from)} – ${esc(snap.labResults.to)}` : ""}</span><span class="muted small">${nextRun(lang, input.sync, part)}</span>${refreshButton(lang, input, part)}</div>${snap?.errors[part] ? `<p class="error small">${esc(snap.errors[part])}</p>` : ""}`;
  if (!snap || data === undefined) return page(lang, t.parts[part], `${head}${snap ? "" : `<p>${t.none}</p>`}`, kind, back);

  if (part === "labResults") {
    const series = labSeries(data);
    const fmtRange = (s: LabSeries) => (s.low === undefined && s.high === undefined ? "—" : `${s.low ?? ""} – ${s.high ?? ""}`);
    const charts = series
      .filter((s) => s.points.length > 1)
      .map((s) => {
        const last = s.points.at(-1)!;
        return `<div class="lab"><h3>${esc(s.name)}</h3><p class="small ${outside(s, last.value) ? "out" : "muted"}">${t.latest}: ${esc(last.text)}${s.unit ? ` ${esc(s.unit)}` : ""} · ${esc(last.at.slice(0, 10))}</p>${labChart(s)}<p class="muted small">${t.range}: ${esc(fmtRange(s))} · ${t.values}: ${s.points.length}</p></div>`;
      });
    const rows = series.map((s) => {
      const last = s.points.at(-1)!;
      const flag = outside(s, last.value) ? ` <span class="out">(${t.outside})</span>` : "";
      return `<tr><td>${esc(s.name)}</td><td>${esc(last.text)}${flag}</td><td>${esc(s.unit ?? "")}</td><td>${esc(fmtRange(s))}</td><td>${esc(last.at.slice(0, 10))}</td><td>${s.points.length}</td></tr>`;
    });
    const table = series.length
      ? `<div class="scroll"><table><thead><tr><th>${t.analysis}</th><th>${t.latest}</th><th>${t.unit}</th><th>${t.range}</th><th>${t.date}</th><th>${t.values}</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
      : `<p class="muted">${t.noLab}</p>`;
    return page(lang, t.parts[part], `${head}${charts.length ? `<div class="charts">${charts.join("")}</div>` : ""}${table}<section><h2>${t.all}</h2>${view(lang, data)}</section>`, kind, back);
  }

  const detailsKey = DETAILS[part];
  const details = detailsKey ? Object.entries(snap[detailsKey]).filter(([, v]) => v !== undefined) : [];
  const detailList = details.length
    ? `<section><h2>${t.details}</h2>${details.map(([id, v]) => `<details><summary>${esc(id)}</summary>${view(lang, v)}</details>`).join("")}</section>`
    : "";
  const errors = Object.entries(snap.errors).filter(([k]) => detailsKey && k.startsWith(`${detailsKey} `));
  const errorList = errors.length ? `<ul class="plain small error">${errors.map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join("")}</ul>` : "";
  return page(lang, t.parts[part], `${head}${view(lang, data)}${errorList}${detailList}`, kind, back);
}

// --- Prescription renewal (only when the server allows it) ---

const renewalPage = (lang: Lang, title: string, body: string, back?: string) => shell(lang, title, body, { pill: T[lang].renewals, kind: "neutral", head: CSS, wide: true, back });

/** The medicine that can be renewed, live from sundhed.dk, or why it cannot be shown. */
export function renewalsPage(lang: Lang, state: { loggedIn: boolean; overview?: RenewalOverview; error?: string }): string {
  const t = T[lang];
  const head = `${nav(lang, "renewals", true)}<p class="muted small">${t.renewalNote}</p>`;
  if (!state.loggedIn || !state.overview) {
    const why = state.error ? `<p class="error small">${esc(state.error)}</p>` : `<p>${t.renewalLogin}</p><p><a href="/connect">${t.login}</a></p>`;
    return renewalPage(lang, t.renewals, `${head}${why}`, RENEWALS);
  }
  const o = state.overview;
  const name = (m: RenewableMedicine) => `${esc(m.drug)}${m.strength ? ` <span class="muted">${esc(m.strength)}</span>` : ""}${m.form ? ` <span class="muted small">${esc(m.form)}</span>` : ""}`;
  const rows = o.medicines.map(
    (m) =>
      `<tr><td>${name(m)}</td><td>${m.renewable ? `<a href="${RENEWALS}/${encodeURIComponent(m.id)}">${t.renew}</a>` : `<span class="muted small">${t.cannot}: ${esc(m.reason ?? "")}</span>`}</td></tr>`,
  );
  const list = o.medicines.length
    ? `<div class="scroll"><table><thead><tr><th>${t.medicine}</th><th>${t.status}</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<p class="muted">${t.noRenewable}</p>`;
  const requests = Array.isArray(o.requests) && o.requests.length === 0 ? "" : `<section><h2>${t.requests}</h2>${view(lang, o.requests)}</section>`;
  return renewalPage(lang, t.renewals, `${head}${o.hasDoctor ? "" : `<p class="error small">${t.noDoctor}</p>`}${list}${requests}`, RENEWALS);
}

/** The form for one medicine: package, number of packages and a tick to confirm. Sending it renews. */
export function renewalFormPage(lang: Lang, c: { medicine: RenewableMedicine; packages: RenewalPackage[]; defaultPackage?: string; maxQuantity: number }, error?: string): string {
  const t = T[lang];
  const picked = c.defaultPackage ?? c.packages[0]?.number;
  const radios = c.packages
    .map((p) => `<label class="choice"><input type="radio" name="packageNumber" value="${esc(p.number)}" required${p.number === picked ? " checked" : ""}> ${esc(p.text)}</label>`)
    .join("");
  const form = `<form method="post" action="${RENEWALS}" class="renew">
    <input type="hidden" name="id" value="${esc(c.medicine.id)}">
    <fieldset><legend>${t.pkg}</legend>${radios}</fieldset>
    <label>${t.quantity} <input type="number" name="quantity" min="1" max="${c.maxQuantity}" value="1" required></label>
    <label class="choice"><input type="checkbox" name="confirm" value="1" required> ${t.confirm}</label>
    <div class="row"><button type="submit">${t.send}</button><a href="${RENEWALS}">${t.cancel}</a></div>
  </form>`;
  const style = `<style>.renew{display:grid;gap:14px;max-width:520px;margin:16px 0}.renew fieldset{border:1px solid var(--line);border-radius:12px;padding:10px 14px}.choice{display:block;margin:4px 0}.renew input[type=number]{width:5em;margin-left:8px}</style>`;
  const back = `${RENEWALS}/${encodeURIComponent(c.medicine.id)}`;
  return renewalPage(lang, t.renewals, `${style}${nav(lang, "renewals", true)}<h2>${esc(c.medicine.drug)}${c.medicine.strength ? ` <span class="muted">${esc(c.medicine.strength)}</span>` : ""}</h2><p class="muted small">${t.choose}</p>${error ? `<p class="error small">${esc(error)}</p>` : ""}${form}`, back);
}

/** After sending: what was asked for, or why nothing was sent. */
export function renewalResultPage(lang: Lang, result: { drug: string; pkg: string; quantity: number } | { error: string }): string {
  const t = T[lang];
  const body =
    "error" in result
      ? `<h2>${t.notSent}</h2><p class="error">${esc(result.error)}</p>`
      : `<h2>${t.sent}</h2><p>${esc(t.sentBody(result.drug, result.pkg, result.quantity))}</p>`;
  return renewalPage(lang, t.renewals, `${nav(lang, "renewals", true)}${body}<p><a href="${RENEWALS}">${t.renewals}</a></p>`);
}

export const renewalTexts = (lang: Lang) => ({ mustConfirm: T[lang].mustConfirm });
