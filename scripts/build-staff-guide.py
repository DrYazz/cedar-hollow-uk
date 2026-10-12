#!/usr/bin/env python3
"""Build the staff guide, and put it where the site serves it from.

The guide's words, photographs and video are NOT in this repository, which is
public: they include lock combinations, the escape room's start code and the
team's phone numbers. They live in a private folder on the office computer,
C:\\dev\\cedar-hollow-staff (or wherever --dir says), and a copy of
content.html is kept in IG_KV too, so the guide can be rebuilt from Cloudflare:

    content.html   the guide itself: a <nav class="links"> of useful links (the
                   footer), then one <section id data-title data-hint data-photo>
                   per topic, each a run of <article class="card"> -- with
                   data-photo for a picture at its head, and data-day="1".."7"
                   on the daily jobs, Monday to Sunday, for the "Today" box
    media/         photographs and video the content refers to as /staff/media/<name>
                   (the video an MP4 named .m4v: see worker/staff.js)

The data-photo pictures are the site's own public photographs (/images/...,
/oxford/images/...); nothing private is in them.

This script holds only the page around the content, in the look of the rest
of cedarhollow.uk: a photograph across the top, the topics as photograph
tiles, each topic opening on its own photograph, the cards, and a moss green
footer. It writes build/guide.html into the private folder, and with --upload
puts the page, every media file and content.html into the site's IG_KV store,
where worker/staff.js serves them to anyone signed in with the staff password.

    python scripts/build-staff-guide.py                    # build only
    python scripts/build-staff-guide.py --upload local     # into wrangler dev's store
    python scripts/build-staff-guide.py --upload remote    # live (a change to Cloudflare)

Made for a phone first: one column of cards, two of tiles, the search always
at hand, the phone's Back button going back a topic, and thumb-sized buttons.
"""

import argparse
import html
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
DEFAULT_DIR = pathlib.Path(r"C:\dev\cedar-hollow-staff")
HERO = "/images/full-bleed-golden-hour-1280.webp"


def small(path):
    """The site's smaller copy of a photograph, where it has one."""
    for a, b in (("-1060.webp", "-530.webp"), ("-840.webp", "-530.webp"), (".webp", "-sm.webp")):
        if path.endswith(a):
            alt = path[: -len(a)] + b
            if (PUBLIC / alt.lstrip("/")).exists():
                return alt
    return path


def attrs(tag):
    return dict(re.findall(r'([a-z-]+)="([^"]*)"', tag))


def parse(content):
    # Notes for whoever edits the content are comments; they are never part of the page.
    content = re.sub(r"<!--.*?-->", "", content, flags=re.S)
    links = re.search(r'<nav class="links"[^>]*>(.*?)</nav>', content, re.S)
    topics = []
    for m in re.finditer(r"(<section [^>]*>)(.*?)</section>", content, re.S):
        a = attrs(m.group(1))
        if not {"id", "data-title", "data-photo"} <= a.keys():
            sys.exit("A <section> needs id, data-title and data-photo: " + m.group(1))
        topics.append({"id": a["id"], "title": a["data-title"], "hint": a.get("data-hint", ""), "photo": a["data-photo"], "body": m.group(2).strip()})
    if not topics:
        sys.exit("No <section> found in content.html")
    return (links.group(1).strip() if links else ""), topics


def photo_card(m):
    """A card with data-photo opens on that photograph."""
    tag, rest = m.group(1), m.group(2)
    a = attrs(tag)
    if "data-photo" not in a:
        return tag + rest
    big = a["data-photo"]
    return (tag + '<figure class="card-photo"><img src="%s" srcset="%s 600w, %s 1060w" sizes="(min-width:900px) 420px, 92vw" '
            'alt="" loading="lazy" decoding="async"></figure>' % (big, small(big), big)) + rest


