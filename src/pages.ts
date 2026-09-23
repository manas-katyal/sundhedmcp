// Server-rendered pages for hosted mode: the OAuth sign-in, the status page and
// the /connect page where the owner logs in with MitID from afar.
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Kind = "neutral" | "ok" | "error";

export function shell(title: string, body: string, opts: { kind?: Kind; pill?: string; head?: string; wide?: boolean } = {}): string {
  const pill = opts.pill ? `<div class="pill ${opts.kind ?? "neutral"}">${esc(opts.pill)}</div>` : "";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(title)} · SundhedMCP</title><link rel="icon" href="/favicon.svg?v=4" type="image/svg+xml"><link rel="icon" href="/favicon.ico?v=4" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4">${opts.head ?? ""}
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
</style>
<body><div class="wrap">
  <div class="brand"><svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="sc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffa3be"/><stop offset="0.38" stop-color="#ff6f96"/><stop offset="0.72" stop-color="#ff4d7a"/><stop offset="1" stop-color="#ff2d55"/></linearGradient><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="512" height="512" rx="114" fill="url(#sc)"/><rect width="512" height="512" rx="114" fill="url(#sg)"/><g fill="#fff"><path transform="translate(131.35 401.01) scale(0.41551 -0.41551)" d="M299 -12Q210 -12 146.5 20.0Q83 52 39 104L128 190Q164 148 208.5 126.0Q253 104 307 104Q368 104 399.0 131.0Q430 158 430 202Q430 226 421.5 243.5Q413 261 392.0 273.0Q371 285 335 291L269 301Q199 312 152.5 338.0Q106 364 83.0 406.0Q60 448 60 504Q60 567 91.0 613.0Q122 659 178.5 684.5Q235 710 313 710Q392 710 451.0 683.5Q510 657 552 607L462 522Q436 554 399.0 574.0Q362 594 306 594Q250 594 221.0 572.5Q192 551 192 512Q192 485 202.0 468.0Q212 451 234.0 441.5Q256 432 289 425L354 413Q425 401 471.0 375.0Q517 349 539.0 308.5Q561 268 561 210Q561 144 530.5 94.0Q500 44 441.0 16.0Q382 -12 299 -12Z"/></g></svg><span>SundhedMCP</span></div>
  <div class="card">${pill}<h1>${esc(title)}</h1>${body}</div>
  <footer>SundhedMCP · read-only · self-hosted · not affiliated with sundhed.dk</footer>
</div></body></html>`;
}

export function loginPage(opts: { requestId: string; clientName?: string; returnTo?: string; error?: string }): string {
  const who = opts.clientName ? `<b>${esc(opts.clientName)}</b>` : "An app";
  const back = opts.returnTo ? `<p class="muted">After signing in you are sent back to <b>${esc(opts.returnTo)}</b>. Stop if that is not where you came from.</p>` : "";
  return shell(
    "Allow access?",
    `<p>${who} wants read-only access to your sundhed.dk record through this server: medicine, prescriptions, test results, vaccinations and referrals.</p>${back}
     ${opts.error ? `<p class="error">${esc(opts.error)}</p>` : ""}
     <form method="post" action="/login">
       <input type="hidden" name="request" value="${esc(opts.requestId)}">
       <label for="pw">Server password (ADMIN_PASSWORD)</label>
       <input id="pw" type="password" name="password" autofocus autocomplete="current-password" required>
       <button class="full" type="submit">Allow access</button>
     </form>`,
    { pill: "Sign-in request" },
  );
}

export function returningPage(url: string): string {
  const host = new URL(url).host;
  return shell(
    "Signed in",
    `<p>Taking you back to <b>${esc(host)}</b>.</p><p class="muted">If nothing happens, <a href="${esc(url)}">continue to ${esc(host)}</a>.</p>`,
    { kind: "ok", pill: "Signed in", head: `<meta http-equiv="refresh" content="0;url=${esc(url)}">` },
  );
}

export const signedInPage = () => shell("Already signed in", `<p>This sign-in went through. Go back to your assistant.</p>`, { kind: "ok", pill: "Signed in" });

export const signInFailedPage = (message: string) => shell("Sign-in failed", `<p>${esc(message)}</p>`, { kind: "error", pill: "Not signed in" });

export function statusPage(input: { problems: string[]; mcpUrl: string; loggedIn: boolean }): string {
  if (input.problems.length) {
    return shell(
      "Not configured",
      `<p>Set these variables on your host, then redeploy:</p><ul class="rows">${input.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`,
      { kind: "error", pill: "Setup needed" },
    );
  }
  return shell(
    "Server is running",
    `<p>Add this address to your assistant as a custom connector:</p><p><code>${esc(input.mcpUrl)}</code></p>
     <ul class="rows"><li>sundhed.dk session<span class="r">${input.loggedIn ? "logged in" : "not logged in"}</span></li></ul>
     <p><a href="/connect">Log in with MitID</a></p>`,
    { kind: "ok", pill: "Running" },
  );
}

export function connectSignInPage(error?: string): string {
  return shell(
    "Log in to sundhed.dk",
    `<p>This page shows the server's browser so you can log in with MitID. First, prove it is you.</p>
     ${error ? `<p class="error">${esc(error)}</p>` : ""}
     <form method="post" action="/connect/signin">
       <label for="pw">Server password (ADMIN_PASSWORD)</label>
       <input id="pw" type="password" name="password" autofocus autocomplete="current-password" required>
       <button class="full" type="submit">Continue</button>
     </form>`,
    { pill: "Owner only" },
  );
}

/** The remote browser: a live screenshot you click on, plus a field for typing. */
export function connectPage(viewport: { width: number; height: number }): string {
  const body = `
  <p class="muted">This is the server's browser, open on MitID. Click the user ID field, type your MitID user ID in the box below, press Enter and approve in the MitID app.</p>
  <div class="bar">
    <div class="status"><span class="t-success-check" id="check" data-state="out" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="var(--ok)"/><path d="M7 12.5l3.3 3.3L17 9" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><div class="pill" id="state" role="status"><span class="t-text-swap" id="statetext">Waiting for login</span></div></div>
    <div class="actions"><button class="ghost" id="up" type="button">Scroll up</button><button class="ghost" id="down" type="button">Scroll down</button><button class="ghost" id="restart" type="button">Start over</button></div>
  </div>
  <div class="screen"><img id="screen" alt="The server's browser showing sundhed.dk" width="${viewport.width}" height="${viewport.height}"></div>
  <div class="typing">
    <label for="keys">Type into the focused field</label>
    <div class="row"><input id="keys" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Click a field above, then type here">
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
    if (s && s.loggedIn && !done) {
      done = true;
      const text = document.getElementById("statetext");
      text.classList.add("is-exit");
      setTimeout(() => {
        text.textContent = "Logged in. Go back to your assistant; you can close this page.";
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
    .screen{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
    .screen img{display:block;width:100%;height:auto;cursor:pointer}
    .typing .row{display:flex;gap:8px}.typing .row input{flex:1;min-width:0}.typing .row button{padding:10px 14px}
  </style>`;
  return shell("Log in with MitID", body, { head, wide: true });
}
