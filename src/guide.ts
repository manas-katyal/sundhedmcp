// The setup guide for `sundhedmcp serve`: your own computer becomes the
// server, and the guide walks you from a password to a working claude.ai
// connector, one step at a time. Only reachable from this computer.
import express from "express";
import { MIN_PASSWORD_LENGTH, passwordConfigured } from "./config.ts";
import { autostartInstalled, autostartSupported, installAutostart } from "./autostart.ts";
import { esc, langOf, shell, type Lang } from "./pages.ts";
import { status } from "./session.ts";
import { saved } from "./snapshot.ts";
import { store } from "./store.ts";
import { enableFunnel, tailscaleState } from "./tailscale.ts";

export interface GuideOptions {
  port: number;
  /** Called once Funnel is on, with the public address to use from now on. */
  onPublicUrl: (url: string) => void;
  /** Environment for the login agent, so it starts the same server. */
  env: Record<string, string>;
}

/**
 * True only for requests made on this computer. Funnel also connects from
 * 127.0.0.1, so a loopback address is not enough: Funnel requests carry the
 * public host name and forwarding headers.
 */
export function isLocal(req: express.Request, port: number): boolean {
  const host = String(req.headers.host ?? "");
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return false;
  if (req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"]) return false;
  if (Object.keys(req.headers).some((h) => h.startsWith("tailscale-"))) return false;
  const ip = req.socket.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

const T = {
  da: {
    title: "Brug SundhedMCP fra telefonen",
    lead: "Din computer bliver serveren. Følg de fem trin; det tager omkring fem minutter. Din journal forlader kun computeren, når din AI læser den.",
    s1: "Vælg en adgangskode",
    s1do: `Vælg en adgangskode på mindst ${MIN_PASSWORD_LENGTH} tegn, og gem den i din adgangskodemanager. Du skal bruge den i claude.ai og før hvert MitID-login.`,
    s1done: "Adgangskoden er gemt.",
    pw: "Adgangskode", pw2: "Gentag den", save: "Gem adgangskode",
    s2: "Giv computeren en adresse",
    s2install: "Hent Tailscale, installér det, og log ind. Det er gratis. Kom tilbage hertil bagefter; siden opdaterer sig selv.",
    s2installBtn: "Hent Tailscale",
    s2login: "Åbn Tailscale, og log ind. Siden opdaterer sig selv.",
    s2funnel: "Klik knappen. Tailscale giver din computer en fast adresse, som claude.ai kan nå, når computeren er tændt.",
    s2funnelBtn: "Åbn for claude.ai",
    s2links: "Klik linket, slå Funnel til for din computer, og klik så knappen igen:",
    s2done: "Din computers adresse:",
    s3: "Start automatisk",
    s3do: "Klik knappen, så starter SundhedMCP, hver gang du logger ind på computeren.",
    s3btn: "Start ved login",
    s3manual: "Kør denne kommando, hver gang du vil bruge SundhedMCP fra telefonen:",
    s3done: "SundhedMCP starter, hver gang du logger ind.",
    s4: "Tilføj i claude.ai",
    s4steps: [
      "Kopiér adressen herunder.",
      'Åbn claude.ai → Indstillinger → Connectors, og klik <b>Tilføj brugerdefineret connector</b>.',
      "Skriv <b>SundhedMCP</b> som navn, indsæt adressen, og klik <b>Tilføj</b>.",
      "Klik <b>Forbind</b>, skriv din adgangskode, og klik <b>Giv adgang</b>.",
    ],
    copy: "Kopiér", copied: "Kopieret", open: "Åbn claude.ai",
    s4wait: "Venter på, at claude.ai forbinder …",
    s4done: "claude.ai er forbundet. Connectoren virker også i Claude-appen på telefonen.",
    s5: "Log på med MitID",
    s5do: "Klik knappen, skriv din adgangskode, og log på med MitID her på computeren. Godkend i MitID-appen. Bagefter gemmer SundhedMCP en kopi af journalen på computeren, så telefonen kan læse den.",
    s5btn: "Log på med MitID",
    s5done: "Logget ind. Kopien af journalen er gemt på computeren.",
    finish: "Færdig. Åbn Claude på telefonen, og spørg: “Hvad står der på mit medicinkort?”",
    working: "Arbejder …",
    failed: "Det lykkedes ikke:",
  },
  en: {
    title: "Use SundhedMCP from your phone",
    lead: "Your computer becomes the server. Follow the five steps; it takes about five minutes. Your record only leaves the computer when your AI reads it.",
    s1: "Choose a password",
    s1do: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters and keep it in your password manager. You need it in claude.ai and before each MitID login.`,
    s1done: "Password saved.",
    pw: "Password", pw2: "Repeat it", save: "Save password",
    s2: "Give the computer an address",
    s2install: "Download Tailscale, install it and log in. It is free. Come back here afterwards; this page updates itself.",
    s2installBtn: "Download Tailscale",
    s2login: "Open Tailscale and log in. This page updates itself.",
    s2funnel: "Click the button. Tailscale gives your computer a fixed address that claude.ai can reach while the computer is on.",
    s2funnelBtn: "Open to claude.ai",
    s2links: "Click the link, turn Funnel on for your computer, then click the button again:",
    s2done: "Your computer's address:",
    s3: "Start automatically",
    s3do: "Click the button, and SundhedMCP starts each time you log in to the computer.",
    s3btn: "Start at login",
    s3manual: "Run this command whenever you want to use SundhedMCP from your phone:",
    s3done: "SundhedMCP starts each time you log in.",
    s4: "Add it in claude.ai",
    s4steps: [
      "Copy the address below.",
      "Open claude.ai → Settings → Connectors and click <b>Add custom connector</b>.",
      "Enter <b>SundhedMCP</b> as the name, paste the address and click <b>Add</b>.",
      "Click <b>Connect</b>, enter your password and click <b>Allow access</b>.",
    ],
    copy: "Copy", copied: "Copied", open: "Open claude.ai",
    s4wait: "Waiting for claude.ai to connect …",
    s4done: "claude.ai is connected. The connector also works in the Claude app on your phone.",
    s5: "Log in with MitID",
    s5do: "Click the button, enter your password and log in with MitID here on the computer. Approve in the MitID app. Afterwards SundhedMCP keeps a copy of the record on the computer, so your phone can read it.",
    s5btn: "Log in with MitID",
    s5done: "Logged in. The copy of your record is saved on the computer.",
    finish: "Done. Open Claude on your phone and ask: “What is on my medicine card?”",
    working: "Working …",
    failed: "That did not work:",
  },
};

function page(lang: Lang): string {
  const t = T[lang];
  const step = (n: number, title: string, body: string) =>
    `<li class="step" data-step="${n}"><div class="num"><span>${n}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="sbody"><h2>${esc(title)}</h2><div class="panel"><div class="inner">${body}</div></div></div></li>`;
  const body = `<p class="muted">${esc(t.lead)}</p><ol class="steps">
${step(1, t.s1, `<div data-when="todo"><p>${esc(t.s1do)}</p><form method="post" action="/setup"><label for="pw">${t.pw}</label><input id="pw" name="password" type="password" minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password" required><label for="pw2">${t.pw2}</label><input id="pw2" name="confirm" type="password" minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password" required><button class="full">${t.save}</button></form></div><p data-when="done" class="ok">${esc(t.s1done)}</p>`)}
${step(2, t.s2, `<div data-when="install"><p>${esc(t.s2install)}</p><a class="btn" href="https://tailscale.com/download" target="_blank" rel="noopener">${t.s2installBtn}</a></div><p data-when="login">${esc(t.s2login)}</p><div data-when="funnel"><p>${esc(t.s2funnel)}</p><button data-action="funnel">${t.s2funnelBtn}</button><div class="links" hidden><p>${esc(t.s2links)}</p><ul></ul></div></div><div data-when="done"><p class="ok">${esc(t.s2done)}</p><code data-fill="url"></code></div>`)}
${step(3, t.s3, `<div data-when="todo"><p>${esc(t.s3do)}</p><button data-action="autostart">${t.s3btn}</button></div><div data-when="manual"><p>${esc(t.s3manual)}</p><code>npx -y sundhedmcp serve</code></div><p data-when="done" class="ok">${esc(t.s3done)}</p>`)}
${step(4, t.s4, `<div data-when="todo"><ol class="sub">${t.s4steps.map((s) => `<li>${s}</li>`).join("")}</ol><div class="copyrow"><code data-fill="mcp"></code><button class="ghost" data-action="copy">${t.copy}</button></div><a class="btn" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">${t.open}</a><p class="muted small wait">${esc(t.s4wait)}</p></div><p data-when="done" class="ok">${esc(t.s4done)}</p>`)}
${step(5, t.s5, `<div data-when="todo"><p>${esc(t.s5do)}</p><a class="btn" href="/connect" target="_blank" rel="noopener">${t.s5btn}</a></div><p data-when="done" class="ok">${esc(t.s5done)}</p>`)}
</ol><p class="finish" hidden>${esc(t.finish)}</p><p class="error" role="alert" hidden></p>
<script>
const T=${JSON.stringify({ working: t.working, failed: t.failed, copy: t.copy, copied: t.copied })};
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
let S=null;
function view(n,state,sub){const li=$('[data-step="'+n+'"]');li.dataset.state=state;$$('[data-when]',li).forEach(e=>e.hidden=e.dataset.when!==sub);}
function render(s){S=s;
  const d1=s.password,d2=d1&&s.tailscale.funnel,d3=d2&&(s.autostart.installed),d4=d2&&s.connected,d5=d4&&s.record;
  view(1,d1?'done':'current',d1?'done':'todo');
  const ts=s.tailscale;view(2,!d1?'locked':d2?'done':'current',d2?'done':!ts.installed?'install':!ts.loggedIn?'login':'funnel');
  view(3,!d2?'locked':d3?'done':'current',d3?'done':s.autostart.supported?'todo':'manual');
  view(4,!d2?'locked':d4?'done':'current',d4?'done':'todo');
  view(5,!d4?'locked':d5?'done':'current',d5?'done':'todo');
  if(!s.autostart.supported&&d2)$('[data-step="3"]').dataset.state='done';
  $$('[data-fill="url"]').forEach(e=>e.textContent=ts.url||'');$$('[data-fill="mcp"]').forEach(e=>e.textContent=ts.url?ts.url+'/mcp':'');
  $('.finish').hidden=!(d4&&d5);
}
async function poll(){try{const r=await fetch('/guide/state',{cache:'no-store'});if(r.ok)render(await r.json());}catch{}}
async function act(name,btn){const err=$('.error');err.hidden=true;const label=btn.textContent;btn.disabled=true;btn.textContent=T.working;
  try{const r=await fetch('/guide/'+name,{method:'POST',headers:{'x-sundhed-guide':'1'}});const j=await r.json();
    if(j.links&&j.links.length){const box=$('.links');box.hidden=false;$('ul',box).innerHTML='';j.links.forEach(l=>{const li=document.createElement('li'),a=document.createElement('a');a.href=l;a.target='_blank';a.rel='noopener';a.textContent=l;li.append(a);$('ul',box).append(li);});}
    else if(!j.ok){err.textContent=T.failed+' '+(j.message||'');err.hidden=false;}
  }catch(e){err.textContent=T.failed+' '+e.message;err.hidden=false;}
  btn.disabled=false;btn.textContent=label;poll();}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;
  if(b.dataset.action==='copy'){navigator.clipboard.writeText($('[data-fill="mcp"]').textContent).then(()=>{b.textContent=T.copied;setTimeout(()=>b.textContent=T.copy,1500);});return;}
  act(b.dataset.action,b);});
poll();setInterval(poll,3000);
</script>`;
  const head = `<style>
.steps{list-style:none;padding:0;margin:22px 0 0;display:grid;gap:4px}
.step{display:grid;grid-template-columns:32px 1fr;gap:14px;padding:12px 0;border-top:1px solid var(--line)}
.step:first-child{border-top:0}
.num{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--line);font:500 13px/1 "IBM Plex Mono",ui-monospace,Menlo,monospace;color:var(--muted);position:relative;transition:background .3s cubic-bezier(.2,.8,.2,1),border-color .3s,color .3s}
.num svg{position:absolute;width:14px;height:14px;opacity:0;transform:scale(.4);transition:opacity .25s,transform .35s cubic-bezier(.34,1.56,.64,1)}
.num span{transition:opacity .2s}
.step[data-state="current"] .num{background:var(--ink);border-color:var(--ink);color:var(--on-ink)}
.step[data-state="done"] .num{background:var(--ok);border-color:var(--ok);color:#fff}
.step[data-state="done"] .num span{opacity:0}.step[data-state="done"] .num svg{opacity:1;transform:scale(1)}
.step h2{font-size:16px;font-weight:500;margin:3px 0 0;transition:color .3s}
.step[data-state="locked"] h2{color:var(--muted)}
.panel{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .4s cubic-bezier(.2,.8,.2,1),opacity .3s}
.panel>.inner{overflow:hidden;min-height:0}
.step[data-state="current"] .panel,.step[data-state="done"] .panel{grid-template-rows:1fr;opacity:1}
.inner>*:first-child{margin-top:10px}
.ok{color:var(--ok)}
.btn{display:inline-block;font-weight:500;padding:11px 20px;border-radius:999px;background:var(--ink);color:var(--on-ink);text-decoration:none;margin-top:4px}
button{padding:11px 20px}button:disabled{opacity:.6;cursor:progress}
ol.sub{margin:10px 0 12px;padding-left:20px}ol.sub li{margin:0 0 6px}
.copyrow{display:flex;gap:8px;align-items:center;margin:0 0 12px;flex-wrap:wrap}.copyrow code{flex:1;min-width:0}
.wait{margin-top:12px;animation:pulse 1.6s ease-in-out infinite}@keyframes pulse{50%{opacity:.45}}
.links ul{padding-left:18px;word-break:break-all}
.finish{margin:18px 0 0;padding:16px 18px;border-radius:16px;background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok);font-weight:500}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>`;
  return shell(lang, t.title, body, { head, back: "/guide" });
}

export function mountGuide(app: express.Express, opts: GuideOptions): void {
  const local: express.RequestHandler = (req, res, next) => (isLocal(req, opts.port) ? next() : void res.status(404).json({ error: "Not found" }));
  // Only this page's own script may act: a custom header, which a form or a
  // cross-site fetch cannot send without a preflight we never answer.
  const sameOrigin: express.RequestHandler = (req, res, next) => {
    const origin = req.headers.origin;
    if (req.headers["x-sundhed-guide"] !== "1" || (origin && origin !== `http://${req.headers.host}`)) return void res.status(403).json({ ok: false, message: "Forbidden" });
    next();
  };

  app.get("/guide", local, (req, res) => {
    res
      .set("Content-Security-Policy", "default-src 'none'; font-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
      .type("html")
      .send(page(langOf(req)));
  });

  app.get("/guide/state", local, async (_req, res) => {
    const tailscale = await tailscaleState(opts.port);
    const now = Date.now();
    const connected = Object.values(store().data.tokens).some((tok) => tok.expires > now);
    const s = await status().catch(() => ({ loggedIn: false }));
    res.set("Cache-Control", "no-store").json({
      password: passwordConfigured(),
      tailscale,
      autostart: { supported: autostartSupported(), installed: autostartInstalled() },
      connected,
      record: s.loggedIn || saved() !== null,
    });
  });

  app.post("/guide/funnel", local, sameOrigin, async (_req, res) => {
    if (!passwordConfigured()) return void res.status(409).json({ ok: false, message: "Choose a password first." });
    const result = await enableFunnel(opts.port);
    const after = await tailscaleState(opts.port);
    if (after.funnel && after.url) opts.onPublicUrl(after.url);
    res.json({ ok: after.funnel, message: result.message, links: after.funnel ? [] : result.links });
  });

  app.post("/guide/autostart", local, sameOrigin, async (_req, res) => {
    res.json(await installAutostart(opts.env).catch((err) => ({ ok: false, message: (err as Error).message })));
  });
}