def build(folder):
    content = (folder / "content.html").read_text(encoding="utf-8")
    links, topics = parse(content)
    for t in topics:
        for p in [t["photo"]] + re.findall(r'data-photo="([^"]+)"', t["body"]):
            if not (PUBLIC / p.lstrip("/")).exists():
                sys.exit(f"Photo not found in public/: {p}")
    owl = (PUBLIC / "images" / "cedar-hollow-owl.svg").read_text(encoding="utf-8")
    owl = owl[owl.index("<svg"):].replace('fill="#F1ECDB"', 'fill="currentColor"')
    owl_small = owl.replace("<svg", '<svg aria-hidden="true" focusable="false" class="owl"', 1)
    owl_mark = owl.replace("<svg", '<svg aria-hidden="true" focusable="false" class="foot-owl"', 1)

    tiles = "".join(
        '<li><a class="tile" href="#%s"><span class="tile-img"><img src="%s" alt="" %s decoding="async"></span>'
        '<span class="tile-t">%s</span><span class="tile-h">%s</span></a></li>'
        % (t["id"], small(t["photo"]), 'loading="eager"' if i < 4 else 'loading="lazy"', html.escape(t["title"]), html.escape(t["hint"]))
        for i, t in enumerate(topics))
    views = []
    for i, t in enumerate(topics):
        body = re.sub(r'<article class="card" data-day="(\d)"', r'<article class="card" id="day-\1" data-day="\1"', t["body"])
        body = re.sub(r'(<article class="card[^"]*"[^>]*>)(\s*)', photo_card, body)
        nav = []
        for j, label in ((i - 1, "Previous"), (i + 1, "Next")):
            if 0 <= j < len(topics):
                o = topics[j]
                nav.append('<a class="pn pn-%s" href="#%s"><img src="%s" alt="" loading="lazy"><span><small>%s</small>%s</span></a>'
                           % (label.lower(), o["id"], small(o["photo"]), label, html.escape(o["title"])))
        views.append(
            '<section class="topic" id="%s" data-title="%s" data-hint="%s" data-photo="%s" hidden>'
            '<div class="wrap"><div class="cards">%s</div><nav class="pns" aria-label="More topics">%s</nav></div></section>'
            % (t["id"], html.escape(t["title"]), html.escape(t["hint"]), t["photo"], body, "".join(nav)))
    page = (TEMPLATE.replace("{{OWL}}", owl_small).replace("{{OWLMARK}}", owl_mark).replace("{{HERO}}", HERO)
            .replace("{{TILES}}", tiles).replace("{{TOPICS}}", "".join(views)).replace("{{LINKS}}", links))
    out = folder / "build" / "guide.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(page, encoding="utf-8", newline="\n")
    # Every media file the page refers to should be there, and nothing extra uploaded by mistake.
    wanted = sorted(set(re.findall(r'/staff/media/([a-z0-9-]+\.(?:m4v|webp|jpg|png))', page)))
    missing = [w for w in wanted if not (folder / "media" / w).exists()]
    if missing:
        sys.exit("Missing from media/: " + ", ".join(missing))
    cards = len(re.findall(r'<article class="card', page))
    print(f"built {out}: {len(topics)} topics, {cards} cards, {page.count('card-photo')} card photos, {len(wanted)} media files, {len(page) // 1024} KB")
    return out, [folder / "media" / w for w in wanted]


