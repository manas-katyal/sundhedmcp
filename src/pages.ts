// Server-rendered pages for hosted mode: the OAuth sign-in, the status page and
// the /connect page where the owner logs in with MitID from afar.
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Kind = "neutral" | "ok" | "error";

export function shell(title: string, body: string, opts: { kind?: Kind; pill?: string; head?: string; wide?: boolean } = {}): string {
  const pill = opts.pill ? `<div class="pill ${opts.kind ?? "neutral"}">${esc(opts.pill)}</div>` : "";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(title)} · SundhedMCP</title>${opts.head ?? ""}
<style>
  :root{--bg:#f4f3ee;--card:#faf9f5;--ink:#1a1b19;--on-ink:#f4f3ee;--muted:#62655f;--line:#dfdfd7;--ok:#2f7a5c;--err:#b3261e}
  @media (prefers-color-scheme:dark){:root{--bg:#151614;--card:#1c1d1b;--ink:#ecede8;--on-ink:#151614;--muted:#a6a9a2;--line:#2b2d2a;--ok:#6cc39c;--err:#ff8a7a}}
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
  .wrap{max-width:${opts.wide ? "1060px" : "460px"};margin:0 auto;padding:${opts.wide ? "24px" : "12vh"} 16px 48px}
  .brand{display:flex;align-items:center;gap:10px;margin:0 0 20px;font-weight:500;font-size:17px}
  .mark{width:24px;height:24px;border-radius:7px;background:var(--ink);display:grid;place-items:center}
  .mark svg{width:12px;height:12px}.mark path{stroke:var(--on-ink)}
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
  <div class="brand"><span class="mark"><svg viewBox="0 0 12 12" fill="none"><path d="M6 1.5v9M1.5 6h9" stroke-width="2.2" stroke-linecap="round"/></svg></span><span>SundhedMCP</span></div>
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
  <p class="muted">This is the server's browser on sundhed.dk. Click <b>Log på</b>, choose MitID, type your MitID user ID in the field below and approve in the MitID app.</p>
  <div class="bar">
    <div class="pill" id="state">Waiting for login</div>
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
  let pending = false, url = null;
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
    if (s && s.loggedIn) { state.textContent = "Logged in. Go back to your assistant; you can close this page."; state.className = "pill ok"; }
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
    .bar .pill{margin:0}.actions{display:flex;gap:8px;flex-wrap:wrap}.actions button{padding:8px 12px;font-size:14px}
    .screen{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
    .screen img{display:block;width:100%;height:auto;cursor:pointer}
    .typing .row{display:flex;gap:8px}.typing .row input{flex:1;min-width:0}.typing .row button{padding:10px 14px}
  </style>`;
  return shell("Log in with MitID", body, { head, wide: true });
}
