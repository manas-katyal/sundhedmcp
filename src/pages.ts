// Server-rendered pages for hosted mode: first run, the OAuth sign-in, the status
// page and the /connect page where the owner logs in with MitID from afar.
// Danish by default, with a DK | EN toggle remembered in a cookie.
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type Lang = "da" | "en";
export const LANG_COOKIE = "sundhed_lang";

/** ?lang= wins, then the cookie, then Danish. */
export function langOf(req: { query?: unknown; headers: { cookie?: string } }): Lang {
  const q = (req.query as Record<string, unknown> | undefined)?.lang;
  if (q === "da" || q === "en") return q;
  const c = String(req.headers.cookie ?? "").split(/;\s*/).find((x) => x.startsWith(`${LANG_COOKIE}=`))?.slice(LANG_COOKIE.length + 1);
  return c === "en" ? "en" : "da";
}

const T = {
  da: {
    footer: "SundhedMCP · kun læseadgang · kører på din egen server · ikke tilknyttet sundhed.dk",
    serverPassword: "Serverens adgangskode",
    allowTitle: "Giv adgang?", allowPill: "Anmodning om login", anApp: "En app",
    allowBody: (who: string) => `${who} vil have læseadgang til din journal på sundhed.dk gennem denne server: medicin, recepter, prøvesvar, vaccinationer og henvisninger.`,
    allowBack: (host: string) => `Efter login sendes du tilbage til <b>${host}</b>. Stop, hvis det ikke er der, du kom fra.`,
    allowButton: "Giv adgang",
    signedIn: "Logget ind", backTo: (host: string) => `Sender dig tilbage til <b>${host}</b>.`, ifNothing: (a: string) => `Hvis der ikke sker noget, så ${a}.`, continueTo: (host: string) => `fortsæt til ${host}`,
    already: "Allerede logget ind", alreadyBody: "Dette login er gennemført. Gå tilbage til din assistent.",
    failed: "Login mislykkedes", notSignedIn: "Ikke logget ind",
    notConfigured: "Ikke sat op", setupNeeded: "Opsætning mangler", setVars: "Sæt disse variabler hos din host, og deploy igen:",
    running: "Serveren kører", runningPill: "Kører", addConnector: "Tilføj denne adresse i din assistent som custom connector:",
    session: "sundhed.dk-session", loggedIn: "logget ind", notLoggedIn: "ikke logget ind", loginMitid: "Log på med MitID",
    firstTitle: "Vælg en adgangskode", firstPill: "Første opstart",
    firstBody: "Din SundhedMCP-server kører. Vælg den adgangskode, der beskytter den. Du skal bruge den, når du tilføjer connectoren i Claude, og før hvert MitID-login.",
    firstNote: "Den gemmes hashet på serverens volume. Den kan ikke gendannes, så gem den i din adgangskodemanager.",
    pwLabel: (n: number) => `Adgangskode (mindst ${n} tegn)`, pwRepeat: "Gentag den", save: "Gem adgangskode",
    connectTitle: "Log på sundhed.dk", ownerOnly: "Kun for ejeren",
    connectSignin: "Log på skal ske på en computer: MitID vil bede om en QR-kode, som du scanner med MitID-appen på din telefon. Denne side viser serverens browser, så du kan logge på med MitID. Bevis først, at det er dig.", continue: "Fortsæt",
    mitidTitle: "Log på med MitID",
    computerNote: "Brug en computer til denne side. Åbn den ikke på telefonen: MitID beder om en QR-kode, og den skal scannes med MitID-appen på din telefon, ikke den enhed, koden vises på.",
    mitidHelp: "Brug en computer. Når MitID beder om en QR-kode, skal du scanne den med MitID-appen på din telefon. Dette er serverens browser, åbnet på MitID. Klik på feltet til bruger-ID, skriv dit MitID bruger-ID i feltet nedenfor, tryk Enter og godkend i MitID-appen.",
    waiting: "Venter på login", scrollUp: "Rul op", scrollDown: "Rul ned", startOver: "Start forfra",
    screenAlt: "Serverens browser på sundhed.dk", typeLabel: "Skriv i det markerede felt", typePlaceholder: "Klik på et felt ovenfor, og skriv så her",
    done: "Logget ind. Gå tilbage til din assistent; du kan lukke denne side.",
    qr: "MitID vil have dig til at scanne en QR-kode. Den kan ikke scannes fra den samme telefon: åbn denne side på en computer, og scan koden med MitID-appen på din telefon.",
    langLabel: "Sprog",
  },
  en: {
    footer: "SundhedMCP · read-only · self-hosted · not affiliated with sundhed.dk",
    serverPassword: "Server password",
    allowTitle: "Allow access?", allowPill: "Sign-in request", anApp: "An app",
    allowBody: (who: string) => `${who} wants read-only access to your sundhed.dk record through this server: medicine, prescriptions, test results, vaccinations and referrals.`,
    allowBack: (host: string) => `After signing in you are sent back to <b>${host}</b>. Stop if that is not where you came from.`,
    allowButton: "Allow access",
    signedIn: "Signed in", backTo: (host: string) => `Taking you back to <b>${host}</b>.`, ifNothing: (a: string) => `If nothing happens, ${a}.`, continueTo: (host: string) => `continue to ${host}`,
    already: "Already signed in", alreadyBody: "This sign-in went through. Go back to your assistant.",
    failed: "Sign-in failed", notSignedIn: "Not signed in",
    notConfigured: "Not configured", setupNeeded: "Setup needed", setVars: "Set these variables on your host, then redeploy:",
    running: "Server is running", runningPill: "Running", addConnector: "Add this address to your assistant as a custom connector:",
    session: "sundhed.dk session", loggedIn: "logged in", notLoggedIn: "not logged in", loginMitid: "Log in with MitID",
    firstTitle: "Choose a password", firstPill: "First run",
    firstBody: "Your SundhedMCP server is running. Choose the password that protects it. You will use it when you add the connector in Claude and before each MitID login.",
    firstNote: "It is stored hashed on this server's volume. There is no way to recover it, so keep it in your password manager.",
    pwLabel: (n: number) => `Password (at least ${n} characters)`, pwRepeat: "Repeat it", save: "Save password",
    connectTitle: "Log in to sundhed.dk", ownerOnly: "Owner only",
    connectSignin: "Do this on a computer: MitID will ask for a QR code, which you scan with the MitID app on your phone. This page shows the server's browser so you can log in with MitID. First, prove it is you.", continue: "Continue",
    mitidTitle: "Log in with MitID",
    computerNote: "Use a computer for this page. Do not open it on your phone: MitID will ask for a QR code, and it must be scanned with the MitID app on your phone, not the device showing the code.",
    mitidHelp: "Use a computer. When MitID asks for a QR code, scan it with the MitID app on your phone. This is the server's browser, open on MitID. Click the user ID field, type your MitID user ID in the box below, press Enter and approve in the MitID app.",
    waiting: "Waiting for login", scrollUp: "Scroll up", scrollDown: "Scroll down", startOver: "Start over",
    screenAlt: "The server's browser showing sundhed.dk", typeLabel: "Type into the focused field", typePlaceholder: "Click a field above, then type here",
    done: "Logged in. Go back to your assistant; you can close this page.",
    qr: "MitID wants you to scan a QR code. It cannot be scanned from the same phone: open this page on a computer and scan the code with the MitID app on your phone.",
    langLabel: "Language",
  },
} as const;