def upload(page, media, source, where, persist=None):
    def put(key, path):
        cmd = ["npx", "wrangler", "kv", "key", "put", key, "--path", str(path), "--binding", "IG_KV", "--" + where]
        if where == "local" and persist:
            cmd += ["--persist-to", str(persist)]
        r = subprocess.run(cmd, cwd=ROOT, shell=(sys.platform == "win32"), capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        if r.returncode:
            sys.exit(f"Upload of {key} failed:\n{r.stdout}\n{r.stderr}")
        print(f"  {key}  ({path.stat().st_size // 1024} KB)")
    print(f"uploading to the {where} IG_KV:")
    for m in media:
        put(f"staff:media/{m.name}", m)
    put("staff:source/content.html", source)
    put("staff:guide.html", page)


TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Staff guide | Cedar Hollow</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#3b4126">
  <link rel="icon" href="/images/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/images/apple-touch-icon.png">
  <link rel="preload" href="{{HERO}}" as="image">
  <style>
    @font-face { font-family: "Crimson Pro"; src: url("/fonts/CrimsonPro-Light.woff2") format("woff2"); font-weight: 300; font-display: swap; }
    @font-face { font-family: "Crimson Pro"; src: url("/fonts/CrimsonPro-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    @font-face { font-family: "Crimson Pro"; src: url("/fonts/CrimsonPro-Italic-latin.woff2") format("woff2"); font-weight: 300 400; font-style: italic; font-display: swap; }
    @font-face { font-family: "Inter"; src: url("/fonts/Inter_24pt-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    @font-face { font-family: "Inter"; src: url("/fonts/Inter_24pt-SemiBold.woff2") format("woff2"); font-weight: 600; font-display: swap; }
    @font-face { font-family: "Hedvig Letters Serif"; src: url("/fonts/HedvigLettersSerif_18pt-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    /* The site's own palette (css/cedar-hollow-uk.webflow.css), the body text a
       shade darker than the site's for reading on a phone in daylight. */
    :root { --accent: #3b4126; --brand: #efeed5; --paper: #f7f5e1; --brand-3: #e7e5c7; --text: #4a493a; --muted: #6a6956; --line: #3b412633; --card: #fffef8; --wa: #1f7a45; --focus: #1f5fa8; }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; scroll-padding-top: 76px; }
    body { margin: 0; background: var(--paper); color: var(--text); font: 17px/1.6 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    a { color: var(--accent); text-underline-offset: .15em; }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    h1, h2, .tile-t, .card h3 { font-family: "Crimson Pro", Georgia, serif; }
    em { font-style: italic; }
    .wrap { max-width: 980px; margin: 0 auto; padding: 0 16px; padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }
    [hidden] { display: none !important; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    /* ---- the photograph across the top, as on the site's pages ---- */
    .hero { position: relative; color: var(--brand); background: var(--accent); overflow: hidden; display: flex; flex-direction: column; }
    .hero-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .hero::after { content: ""; position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(20, 24, 10, .55), rgba(20, 24, 10, .15) 38%, rgba(32, 36, 18, .82)); }
    .hero > * { position: relative; z-index: 1; }
    .hero > .hero-img { position: absolute; inset: 0; z-index: 0; }
    .hero-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 16px; padding-bottom: 16px; width: 100%; }
    .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--brand); text-decoration: none; }
    .owl { width: 30px; height: auto; flex: none; }
    .wordmark { font: 400 1.45rem/1 "Hedvig Letters Serif", Georgia, serif; letter-spacing: -.035em; }
    .back { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px 0 12px; border-radius: 999px; background: rgba(239, 238, 213, .16); border: 1px solid rgba(239, 238, 213, .35); color: var(--brand); text-decoration: none; font-weight: 600; font-size: .95rem; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
    .hero-body { margin-top: auto; padding-bottom: 28px; width: 100%; }
    .eyebrow { margin: 0 0 10px; font-size: .82rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; opacity: .78; }
    .hero h1 { margin: 0; font-weight: 300; font-size: clamp(2.8rem, 11vw, 4.6rem); line-height: 1.02; letter-spacing: -.035em; color: var(--brand); }
    .hero .lead { margin: 12px 0 0; max-width: 34ch; font-size: 1.02rem; opacity: .9; }
    .home-hero { min-height: min(62svh, 560px); }
    .topic-hero { min-height: min(46svh, 420px); }
    .topic-hero h1 { font-size: clamp(2.4rem, 10vw, 3.8rem); }

    /* ---- the search, always at hand ---- */
    .searchbar { position: sticky; top: 0; z-index: 10; background: var(--paper); border-bottom: 1px solid var(--line); padding: 10px 0; }
    .searchbar .wrap { display: flex; align-items: center; gap: 10px; }
    .home-btn { flex: none; display: none; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; color: var(--accent); }
    .home-btn .owl { width: 26px; }
    body.in-topic .home-btn, body.in-search .home-btn { display: inline-flex; }
    .search { position: relative; flex: 1; }
    .search svg { position: absolute; left: 16px; top: 50%; width: 18px; height: 18px; transform: translateY(-50%); color: var(--muted); }
    .search input { width: 100%; font: inherit; font-size: 1rem; padding: 12px 46px 12px 44px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); color: var(--text); -webkit-appearance: none; appearance: none; }
    .search input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
    .search button { position: absolute; right: 3px; top: 50%; transform: translateY(-50%); width: 42px; height: 42px; border: 0; border-radius: 50%; background: none; font-size: 1.4rem; color: var(--muted); cursor: pointer; }

    /* ---- home: today, and the topics as photograph tiles ---- */
    .today { margin: 22px 0 6px; background: var(--accent); color: var(--brand); border-radius: 22px; padding: 16px 18px 8px; }
    .today .eyebrow { margin-bottom: 4px; opacity: .75; }
    .today a { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 48px; padding: 6px 0; color: var(--brand); text-decoration: none; font: 400 1.3rem/1.2 "Crimson Pro", Georgia, serif; border-top: 1px solid rgba(239, 238, 213, .18); }
    .today a:first-of-type { border-top: 0; }
    .today a::after { content: "\2192"; font-family: Inter, sans-serif; font-size: 1rem; opacity: .8; }
    .h2 { margin: 34px 0 18px; text-align: center; font-weight: 300; font-size: clamp(2.1rem, 8vw, 3rem); line-height: 1.05; letter-spacing: -.03em; color: var(--accent); }
    .tiles { list-style: none; margin: 0 0 40px; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 14px; }
    .tile { display: block; text-decoration: none; color: inherit; }
    .tile-img { display: block; aspect-ratio: 4 / 5; border-radius: 22px; overflow: hidden; background: var(--brand-3); border: 1px solid rgba(59, 65, 38, .35); box-shadow: 0 14px 22px rgba(0, 0, 0, .04); }
    .tile-img img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .5s ease; }
    .tile:hover .tile-img img { transform: scale(1.035); }
    .tile-t { display: block; margin: 10px 2px 0; font-weight: 400; font-size: 1.35rem; line-height: 1.15; color: var(--accent); letter-spacing: -.01em; }
    .tile-h { display: block; margin: 2px 2px 0; font-size: .85rem; line-height: 1.4; color: var(--muted); }

    /* ---- a topic: its cards ---- */
    .topic { padding: 18px 0 40px; }
    .cards { columns: 1; column-gap: 16px; }
    .card { break-inside: avoid; background: var(--card); border: 1px solid var(--line); border-radius: 22px; padding: 18px 18px 16px; margin: 0 0 16px; overflow: hidden; box-shadow: 0 10px 22px rgba(0, 0, 0, .03); }
    .card-photo { margin: -18px -18px 16px; }
    .card-photo img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; }
    .card h3 { margin: 0 0 8px; font-weight: 400; font-size: 1.5rem; line-height: 1.15; letter-spacing: -.01em; color: var(--accent); }
    .card p, .card ul, .card ol { margin: 0 0 10px; }
    .card ul, .card ol { padding-left: 1.2rem; }
    .card li { margin: 0 0 7px; }
    .card li::marker { color: var(--accent); }
    .card > :last-child, .card li:last-child { margin-bottom: 0; }
    .lead { font-size: 1.02rem; }
    .topic .lead { margin: 4px 2px 16px; color: var(--text); }
    .role { display: block; font-family: Inter, system-ui, sans-serif; font-size: .85rem; color: var(--muted); letter-spacing: 0; margin-top: 2px; }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px !important; }
    .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 18px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: .95rem; flex: 1 1 auto; }
    .btn.call { background: var(--accent); color: var(--brand); }
    .btn.wa { background: var(--wa); color: #fff; }
    .code { display: inline-block; font: 600 1.05rem/1 ui-monospace, "SFMono-Regular", Consolas, monospace; letter-spacing: .08em; background: var(--accent); color: var(--brand); border-radius: 10px; padding: 7px 11px; margin-left: 4px; white-space: nowrap; }
    ul.codes { list-style: none; padding: 0; }
    ul.codes li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); margin: 0; }
    ul.codes li:last-child { border-bottom: 0; }
    .warn { background: #fff3e0; border: 1px solid #e8b06a; border-radius: 14px; padding: 12px 14px; }
    .small { font-size: .88rem; color: var(--muted); }
    figure { margin: 12px 0 0; }
    .card figure:not(.card-photo) img, video { display: block; width: 100%; height: auto; border-radius: 14px; background: var(--brand-3); }
    .tbl { width: 100%; border-collapse: collapse; font-size: .95rem; }
    .tbl th, .tbl td { padding: 9px 6px; border-bottom: 1px solid var(--line); text-align: left; }
    .tbl thead th { font-size: .82rem; color: var(--muted); }
    .tbl tbody th { font-weight: 600; }
    .pns { display: grid; gap: 12px; margin-top: 10px; }
    .pn { display: flex; align-items: center; gap: 14px; padding: 10px; border-radius: 20px; background: var(--brand-3); text-decoration: none; color: var(--accent); }
    .pn img { width: 64px; height: 64px; border-radius: 14px; object-fit: cover; flex: none; }
    .pn small { display: block; font-size: .78rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
    .pn span { font: 400 1.3rem/1.15 "Crimson Pro", Georgia, serif; }

    /* ---- search results ---- */
    .results { padding: 18px 0 40px; }
    .status { margin: 0 2px 14px; color: var(--muted); font-size: .95rem; }
    .result-topic { display: inline-flex; align-items: center; gap: 6px; margin: 6px 2px 8px; font-size: .8rem; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); text-decoration: none; }

    /* ---- the footer, as on the site: moss green, the owl behind ---- */
    .foot { position: relative; overflow: hidden; background: var(--accent); color: var(--brand); padding: 40px 0 calc(48px + env(safe-area-inset-bottom)); }
    .foot-owl { position: absolute; right: -30px; bottom: -40px; width: 220px; height: auto; opacity: .07; pointer-events: none; }
    .foot h2 { margin: 0 0 14px; font: 300 2rem/1.1 "Crimson Pro", Georgia, serif; color: var(--brand); }
    .foot nav { display: grid; grid-template-columns: 1fr; border-top: 1px solid rgba(239, 238, 213, .2); }
    .foot nav a { display: flex; justify-content: space-between; align-items: center; min-height: 52px; color: var(--brand); text-decoration: none; border-bottom: 1px solid rgba(239, 238, 213, .2); font-size: 1rem; }
    .foot nav a::after { content: "\2192"; opacity: .7; }
    .foot .signout { display: inline-flex; align-items: center; min-height: 46px; margin-top: 22px; padding: 0 20px; border-radius: 999px; border: 1px solid rgba(239, 238, 213, .5); color: var(--brand); text-decoration: none; font-weight: 600; }
    .foot .note { margin: 18px 0 0; font-size: .85rem; opacity: .7; max-width: 46ch; }
    .totop { position: fixed; right: 16px; bottom: max(16px, env(safe-area-inset-bottom)); z-index: 11; width: 48px; height: 48px; border-radius: 50%; border: 0; background: var(--accent); color: var(--brand); font-size: 1.3rem; box-shadow: 0 6px 16px rgba(0, 0, 0, .2); cursor: pointer; opacity: 0; pointer-events: none; transition: opacity .2s; }
    .totop.is-on { opacity: 1; pointer-events: auto; }

    @media (min-width: 700px) {
      .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 26px 20px; }
      .tile-img { aspect-ratio: 4 / 3; }
      .cards { columns: 2; }
      .pns { grid-template-columns: 1fr 1fr; }
      .pn-next { grid-column: 2; }
      .foot nav { grid-template-columns: 1fr 1fr; column-gap: 32px; }
      .hero-body { padding-bottom: 44px; }
    }
  </style>
</head>
<body>
  <header class="hero home-hero" id="home-hero">
    <img class="hero-img" src="{{HERO}}" alt="" fetchpriority="high">
    <div class="wrap hero-nav"><a class="brand" href="#">{{OWL}}<span class="wordmark">Cedar Hollow</span></a></div>
    <div class="wrap hero-body">
      <p class="eyebrow">For the team · Oxford</p>
      <h1>Staff <em>guide</em></h1>
      <p class="lead">Tours, rooms, breakfast, codes and contacts: everything for your shift.</p>
    </div>
  </header>
  <header class="hero topic-hero" id="topic-hero" hidden>
    <img class="hero-img" id="topic-img" src="" alt="">
    <div class="wrap hero-nav"><a class="back" href="#">&larr; All topics</a><a class="brand" href="#" aria-label="Staff guide home">{{OWL}}</a></div>
    <div class="wrap hero-body">
      <p class="eyebrow" id="topic-hint"></p>
      <h1 id="topic-title"></h1>
    </div>
  </header>
  <div class="searchbar">
    <div class="wrap">
      <a class="home-btn" href="#" aria-label="All topics">{{OWL}}</a>
      <form class="search" role="search" onsubmit="return false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <label for="q" class="sr">Search the guide</label>
        <input type="search" id="q" placeholder="Search the guide" autocomplete="off" enterkeyhint="search">
        <button type="button" id="clear" aria-label="Clear the search" hidden>&times;</button>
      </form>
    </div>
  </div>
  <main>
    <section id="home">
      <div class="wrap">
        <div class="today" id="today" hidden><p class="eyebrow" id="today-label">Today</p></div>
        <h2 class="h2">What do you <em>need?</em></h2>
        <ul class="tiles">{{TILES}}</ul>
      </div>
    </section>
    <section class="results" id="results" hidden><div class="wrap"><p class="status" id="status" aria-live="polite"></p><div class="cards" id="found"></div></div></section>
    {{TOPICS}}
  </main>
  <footer class="foot">
    {{OWLMARK}}
    <div class="wrap">
      <h2>Useful <em>links</em></h2>
      <nav aria-label="Useful links">{{LINKS}}</nav>
      <a class="signout" href="/staff/logout">Sign out</a>
      <p class="note">For the Cedar Hollow team only. Please don&rsquo;t share this page or its codes with guests.</p>
    </div>
  </footer>
  <button class="totop" id="totop" type="button" aria-label="Back to the top">&uarr;</button>
  <script>
  (function () {
    "use strict";
    var $ = function (id) { return document.getElementById(id); };
    var topics = [].slice.call(document.querySelectorAll(".topic"));
    var home = $("home"), results = $("results"), homeHero = $("home-hero"), topicHero = $("topic-hero");
    var q = $("q"), clear = $("clear");
    var homeY = 0, current = null;

    // ---- views: home, a topic, or search results; the address says which,
    // so the phone's Back button steps back through them ----
    function show(id) {
      var t = id && $(id);
      var topic = t && (t.classList.contains("topic") ? t : t.closest(".topic"));
      if (current === null && !topic) homeY = homeY || 0;
      if (current === null && topic) homeY = window.scrollY;
      topics.forEach(function (s) { s.hidden = s !== topic; });
      home.hidden = !!topic;
      homeHero.hidden = !!topic;
      topicHero.hidden = !topic;
      document.body.classList.toggle("in-topic", !!topic);
      if (topic) {
        $("topic-img").src = topic.getAttribute("data-photo");
        $("topic-title").textContent = topic.getAttribute("data-title");
        $("topic-hint").textContent = topic.getAttribute("data-hint");
        document.title = topic.getAttribute("data-title") + " | Staff guide";
        if (t !== topic) setTimeout(function () { t.scrollIntoView({ block: "start" }); }, 0);
        else window.scrollTo(0, 0);
        current = topic.id;
      } else {
        document.title = "Staff guide | Cedar Hollow";
        window.scrollTo(0, current ? homeY : 0);
        current = null;
      }
    }
    function route() {
      if (q.value) { q.value = ""; search(); }
      show(decodeURIComponent(location.hash.slice(1)));
    }
    window.addEventListener("hashchange", route);
    // A link to where you already are (a result for this topic, or All topics
    // while on the topics) changes no address, so it is followed by hand.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (a && a.getAttribute("href") === (location.hash || "#")) { e.preventDefault(); route(); }
    });
    route();

    // ---- today's job from the daily rota, by London's day of the week ----
    var day = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" }).format(new Date());
    var n = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].indexOf(day) + 1;
    var todays = document.querySelectorAll('.card[data-day="' + n + '"]');
    if (todays.length) {
      $("today-label").textContent = "Today, " + day;
      [].forEach.call(todays, function (c) {
        var a = document.createElement("a");
        a.href = "#" + c.id;
        a.textContent = c.querySelector("h3").textContent;
        $("today").appendChild(a);
      });
      $("today").hidden = false;
    }

    // ---- search: every word somewhere in a card or its topic's name ----
    function norm(s) { return s.toLowerCase().replace(/[’'\-]/g, "").replace(/\s+/g, " "); }
    var index = [];
    topics.forEach(function (s) {
      [].forEach.call(s.querySelectorAll(".card"), function (c) {
        index.push({ topic: s, card: c, text: norm(s.getAttribute("data-title") + " " + c.textContent) });
      });
    });
    function search() {
      var words = norm(q.value).trim().split(" ").filter(Boolean);
      clear.hidden = !words.length;
      document.body.classList.toggle("in-search", !!words.length);
      if (!words.length) {
        results.hidden = true;
        $("found").replaceChildren();
        show(decodeURIComponent(location.hash.slice(1)));
        return;
      }
      home.hidden = true; homeHero.hidden = true; topicHero.hidden = true;
      topics.forEach(function (s) { s.hidden = true; });
      results.hidden = false;
      var found = $("found"), total = 0, last = null;
      found.replaceChildren();
      index.forEach(function (e) {
        if (!words.every(function (w) { return e.text.indexOf(w) >= 0; })) return;
        var wrap = document.createElement("div");
        wrap.style.breakInside = "avoid";
        if (e.topic !== last) {
          var a = document.createElement("a");
          a.className = "result-topic";
          a.href = "#" + e.topic.id;
          a.textContent = e.topic.getAttribute("data-title") + " \u2192";
          wrap.appendChild(a);
          last = e.topic;
        }
        wrap.appendChild(e.card.cloneNode(true));
        found.appendChild(wrap);
        total++;
      });
      $("status").textContent = total ? total + (total === 1 ? " match" : " matches") : "Nothing in the guide matches that.";
    }
    q.addEventListener("input", search);
    clear.addEventListener("click", function () { q.value = ""; search(); q.focus(); });

    var top = $("totop");
    window.addEventListener("scroll", function () { top.classList.toggle("is-on", window.scrollY > 700); }, { passive: true });
    top.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
  })();
  </script>
</body>
</html>
"""

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dir", type=pathlib.Path, default=DEFAULT_DIR, help="the private folder with content.html and media/")
    ap.add_argument("--upload", choices=["local", "remote"], help="also put it into IG_KV: wrangler dev's store, or the live one")
    ap.add_argument("--persist-to", type=pathlib.Path, help="wrangler dev's state folder, with --upload local")
    a = ap.parse_args()
    out, media = build(a.dir)
    if a.upload:
        upload(out, media, a.dir / "content.html", a.upload, a.persist_to)
