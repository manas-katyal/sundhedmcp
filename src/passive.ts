// The page a hosted SundhedMCP serves by default: it runs locally only.
import { createServer } from "node:http";
import { config } from "./config.ts";
import { esc, LANG_COOKIE } from "./pages.ts";

const T = {
  da: {
    title: "SundhedMCP kører kun lokalt",
    body: "Denne server er slået fra. SundhedMCP kører ikke længere på en server: den kører på din egen computer, hvor du selv logger på med MitID i et browservindue. SundhedMCP sender intet videre, men det, din AI læser fra journalen, sendes til den AI-udbyder, du bruger.",
    how: "Sådan kommer du i gang:",
    more: "Se vejledningen på",
    other: "In English",
  },
  en: {
    title: "SundhedMCP runs locally only",
    body: "This server is switched off. SundhedMCP no longer runs on a server: it runs on your own computer, where you log in with MitID yourself in a browser window. SundhedMCP sends nothing anywhere, but what your AI reads from the record goes to the AI provider you use.",
    how: "To get started:",
    more: "See the guide at",
    other: "På dansk",
  },
};

function page(lang: "da" | "en"): string {
  const t = T[lang];
  const other = lang === "da" ? "en" : "da";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.title)}</title><meta name="robots" content="noindex">
<style>
:root{--bg:#faf8f6;--fg:#1d1a22;--muted:#6b6472;--card:#fff;--line:#e8e2e6;--code:#f3eff2}
@media (prefers-color-scheme:dark){:root{--bg:#141217;--fg:#f2eef4;--muted:#a59fab;--card:#1d1a22;--line:#2e2933;--code:#26222b}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:560px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
h1{font-size:22px;margin:0 0 12px}p{margin:0 0 14px}.muted{color:var(--muted);font-size:14px}
pre{background:var(--code);border-radius:10px;padding:12px;overflow-x:auto;font-size:13px;margin:0 0 14px}a{color:inherit}
</style></head><body><main>
<h1>${esc(t.title)}</h1>
<p>${esc(t.body)}</p>
<p>${esc(t.how)}</p>
<pre>git clone https://github.com/manas-katyal/sundhedmcp
cd sundhedmcp &amp;&amp; npm install
claude mcp add sundhedmcp -- node "$PWD/src/stdio.ts"</pre>
<p class="muted">${esc(t.more)} <a href="https://sundhedmcp.dk${lang === "en" ? "/en.html" : "/"}">sundhedmcp.dk</a> · <a href="/?lang=${other}">${esc(t.other)}</a></p>
</main></body></html>`;
}

function langOf(url: URL, cookie: string | undefined): "da" | "en" {
  const q = url.searchParams.get("lang");
  if (q === "da" || q === "en") return q;
  return String(cookie ?? "").includes(`${LANG_COOKIE}=en`) ? "en" : "da";
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  // Every former endpoint (/mcp, OAuth, /connect) is gone for good.
  if (url.pathname !== "/") {
    res.writeHead(410, { "content-type": "application/json" }).end(JSON.stringify({ error: "gone", message: "SundhedMCP runs locally only. See https://sundhedmcp.dk" }));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page(langOf(url, req.headers.cookie)));
});

server.listen(config.port, () => console.log(`[sundhed] passive: hosted mode is off, listening on :${config.port} with an info page only`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