/** Error messages come from the server in English; show them in the page's language. */
const DA_ERRORS: Record<string, string> = {
  "Wrong password.": "Forkert adgangskode.",
  "Too many attempts. Try again in a few minutes.": "For mange forsøg. Prøv igen om nogle minutter.",
  "Too many attempts. Try again in 15 minutes.": "For mange forsøg. Prøv igen om 15 minutter.",
  "This server already has a password.": "Serveren har allerede en adgangskode.",
  "The two passwords are not the same.": "De to adgangskoder er ikke ens.",
  "This sign-in page has expired or the server restarted. Go back to your assistant, click Connect again, and enter the password within 30 minutes.":
    "Denne login-side er udløbet, eller serveren er genstartet. Gå tilbage til din assistent, klik Connect igen, og skriv adgangskoden inden for 30 minutter.",
};
export const tr = (lang: Lang, message: string) => (lang === "da" ? (DA_ERRORS[message] ?? message.replace(/^Use at least (\d+) characters\.$/, "Brug mindst $1 tegn.")) : message);

type Kind = "neutral" | "ok" | "error";

/** `back` is the GET address to return to after switching language; leave it out on pages that answer a form. */
export function shell(lang: Lang, title: string, body: string, opts: { kind?: Kind; pill?: string; head?: string; wide?: boolean; back?: string } = {}): string {
  const pill = opts.pill ? `<div class="pill ${opts.kind ?? "neutral"}">${esc(opts.pill)}</div>` : "";
  const to = (l: Lang) => `/lang/${l}?back=${encodeURIComponent(opts.back ?? "/")}`;
  const toggle = opts.back
    ? `<nav class="langs" aria-label="${T[lang].langLabel}"><a href="${to("da")}" hreflang="da" lang="da"${lang === "da" ? ' class="on" aria-current="true"' : ""}>DK</a><a href="${to("en")}" hreflang="en" lang="en"${lang === "en" ? ' class="on" aria-current="true"' : ""}>EN</a></nav>`
    : "";
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(title)} · SundhedMCP</title><link rel="icon" href="/favicon.svg?v=6" type="image/svg+xml"><link rel="icon" href="/favicon.ico?v=6" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=6">${opts.head ?? ""}
<style>
  :root{--bg:#faf9f7;--card:#ffffff;--ink:#0a0a0a;--on-ink:#f5f5f3;--muted:#5c5c5e;--line:#e8e8ea;--ok:#0f7b4f;--err:#c1352a}
  @media (prefers-color-scheme:dark){:root{--bg:#0c0c0d;--card:#1b1b1d;--ink:#f2f2f0;--on-ink:#0c0c0d;--muted:#a1a1a6;--line:#2a2a2d;--ok:#3fbf85;--err:#ef6b5f}}
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.5 "IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
  .wrap{max-width:${opts.wide ? "1060px" : "460px"};margin:0 auto;padding:${opts.wide ? "24px" : "12vh"} 16px 48px}
  .brand{display:flex;align-items:center;gap:10px;margin:0 0 20px;font-weight:500;font-size:17px}
  .mark{width:24px;height:24px;display:block}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px}
  .pill{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--muted);margin:0 0 10px}
  .pill::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--muted)}
  .pill.ok{color:var(--ok)}.pill.ok::before{background:var(--ok)}
  .pill.error{color:var(--err)}.pill.error::before{background:var(--err)}
  h1{font-size:24px;line-height:1.2;font-weight:500;margin:0 0 12px}
  p{margin:0 0 12px}.muted{color:var(--muted)}.error{color:var(--err)}.small{font-size:13px}
  label{display:block;font-weight:500;font-size:14px;margin:18px 0 6px}
  input{width:100%;font:inherit;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
  input:focus{outline:2px solid var(--ink);outline-offset:1px;border-color:transparent}
  button{font:inherit;font-weight:500;padding:12px 16px;border:0;border-radius:10px;background:var(--ink);color:var(--on-ink);cursor:pointer}
  button.full{width:100%;margin-top:14px}
  button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
  button:focus-visible{outline:2px solid var(--ok);outline-offset:2px}
  code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);border:1px solid var(--line);padding:6px 10px;border-radius:8px;display:inline-block;word-break:break-all}
  ul.rows{list-style:none;padding:0;margin:16px 0 6px}
  ul.rows li{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid var(--line)}
  ul.rows li:last-child{border-bottom:1px solid var(--line)}
  ul.rows .r{color:var(--muted)}
  footer{margin-top:20px;font-size:12px;color:var(--muted)}
  .top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 20px}.top .brand{margin:0}
  .langs{display:inline-flex;gap:2px;padding:2px;border-radius:999px;background:var(--line)}
  .langs a{padding:3px 9px;border-radius:999px;font:500 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);text-decoration:none}
  .langs a.on{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.1)}
