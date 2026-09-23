# Builds docs/ (GitHub Pages) from the page sources in site/:
#   python3 site/translate.py && python3 site/build.py
import os, re, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, '..', 'docs')
V = 'v=6'
PAGES = {
    ('en.source.html', 'en.html'): ('en', 'SundhedMCP lets Claude and other AI assistants read your own sundhed.dk health record after you log in with MitID. Read-only, nothing stored, open source.'),
    ('da.source.html', 'index.html'): ('da', 'SundhedMCP lader Claude og andre AI-assistenter læse din egen sundhedsjournal på sundhed.dk, efter du har logget på med MitID. Kun læseadgang, intet gemmes, open source.'),
}
ICONS = f'''<link rel="icon" href="favicon.svg?{V}" type="image/svg+xml">
<link rel="icon" href="favicon.ico?{V}" sizes="any">
<link rel="icon" href="favicon-48.png?{V}" sizes="48x48" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png?{V}">
<link rel="alternate" hreflang="da" href="https://sundhedmcp.dk/">
<link rel="alternate" hreflang="en" href="https://sundhedmcp.dk/en.html">
<link rel="alternate" hreflang="x-default" href="https://sundhedmcp.dk/">
'''
for (src_name, f), (lang, desc) in PAGES.items():
    src = open(os.path.join(HERE, src_name)).read()
    # The head ends with the first inline script (t-js flag and scroll handling).
    i = src.index('</script>', src.index('classList.add("t-js")')) + len('</script>')
    head, body = src[:i], src[i:]
    head, k = re.subn(r'<link rel="icon"[^\n]*\n', ICONS + f'<meta name="description" content="{desc}">\n<meta name="theme-color" content="#faf9f7">\n', head, count=1)
    assert k == 1, f
    open(f'{D}/{f}', 'w').write(f'<!doctype html>\n<html lang="{lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n{head}\n</head>\n<body>{body}</body>\n</html>\n')
for img in ['mitid-login.jpg', 'claude-answer.jpg']:
    shutil.copy(os.path.join(HERE, img), f'{D}/{img}')
# The Danish page used to live at /da.html; send old links home.
open(f'{D}/da.html', 'w').write('<!doctype html>\n<html lang="da">\n<head>\n<meta charset="utf-8">\n<title>SundhedMCP</title>\n<link rel="canonical" href="https://sundhedmcp.dk/">\n<meta http-equiv="refresh" content="0; url=./">\n</head>\n<body><p><a href="./">SundhedMCP</a></p></body>\n</html>\n')
print('built', ', '.join(f for _, f in PAGES), '+ da.html redirect')
