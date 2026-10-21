#!/usr/bin/env python3
"""Build the digests static site: index.html + feed.xml from editions.json + audio/."""
import json, os, sys, html, datetime, email.utils

BUILD_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BUILD_DIR, "site")
BASE = (sys.argv[2] if len(sys.argv) > 2 else "https://ozlevyq.github.io/digests").rstrip("/")
AUDIO_DIR = os.path.join(OUT, "audio")

SLOT_HE = {"morning": "בוקר", "evening": "ערב"}
TRACK_HE = {"ai": "חדשות AI", "gh": "פצצות מגיטהאב"}
TZ = datetime.timezone(datetime.timedelta(hours=3))  # IDT (October)

def audio_name(ed, track):
    return f"{ed['date']}-{ed['slot']}-{track}.ogg"

def pub_date(ed):
    h = 6 if ed["slot"] == "morning" else 18
    dt = datetime.datetime.fromisoformat(ed["date"]).replace(hour=h, minute=30, tzinfo=TZ)
    return email.utils.format_datetime(dt, usegmt=False)

def fmt_date(iso):
    d = datetime.date.fromisoformat(iso)
    return f"{d.day}.{d.month}"

def esc(s):
    return html.escape(s, quote=True)

def teaser(script, n=170):
    t = " ".join(script.split())
    if len(t) <= n:
        return t
    cut = t[:n]
    dot = max(cut.rfind('.'), cut.rfind('!'), cut.rfind('?'), cut.rfind('־ '))
    if dot > 60:
        return cut[:dot+1]
    return cut.rsplit(' ', 1)[0] + '…'

def main():
    with open(os.path.join(BUILD_DIR, "editions.json"), encoding="utf-8") as f:
        editions = json.load(f)
    os.makedirs(AUDIO_DIR, exist_ok=True)

    # RSS items, newest first
    items = []
    for ed in reversed(editions):
        for track in ("ai", "gh"):
            if track == "ai" and ed.get("skip_ai"):
                continue
            fn = audio_name(ed, track)
            path = os.path.join(AUDIO_DIR, fn)
            if not os.path.exists(path):
                print(f"WARN missing audio: {fn}", file=sys.stderr)
                continue
            size = os.path.getsize(path)
            title = f"דייג'סט {SLOT_HE[ed['slot']]} {fmt_date(ed['date'])} - {TRACK_HE[track]}"
            url = f"{BASE}/audio/{fn}"
            links = ed.get(f"{track}_links", [])
            link_lines = "".join(f'<a href="{esc(u)}">{esc(u)}</a><br/>' for u in links)
            desc_cdata = f"<p>{esc(teaser(ed.get(track + '_script', '')))}</p>" + ("<p>מקורות:<br/>" + link_lines + "</p>" if links else "")
            items.append(f"""    <item>
      <title>{esc(title)}</title>
      <link>{BASE}/</link>
      <guid isPermaLink="false">digest-{ed['date']}-{ed['slot']}-{track}</guid>
      <pubDate>{pub_date(ed)}</pubDate>
      <enclosure url="{esc(url)}" length="{size}" type="audio/ogg"/>
      <itunes:author>Oz Levy</itunes:author>
      <description><![CDATA[{desc_cdata}]]></description>
    </item>""")

    feed = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>הדייג'סטים של עוז</title>
    <link>{BASE}/</link>
    <atom:link href="{BASE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>שני דייג'סטים קוליים ביום: מה חדש ב-AI ומה אפשר לקחת מזה, והריפואים הכי פראיים בגיטהאב. בוקר וערב.</description>
    <language>he</language>
    <itunes:author>Oz Levy</itunes:author>
    <itunes:explicit>no</itunes:explicit>
    <itunes:category text="Technology"/>
{chr(10).join(items)}
  </channel>