</style>
<body><div class="wrap">
  <div class="top"><div class="brand"><svg class="mark" viewBox="0 0 512 512" aria-hidden="true"> <defs> <linearGradient id="m-chip" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#6b2a6e"/><stop offset="0.45" stop-color="#b8456f"/><stop offset="0.75" stop-color="#e0566f"/><stop offset="1" stop-color="#ff9a5a"/></linearGradient> <linearGradient id="m-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient> <linearGradient id="m-heart" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#fdf1f4"/></linearGradient> <linearGradient id="m-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.55" stop-color="#fff" stop-opacity="0"/></linearGradient> <filter id="m-soft" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#2a1537" flood-opacity="0.3"/></filter> </defs> <rect width="512" height="512" rx="114" fill="url(#m-chip)"/> <rect width="512" height="512" rx="114" fill="url(#m-gloss)"/> <rect x="3" y="3" width="506" height="506" rx="111" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="6"/> <g transform="translate(256 262) scale(0.9) translate(-256 -262)"> <path d="M256 372C168 314 132 268 132 222c0-40 30-70 68-70 24 0 44 12 56 32 12-20 32-32 56-32 38 0 68 30 68 70 0 46-36 92-124 150z" fill="url(#m-heart)" filter="url(#m-soft)"/> <path d="M256 372C168 314 132 268 132 222c0-40 30-70 68-70 24 0 44 12 56 32 12-20 32-32 56-32 38 0 68 30 68 70 0 46-36 92-124 150z" fill="url(#m-shine)"/> </g> </svg><span>SundhedMCP</span></div>${toggle}</div>
  <div class="card">${pill}<h1>${esc(title)}</h1>${body}</div>
  <footer>${T[lang].footer}</footer>
