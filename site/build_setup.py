#!/usr/bin/env python3
"""Builds the setup guide on sundhedmcp.dk (docs/opsaetning.html in Danish,
docs/setup.html in English) from the main site's own head, stylesheet, nav mark
and footer, so it keeps sundhedmcp.dk's visual identity. Run it after
translate.py and build.py. Edit the copy in TEXT below, then run:

    python3 site/build_setup.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "site" / "da.source.html").read_text()

# The site's <head> part: icon, fonts, the full stylesheet and the t-js boot script.
head_end = src.index("</script>", src.index('document.documentElement.classList.add("t-js")')) + len("</script>")
head = src[:head_end]
i = src.index('<svg class="mark"')
mark = src[i : src.index("</svg>", i) + 6]

EXTRA_CSS = """<style>
  /* Setup page additions, built from the site's own tokens */
  .need .tile { min-height: 0; }
  .need .tile .btn { align-self: flex-start; margin-top: auto; font-size: 15px; padding: 10px 18px; }
  .need .tile .ico { width: 30px; height: 30px; margin-bottom: 6px; }
  .need .tile .ico * { stroke: var(--ink); }
  .scene .browser { width: 82%; border-radius: 12px; overflow: hidden; background: #faf9f7; box-shadow: 0 24px 60px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.08); transform: rotate(2deg) translateY(8%); }
  .scene .browser .bar { display: flex; gap: 6px; align-items: center; padding: 9px 12px; background: #ececee; }
  .scene .browser .bar i { width: 9px; height: 9px; border-radius: 50%; background: #c9c9cf; }
  .scene .browser .bar span { flex: 1; text-align: center; font: 10px "IBM Plex Mono", ui-monospace, Menlo, monospace; color: #6e6e73; margin-right: 30px; }
  .scene .browser img { display: block; width: 100%; height: auto; aspect-ratio: 560 / 700; object-fit: cover; object-position: center 14%; }
  .cmdrow { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
  .cmdrow pre { flex: 1 1 240px; min-width: 0; margin-top: 0 !important; }
  .cmdrow .btn { font-size: 15px; padding: 10px 18px; }
  .way .alt-ask { font-size: 15px; color: var(--dim); margin-top: 14px; }
  .way .alt-ask code { font-size: 13px; background: var(--alt); border-radius: 6px; padding: 2px 6px; color: var(--ink); }
  .closing .cmdrow { justify-content: center; max-width: 520px; margin: 0 auto; }
  .closing .cmdrow pre { background: var(--tile); border-radius: 12px; padding: 12px 16px; text-align: left; font-size: 14px; }
</style>"""

TEXT = {
    "da": {
        "file": "opsaetning.html", "other": "setup.html", "home": "./", "lang_label": "Sprog: dansk. Skift til engelsk",
        "title": "Opsætning · SundhedMCP",
        "desc": "Brug SundhedMCP fra Claude på telefonen. Din egen computer bliver serveren. Tre trin.",
        "nav": ["Før du starter", "Opsætning", "Privatliv", "Forside"], "cta": "Kom i gang",
        "h1": "Din journal.<br>Også på telefonen.",
        "lede": "Gør din egen computer til serveren, så kan Claude på telefonen læse din journal fra sundhed.dk, når computeren er tændt. Det tager omkring fem minutter.",
        "more": "Se hvad du skal bruge",
        "fine": "Gratis og open source · Din computer er serveren · Ikke tilknyttet sundhed.dk",
        "showcase_alt": "Claude på iPhone svarer ud fra sundhed.dk, hvornår den seneste stivkrampevaccination var",
        "need_eyebrow": "Før du starter", "need_h2": "Installér tre programmer.",
        "need_p": "På en Mac, Windows- eller Linux-computer. Log ind på Tailscale, når det er installeret.",
        "tiles": [
            ("Node.js 24+", "Kører SundhedMCP på din computer.", "https://nodejs.org/en/download"),
            ("Google Chrome", "Til MitID-login. Microsoft Edge virker også.", "https://www.google.com/chrome/"),
            ("Tailscale", "Giver computeren en fast adresse, som claude.ai kan nå. Gratis.", "https://tailscale.com/download"),
        ],
        "get": "Hent",
        "run_eyebrow": "Opsætning", "run_h2": "Tre trin.",
        "run_p": "Start SundhedMCP med én kommando. Guiden på din computer klarer resten og krydser hvert trin af.",
        "scenes": [
            ("Start SundhedMCP", "Åbn Terminal, indsæt kommandoen, og tryk Enter. Guiden åbner i din browser."),
            ("Følg guiden", "Vælg en adgangskode, klik “Åbn for claude.ai”, tilføj connectoren, og log på med MitID."),
            ("Spørg fra telefonen", "Åbn Claude-appen, og spørg om din medicin, dine prøvesvar eller vaccinationer."),
        ],
        "term_ok": "Guide: localhost:8787/guide",
        "browser_alt": "SundhedMCP-guiden på computeren med trinnene adgangskode, adresse og claude.ai",
        "phone_alt": "Claude på iPhone svarer på dansk ud fra sundhed.dk",
        "card_da": "Trin for trin", "card_h3": "Kør kommandoen, og følg guiden.",
        "card_steps": [
            "<b>Åbn Terminal.</b> Mac: tryk ⌘ + mellemrum, og skriv Terminal. Windows: åbn PowerShell.",
            "<b>Indsæt kommandoen, og tryk Enter.</b> Guiden åbner på <code>localhost:8787/guide</code>.",
            "<b>Vælg en adgangskode</b> på mindst 12 tegn. Gem den i din adgangskodemanager.",
            "<b>Klik “Åbn for claude.ai”</b> og derefter <b>“Start ved login”</b>.",
            "<b>Tilføj i claude.ai:</b> Indstillinger → Connectors → Tilføj brugerdefineret connector. Indsæt adressen fra guiden, klik Forbind, og skriv din adgangskode.",
            "<b>Log på med MitID</b> på computeren, og godkend i MitID-appen. Log ikke på fra telefonen: MitID viser en QR-kode, som skal scannes med appen.",
        ],
        "copy": "Kopiér", "copied": "Kopieret",
        "alt_ask": "Bruger du allerede SundhedMCP i Claude Desktop eller Claude Code? Skriv i stedet: <code>Sæt SundhedMCP op til min telefon</code>",
        "open_guide": "Åbn guiden igen",
        "priv_eyebrow": "Privatliv", "priv_h2": "Din computer. Din journal.",
        "priv_p": "SundhedMCP kører intet på en server af sin egen.",
        "facts": [
            ("Din computer er serveren.", "Browseren, MitID-sessionen og kopien af journalen bliver på din computer, i ~/.sundhedmcp. Er computeren slukket, svarer SundhedMCP ikke."),
            ("Din AI-udbyder ser det.", "Det, Claude læser fra journalen, sendes til Anthropic på deres vilkår. Spørg kun om det, du vil dele."),
            ("Låst med din adgangskode.", "Adressen er offentlig, men connectoren kræver din adgangskode, og guiden svarer kun på din egen computer."),
        ],
        "close_h2": "Klar? Kør én kommando.",
        "foot": "SundhedMCP læser din egen journal på sundhed.dk, efter du har logget på med MitID. Den er ikke tilknyttet sundhed.dk, Sundhedsdatastyrelsen eller MitID, og den er ikke lægelig rådgivning.",
        "made": "Lavet af",
    },
    "en": {
        "file": "setup.html", "other": "opsaetning.html", "home": "en.html", "lang_label": "Language: English. Switch to Danish",
        "title": "Setup · SundhedMCP",
        "desc": "Use SundhedMCP from Claude on your phone. Your own computer becomes the server. Three steps.",
        "nav": ["Before you start", "Setup", "Privacy", "Home"], "cta": "Get started",
        "h1": "Your record.<br>On your phone too.",
        "lede": "Make your own computer the server, and Claude on your phone can read your sundhed.dk record while the computer is on. It takes about five minutes.",
        "more": "See what you need",
        "fine": "Free and open source · Your computer is the server · Not affiliated with sundhed.dk",
        "showcase_alt": "Claude on iPhone answering from sundhed.dk when the last tetanus vaccination was",
        "need_eyebrow": "Before you start", "need_h2": "Install three programs.",
        "need_p": "On a Mac, Windows or Linux computer. Log in to Tailscale once it is installed.",
        "tiles": [
            ("Node.js 24+", "Runs SundhedMCP on your computer.", "https://nodejs.org/en/download"),
            ("Google Chrome", "For the MitID login. Microsoft Edge works too.", "https://www.google.com/chrome/"),
            ("Tailscale", "Gives the computer a fixed address that claude.ai can reach. Free.", "https://tailscale.com/download"),
        ],
        "get": "Download",
        "run_eyebrow": "Setup", "run_h2": "Three steps.",
        "run_p": "Start SundhedMCP with one command. The guide on your computer does the rest and ticks off each step.",
        "scenes": [
            ("Start SundhedMCP", "Open Terminal, paste the command and press Enter. The guide opens in your browser."),
            ("Follow the guide", "Choose a password, click “Open to claude.ai”, add the connector and log in with MitID."),
            ("Ask from your phone", "Open the Claude app and ask about your medicine, test results or vaccinations."),
        ],
        "term_ok": "Guide: localhost:8787/guide",
        "browser_alt": "The SundhedMCP guide on the computer with the password, address and claude.ai steps",
        "phone_alt": "Claude on iPhone answering from sundhed.dk",
        "card_da": "Step by step", "card_h3": "Run the command, then follow the guide.",
        "card_steps": [
            "<b>Open Terminal.</b> Mac: press ⌘ + Space and type Terminal. Windows: open PowerShell.",
            "<b>Paste the command and press Enter.</b> The guide opens at <code>localhost:8787/guide</code>.",
            "<b>Choose a password</b> of at least 12 characters. Keep it in your password manager.",
            "<b>Click “Open to claude.ai”</b>, then <b>“Start at login”</b>.",
            "<b>Add it in claude.ai:</b> Settings → Connectors → Add custom connector. Paste the address from the guide, click Connect and enter your password.",
            "<b>Log in with MitID</b> on the computer and approve in the MitID app. Do not log in from your phone: MitID shows a QR code that must be scanned with the app.",
        ],
        "copy": "Copy", "copied": "Copied",
        "alt_ask": "Already use SundhedMCP in Claude Desktop or Claude Code? Type this instead: <code>Set up SundhedMCP for my phone</code>",
        "open_guide": "Open the guide again",
        "priv_eyebrow": "Privacy", "priv_h2": "Your computer. Your record.",
        "priv_p": "SundhedMCP runs nothing on a server of its own.",
        "facts": [
            ("Your computer is the server.", "The browser, the MitID session and the copy of your record stay on your computer, in ~/.sundhedmcp. When the computer is off, SundhedMCP does not answer."),
            ("Your AI provider sees it.", "What Claude reads from the record goes to Anthropic on their terms. Only ask about what you want to share."),
            ("Locked with your password.", "The address is public, but the connector needs your password, and the guide only answers on your own computer."),
        ],
        "close_h2": "Ready? Run one command.",
        "foot": "SundhedMCP reads your own sundhed.dk record after you log in with MitID. It is not affiliated with sundhed.dk, the Danish Health Data Authority or MitID, and it is not medical advice.",
        "made": "Made by",
    },
}

ICONS = [
    '<svg class="ico" viewBox="0 0 30 30" fill="none" aria-hidden="true"><rect x="4" y="6" width="22" height="16" rx="3" stroke-width="1.8"/><path d="M9 12l3 2.5L9 17M15 17h5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '<svg class="ico" viewBox="0 0 30 30" fill="none" aria-hidden="true"><circle cx="15" cy="15" r="10" stroke-width="1.8"/><circle cx="15" cy="15" r="4" stroke-width="1.8"/><path d="M15 11h9M11.5 17l-4.5 7.5M18.5 17L23 9" stroke-width="1.8" stroke-linecap="round"/></svg>',
    '<svg class="ico" viewBox="0 0 30 30" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="2.5" stroke-width="1.8"/><circle cx="15" cy="8" r="2.5" stroke-width="1.8"/><circle cx="22" cy="8" r="2.5" stroke-width="1.8"/><circle cx="8" cy="15" r="2.5" stroke-width="1.8"/><circle cx="15" cy="15" r="2.5" stroke-width="1.8"/><circle cx="22" cy="15" r="2.5" stroke-width="1.8"/><circle cx="15" cy="22" r="2.5" stroke-width="1.8"/></svg>',
]
FACT_ICONS = [
    '<svg viewBox="0 0 30 30" fill="none" aria-hidden="true"><rect x="4" y="6" width="22" height="15" rx="2.5" stroke-width="1.8"/><path d="M11 25h8M15 21v4" stroke-width="1.8" stroke-linecap="round"/></svg>',
    '<svg viewBox="0 0 30 30" fill="none" aria-hidden="true"><path d="M5 15h20M15 5v20" stroke-width="1.8" stroke-linecap="round"/><circle cx="15" cy="15" r="10" stroke-width="1.8"/></svg>',
    '<svg viewBox="0 0 30 30" fill="none" aria-hidden="true"><rect x="6" y="13" width="18" height="13" rx="3" stroke-width="1.8"/><path d="M10 13V9.5a5 5 0 0110 0V13" stroke-width="1.8"/></svg>',
]
CHEVRON = '<span class="t-learn-chevron" aria-hidden="true"><svg viewBox="0 0 16 16"><path class="t-learn-arm t-learn-arm-top" d="M6 4L10 8"/><path class="t-learn-arm t-learn-arm-bot" d="M10 8L6 12"/></svg></span>'
CMD = "npx -y sundhedmcp serve"


def page(lang: str) -> str:
    t = TEXT[lang]
    on = "true" if lang == "en" else "false"
    h = head.replace("<title>SundhedMCP</title>", f'<title>{t["title"]}</title>\n<meta name="description" content="{t["desc"]}">\n<meta name="theme-color" content="#faf9f7">', 1)
    tiles = "".join(
        f'<div class="tile third t-reveal" style="--t-index:{n}">{ICONS[n]}<h3>{name}</h3><p>{body}</p><a class="btn line" href="{url}" target="_blank" rel="noopener">{t["get"]}</a></div>'
        for n, (name, body, url) in enumerate(t["tiles"])
    )
    s = t["scenes"]
    steps = "".join(f"<li>{x}</li>" for x in t["card_steps"])
    facts = "".join(
        f'<div class="fact t-reveal" style="--t-index:{n}">{FACT_ICONS[n]}<h3>{a}</h3><p>{b}</p></div>' for n, (a, b) in enumerate(t["facts"])
    )
    other_lang = "da" if lang == "en" else "en"
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
{h}
{EXTRA_CSS}
</head>
<body>
<header class="nav">
  <div class="wrap"><div class="navpill">
    <a class="brand" href="{t["home"]}" aria-label="SundhedMCP">
      {mark}
      SundhedMCP
    </a>
    <nav aria-label="Sections">
      <a href="#need">{t["nav"][0]}</a>
      <a href="#run">{t["nav"][1]}</a>
      <a href="#privacy">{t["nav"][2]}</a>
      <a href="{t["home"]}">{t["nav"][3]}</a>
      <a class="t-toggle lang-toggle" role="switch" aria-checked="{on}" data-on="{on}" href="{t["other"]}" hreflang="{other_lang}" aria-label="{t["lang_label"]}"><span class="t-toggle-thumb" aria-hidden="true"></span><span class="lt" lang="da">DK</span><span class="lt" lang="en">EN</span></a>
      <a class="cta" href="#run">{t["cta"]}</a>
    </nav>
  </div></div>
</header>

<main id="top">
  <div class="wrap hero t-stagger" id="hero">
    <h1 class="t-stagger-line t-stagger-line--2">{t["h1"]}</h1>
    <p class="lede t-stagger-line t-stagger-line--3">{t["lede"]}</p>
    <div class="btns t-stagger-line t-stagger-line--4">
      <a class="btn primary" href="#run">{t["cta"]}</a>
      <a class="more t-learn" href="#need">{t["more"]}{CHEVRON}</a>
    </div>
    <p class="fine t-stagger-line t-stagger-line--4">{t["fine"]}</p>
    <div class="showcase t-stagger-line t-stagger-line--4" role="img" aria-label="{t["showcase_alt"]}">
      <div class="phone"><div class="screen dark t-skel"><div class="island"></div>
        <div class="t-skel-skeleton is-pulsing" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><img class="shot t-skel-content" src="claude-answer.jpg" alt="" width="620" height="1342">
      </div></div>
      <div class="glow"></div>
    </div>
  </div>

  <section id="need" class="first need">
    <div class="wrap">
      <div class="head t-reveal">
        <p class="eyebrow">{t["need_eyebrow"]}</p>
        <h2>{t["need_h2"]}</h2>
        <p>{t["need_p"]}</p>
      </div>
      <div class="bento">{tiles}</div>
    </div>
  </section>

  <section id="run" class="alt">
    <div class="wrap">
      <div class="head t-reveal">
        <p class="eyebrow">{t["run_eyebrow"]}</p>
        <h2>{t["run_h2"]}</h2>
        <p>{t["run_p"]}</p>
      </div>
      <div class="steps">
        <div class="t-reveal" style="--t-index:0">
          <div class="scene s1" aria-hidden="true"><span class="badge">1</span>
            <div class="term"><div class="bar"><i></i><i></i><i></i></div>
<pre><span class="p">~</span> {CMD}
<span class="ok">✓</span> SundhedMCP is running on this computer
<span class="d">  {t["term_ok"]}</span></pre>
            </div>
            <div class="glow"></div>
          </div>
          <div class="step-text"><h3>{s[0][0]}</h3><p>{s[0][1]}</p></div>
        </div>
        <div class="t-reveal" style="--t-index:1">
          <div class="scene s2"><span class="badge" aria-hidden="true">2</span>
            <div class="browser"><div class="bar"><i></i><i></i><i></i><span>localhost:8787/guide</span></div><img src="guide-connector.jpg" alt="{t["browser_alt"]}" width="560" height="700" loading="lazy"></div>
            <div class="glow"></div>
          </div>
          <div class="step-text"><h3>{s[1][0]}</h3><p>{s[1][1]}</p></div>
        </div>
        <div class="t-reveal" style="--t-index:2">
          <div class="scene s3"><span class="badge" aria-hidden="true">3</span>
            <div class="phone"><div class="screen dark t-skel"><div class="island"></div>
              <div class="t-skel-skeleton is-pulsing" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><img class="shot t-skel-content" src="claude-answer.jpg" alt="{t["phone_alt"]}" width="620" height="1342" loading="lazy">
            </div></div>
            <div class="glow"></div>
          </div>
          <div class="step-text"><h3>{s[2][0]}</h3><p>{s[2][1]}</p></div>
        </div>
      </div>
      <div class="ways one" style="margin-top:56px">
        <div class="way t-reveal">
          <span class="da">{t["card_da"]}</span>
          <h3>{t["card_h3"]}</h3>
          <div class="cmdrow"><pre><code id="cmd">{CMD}</code></pre><button class="btn primary" type="button" data-copy="cmd">{t["copy"]}</button></div>
          <ol class="setup">{steps}</ol>
          <p class="alt-ask">{t["alt_ask"]}</p>
          <div class="deploy"><a class="btn line" href="http://localhost:8787/guide" target="_blank" rel="noopener">{t["open_guide"]}</a></div>
        </div>
      </div>
    </div>
  </section>

  <section id="privacy">
    <div class="wrap">
      <div class="head t-reveal">
        <p class="eyebrow">{t["priv_eyebrow"]}</p>
        <h2>{t["priv_h2"]}</h2>
        <p>{t["priv_p"]}</p>
      </div>
      <div class="privacy-grid">{facts}</div>
    </div>
  </section>

  <section class="closing alt">
    <div class="wrap t-reveal">
      <h2>{t["close_h2"]}</h2>
      <div class="cmdrow"><pre><code id="cmd2">{CMD}</code></pre><button class="btn primary" type="button" data-copy="cmd2">{t["copy"]}</button></div>
    </div>
  </section>
</main>

<footer>
  <div class="wrap">
    <p>{t["foot"]}</p>
    <div class="rule"><span>MIT-licens · sundhedmcp.dk</span><span>{t["made"]} <a href="https://github.com/manas-katyal">manas-katyal</a> · <a href="https://github.com/manas-katyal/sundhedmcp">GitHub</a></span></div>
  </div>
</footer>
<script>
(() => {{
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ms = (name, fb) => {{ const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return Number.isFinite(v) ? v : fb; }};
  const hero = document.getElementById("hero");
  requestAnimationFrame(() => hero.classList.add("is-shown"));
  document.querySelectorAll(".t-skel").forEach((box) => {{
    const img = box.querySelector("img");
    const done = () => {{ box.classList.add("is-revealed"); setTimeout(() => box.querySelector(".t-skel-skeleton")?.classList.remove("is-pulsing"), ms("--reveal-dur", 800)); }};
    if (img.complete && img.naturalWidth) requestAnimationFrame(done);
    else {{ img.addEventListener("load", done, {{ once: true }}); img.addEventListener("error", done, {{ once: true }}); }}
  }});
  document.querySelectorAll(".lang-toggle").forEach((t) => t.addEventListener("click", (e) => {{
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    const on = t.dataset.on === "true";
    t.classList.add("is-init"); t.dataset.on = String(!on); t.setAttribute("aria-checked", String(!on));
    setTimeout(() => {{ location.href = t.href; }}, reduce ? 0 : ms("--toggle-dur", 350));
  }}));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {{
    if (!e.isIntersecting) return;
    e.target.dataset.inview = "true"; io.unobserve(e.target);
  }}), {{ threshold: 0.15, rootMargin: "0px 0px -8% 0px" }});
  document.querySelectorAll(".t-reveal").forEach((el) => io.observe(el));
  document.addEventListener("click", (e) => {{
    const b = e.target.closest("[data-copy]"); if (!b) return;
    const el = document.getElementById(b.dataset.copy);
    navigator.clipboard.writeText(el.textContent).then(() => {{ b.textContent = "{t["copied"]}"; setTimeout(() => (b.textContent = "{t["copy"]}"), 1500); }})
      .catch(() => {{ const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }});
  }});
}})();
</script>
</body>
</html>
"""


import shutil

for lang in ("da", "en"):
    (ROOT / "docs" / TEXT[lang]["file"]).write_text(page(lang))
    print("wrote", "docs/" + TEXT[lang]["file"])
for img in ("guide-password.jpg", "guide-address.jpg", "guide-connector.jpg"):
    shutil.copy(ROOT / "site" / img, ROOT / "docs" / img)