</rss>
"""
    with open(os.path.join(OUT, "feed.xml"), "w", encoding="utf-8") as f:
        f.write(feed)

    # HTML cards, newest first
    cards = []
    for ed in reversed(editions):
        tracks_html = []
        for track in ("ai", "gh"):
            if track == "ai" and ed.get("skip_ai"):
                continue
            fn = audio_name(ed, track)
            path = os.path.join(AUDIO_DIR, fn)
            if not os.path.exists(path):
                continue
            links = ed.get(f"{track}_links", [])
            links_html = ""
            if links:
                lis = "".join(f'<li><a href="{esc(u)}" target="_blank" rel="noopener">{esc(shorten(u))}</a></li>' for u in links)
                links_html = f'<ul class="links">{lis}</ul>'
            script = ed.get(f"{track}_script", "")
            teaser_html = f'<p class="teaser">{esc(teaser(script))}</p>' if script else ""
            script_html = ""
            if script:
                body = "".join(f"<p>{esc(p)}</p>" for p in script.split(chr(10)+chr(10)) if p.strip())
                script_html = f'<details class="script"><summary>תמליל מלא</summary>{body}</details>'
            tracks_html.append(f"""
      <div class="track">
        <div class="track-label">{TRACK_HE[track]}</div>
        {teaser_html}
        <audio controls preload="metadata" src="audio/{fn}"></audio>
        {script_html}
        {links_html}
      </div>""")
        if not tracks_html:
            continue
        cards.append(f"""    <section class="card">
      <h2><span class="date">{fmt_date(ed['date'])}</span> דייג'סט {SLOT_HE[ed['slot']]}</h2>
      {''.join(tracks_html)}
    </section>""")

    page = PAGE_TEMPLATE.replace("__CARDS__", "\n".join(cards)).replace("__BASE__", BASE).replace("__COUNT__", str(len(cards)))
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print(f"built: {len(cards)} edition cards, {len(items)} feed items -> {OUT}")

def shorten(u):
    s = u.replace("https://", "").replace("http://", "").rstrip("/")
    return s if len(s) <= 60 else s[:57] + "..."

PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>הדייג'סטים של עוז</title>
<link rel="alternate" type="application/rss+xml" title="RSS" href="feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  :root { --bg:#0d1512; --card:#15211c; --line:#24352d; --ink:#eef4ef; --dim:#9db3a6; --accent:#f0b429; --accent2:#3ecf8e; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--ink); font-family:'Heebo',system-ui,sans-serif; line-height:1.5; }
  header { position:sticky; top:0; z-index:10; background:rgba(13,21,18,.92); backdrop-filter:blur(10px);
           border-bottom:1px solid var(--line); padding:14px 18px; display:flex; align-items:center; gap:12px; }
  .logo { width:38px; height:38px; border-radius:11px; background:linear-gradient(135deg,var(--accent),#e07b39);
          display:flex; align-items:center; justify-content:center; font-size:20px; flex:none; }
  header h1 { font-size:19px; font-weight:800; }
  header .sub { font-size:12px; color:var(--dim); }
  .rss-btn { margin-inline-start:auto; flex:none; background:transparent; color:var(--accent); border:1.5px solid var(--accent);
             border-radius:999px; padding:8px 14px; font-family:inherit; font-size:13px; font-weight:600; text-decoration:none; }
  .hero { padding:26px 18px 8px; max-width:640px; margin:0 auto; }
  .hero p { color:var(--dim); font-size:14px; }
  main { max-width:640px; margin:0 auto; padding:14px 18px 60px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:18px; margin-bottom:16px; }
  .card h2 { font-size:16px; font-weight:800; margin-bottom:12px; display:flex; align-items:baseline; gap:8px; }
  .card .date { color:var(--accent); font-variant-numeric:tabular-nums; }
  .track { padding:10px 0; }
  .track + .track { border-top:1px solid var(--line); }
  .track-label { font-size:13px; font-weight:600; color:var(--accent2); margin-bottom:8px; }
  audio { width:100%; height:44px; display:block; }
  .teaser { font-size:13.5px; color:var(--ink); opacity:.85; margin-bottom:8px; }
  .script { margin-top:8px; }
  .script summary { font-size:12.5px; color:var(--accent2); cursor:pointer; font-weight:600; }
  .script p { font-size:13px; color:var(--dim); margin-top:8px; }
  .links { list-style:none; margin-top:8px; }
  .links li { margin:3px 0; }
  .links a { color:var(--dim); font-size:12.5px; text-decoration:none; direction:ltr; display:inline-block; word-break:break-all; }
  .links a::before { content:"🔗 "; }
  footer { text-align:center; color:var(--dim); font-size:12px; padding:20px; }
</style>
</head>
<body>
<header>
  <div class="logo">🎙️</div>
  <div>
    <h1>הדייג'סטים של עוז</h1>
    <div class="sub">__COUNT__ מהדורות · בוקר וערב</div>
  </div>
  <a class="rss-btn" href="feed.xml">הירשם ב-RSS</a>
</header>
<div class="hero">
  <p>כל הדייג'סטים הקוליים במקום אחד: מה חדש ב-AI ומה אפשר לעשות עם זה, והריפואים הכי פראיים בגיטהאב. לחץ פליי, או הוסף את הפיד לאפליקציית פודקאסטים.</p>
</div>
<main>
__CARDS__
</main>
<footer>מתעדכן אוטומטית פעמיים ביום · 06:30 ו-18:00</footer>
</body>
</html>
"""

if __name__ == "__main__":
    main()