</div></body></html>`;
}

export function loginPage(lang: Lang, opts: { requestId: string; clientName?: string; returnTo?: string; error?: string; back?: string }): string {
  const t = T[lang];
  const who = opts.clientName ? `<b>${esc(opts.clientName)}</b>` : t.anApp;
  const back = opts.returnTo ? `<p class="muted">${t.allowBack(esc(opts.returnTo))}</p>` : "";
  return shell(
    lang,
    t.allowTitle,
    `<p>${t.allowBody(who)}</p>${back}
     ${opts.error ? `<p class="error">${esc(tr(lang, opts.error))}</p>` : ""}
     <form method="post" action="/login">
       <input type="hidden" name="request" value="${esc(opts.requestId)}">
       <label for="pw">${t.serverPassword}</label>
       <input id="pw" type="password" name="password" autofocus autocomplete="current-password" required>
       <button class="full" type="submit">${t.allowButton}</button>
     </form>`,
    { pill: t.allowPill, back: opts.back },
  );
}

export function returningPage(lang: Lang, url: string): string {
  const t = T[lang];
  const host = esc(new URL(url).host);
  return shell(
    lang,
    t.signedIn,
    `<p>${t.backTo(host)}</p><p class="muted">${t.ifNothing(`<a href="${esc(url)}">${t.continueTo(host)}</a>`)}</p>`,
    { kind: "ok", pill: t.signedIn, head: `<meta http-equiv="refresh" content="0;url=${esc(url)}">` },
  );
}

export const signedInPage = (lang: Lang) => shell(lang, T[lang].already, `<p>${T[lang].alreadyBody}</p>`, { kind: "ok", pill: T[lang].signedIn });

export const signInFailedPage = (lang: Lang, message: string) => shell(lang, T[lang].failed, `<p>${esc(tr(lang, message))}</p>`, { kind: "error", pill: T[lang].notSignedIn });

export function statusPage(lang: Lang, input: { problems: string[]; mcpUrl: string; loggedIn: boolean }): string {
  const t = T[lang];
  if (input.problems.length) {
    return shell(lang, t.notConfigured, `<p>${t.setVars}</p><ul class="rows">${input.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`, {
      kind: "error",
      pill: t.setupNeeded,
      back: "/",
    });
  }
  return shell(
    lang,
    t.running,
    `<p>${t.addConnector}</p><p><code>${esc(input.mcpUrl)}</code></p>
     <ul class="rows"><li>${t.session}<span class="r">${input.loggedIn ? t.loggedIn : t.notLoggedIn}</span></li></ul>
     <p><a href="/connect">${t.loginMitid}</a></p>
     <p class="muted small">${t.computerNote}</p>`,
    { kind: "ok", pill: t.runningPill, back: "/" },
  );
}

/** First run: the person who deployed the server chooses its password. */
export function firstRunPage(lang: Lang, opts: { minLength: number; error?: string }): string {
  const t = T[lang];
  return shell(
    lang,
    t.firstTitle,
    `<p>${t.firstBody}</p>
     <p class="muted small">${t.firstNote}</p>
     ${opts.error ? `<p class="error">${esc(tr(lang, opts.error))}</p>` : ""}
     <form method="post" action="/setup">
       <label for="pw">${t.pwLabel(opts.minLength)}</label>
       <input id="pw" type="password" name="password" minlength="${opts.minLength}" autocomplete="new-password" autofocus required>
       <label for="pw2">${t.pwRepeat}</label>
       <input id="pw2" type="password" name="confirm" minlength="${opts.minLength}" autocomplete="new-password" required>
       <button class="full" type="submit">${t.save}</button>
     </form>`,
    { pill: t.firstPill, back: opts.error ? undefined : "/" },
  );
}

export function connectSignInPage(lang: Lang, error?: string): string {
  const t = T[lang];
  return shell(
    lang,
    t.connectTitle,
    `<p>${t.connectSignin}</p>
     ${error ? `<p class="error">${esc(tr(lang, error))}</p>` : ""}
     <form method="post" action="/connect/signin">
       <label for="pw">${t.serverPassword}</label>
       <input id="pw" type="password" name="password" autofocus autocomplete="current-password" required>
       <button class="full" type="submit">${t.continue}</button>
     </form>`,
    { pill: t.ownerOnly, back: error ? undefined : "/connect" },
  );
}

/** The remote browser: a live screenshot you click on, plus a field for typing. */
export function connectPage(lang: Lang, viewport: { width: number; height: number }): string {
  const t = T[lang];
  const body = `
  <p class="muted">${t.mitidHelp}</p>
  <div class="bar">
    <div class="status"><span class="t-success-check" id="check" data-state="out" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="var(--ok)"/><path d="M7 12.5l3.3 3.3L17 9" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><div class="pill" id="state" role="status"><span class="t-text-swap" id="statetext">${t.waiting}</span></div></div>
    <div class="actions"><button class="ghost" id="up" type="button">${t.scrollUp}</button><button class="ghost" id="down" type="button">${t.scrollDown}</button><button class="ghost" id="restart" type="button">${t.startOver}</button></div>
  </div>
  <p class="qrnote" id="qrnote" hidden>${t.qr}</p>
  <div class="screen"><img id="screen" alt="${t.screenAlt}" width="${viewport.width}" height="${viewport.height}"></div>
  <div class="typing">
    <label for="keys">${t.typeLabel}</label>
    <div class="row"><input id="keys" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${t.typePlaceholder}">
    <button class="ghost" data-key="Backspace" type="button">⌫</button><button class="ghost" data-key="Tab" type="button">Tab</button><button data-key="Enter" type="button">Enter</button></div>
  </div>
  <script>
  const W = ${viewport.width}, H = ${viewport.height};
  const img = document.getElementById("screen"), state = document.getElementById("state"), keys = document.getElementById("keys");
  const send = (ev) => fetch("/connect/input", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ev) }).then(refresh);
  let pending = false, url = null, done = false;
  async function refresh() {
    if (pending) return; pending = true;
    try {
      const r = await fetch("/connect/frame", { cache: "no-store" });
      if (r.status === 401) return location.reload();
      if (r.ok) { const u = URL.createObjectURL(await r.blob()); img.src = u; if (url) URL.revokeObjectURL(url); url = u; }
    } finally { pending = false; }
  }
  setInterval(refresh, 700); refresh();
  setInterval(async () => {
    const s = await fetch("/connect/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    document.getElementById("qrnote").hidden = !(s && s.qr && !s.loggedIn);
    if (s && s.loggedIn && !done) {
      done = true;
      const text = document.getElementById("statetext");
      text.classList.add("is-exit");
      setTimeout(() => {
        text.textContent = ${JSON.stringify(t.done)};
        state.className = "pill ok"; text.classList.remove("is-exit"); text.classList.add("is-enter-start");
        void text.offsetHeight; text.classList.remove("is-enter-start");
        const check = document.getElementById("check"); check.hidden = false; check.setAttribute("data-state", "in");
      }, 150);
    }
  }, 2000);
  img.addEventListener("click", (e) => {
    const b = img.getBoundingClientRect();
    send({ type: "click", x: Math.round((e.clientX - b.left) * W / b.width), y: Math.round((e.clientY - b.top) * H / b.height) });
  });
  img.addEventListener("wheel", (e) => { e.preventDefault(); send({ type: "wheel", dy: Math.round(e.deltaY) }); }, { passive: false });
  document.getElementById("up").onclick = () => send({ type: "wheel", dy: -400 });
  document.getElementById("down").onclick = () => send({ type: "wheel", dy: 400 });
  document.getElementById("restart").onclick = () => fetch("/connect/restart", { method: "POST" }).then(refresh);
  document.querySelectorAll("[data-key]").forEach((b) => b.onclick = () => send({ type: "key", key: b.dataset.key }));
  keys.addEventListener("input", () => { if (keys.value) { send({ type: "text", text: keys.value }); keys.value = ""; } });
  keys.addEventListener("keydown", (e) => {
    if (["Enter", "Backspace", "Tab", "Escape"].includes(e.key) && !keys.value) { e.preventDefault(); send({ type: "key", key: e.key }); }
  });
  </script>`;
  const head = `<style>
    .bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:6px 0 12px}
    .bar .pill{margin:0}
    .status{display:flex;align-items:center;gap:8px}
    .pill.ok::before{display:none}
    /* Success check and text states swap, from transitions.dev */
    .t-success-check{display:none;width:22px;height:22px;transform-origin:center;opacity:0}
    .t-success-check svg{display:block;width:22px;height:22px;overflow:visible}
    .t-success-check svg path{stroke-dasharray:20;stroke-dashoffset:20}
    .t-success-check[data-state="in"]{display:inline-block;animation:t-check-fade 500ms cubic-bezier(.22,1,.36,1) forwards,t-check-rotate 500ms cubic-bezier(.22,1,.36,1) forwards,t-check-blur 500ms cubic-bezier(.22,1,.36,1) forwards,t-check-bob 500ms cubic-bezier(.34,1.35,.64,1) forwards}
    .t-success-check[data-state="in"] svg path{animation:t-check-draw 500ms cubic-bezier(.22,1,.36,1) 80ms forwards}
    @keyframes t-check-fade{from{opacity:0}to{opacity:1}}
    @keyframes t-check-rotate{from{transform:rotate(80deg)}to{transform:rotate(0)}}
    @keyframes t-check-blur{from{filter:blur(10px)}to{filter:blur(0)}}
    @keyframes t-check-bob{from{translate:0 16px}to{translate:0 0}}
    @keyframes t-check-draw{to{stroke-dashoffset:0}}
    .t-text-swap{display:inline-block;transition:transform 150ms ease-in-out,filter 150ms ease-in-out,opacity 150ms ease-in-out}
    .t-text-swap.is-exit{transform:translateY(-4px);filter:blur(2px);opacity:0}
    .t-text-swap.is-enter-start{transform:translateY(4px);filter:blur(2px);opacity:0;transition:none}
    @media (prefers-reduced-motion:reduce){.t-success-check[data-state="in"]{animation:none;opacity:1}.t-success-check svg path{animation:none!important;stroke-dashoffset:0!important}.t-text-swap{transition:none}}.actions{display:flex;gap:8px;flex-wrap:wrap}.actions button{padding:8px 12px;font-size:14px}
    .qrnote{margin:0 0 12px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg);font-size:14px}
    [hidden]{display:none!important}
    .screen{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
    .screen img{display:block;width:100%;height:auto;cursor:pointer}
    .typing .row{display:flex;gap:8px}.typing .row input{flex:1;min-width:0}.typing .row button{padding:10px 14px}
  </style>`;
  return shell(lang, t.mitidTitle, body, { head, wide: true, back: "/connect" });
}
