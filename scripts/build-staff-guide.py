#!/usr/bin/env python3
"""Build the staff guide, and put it where the site serves it from.

The guide's words, photographs and video are NOT in this repository, which is
public: they include lock combinations, the escape room's start code and the
team's phone numbers. They live in a private folder on the office computer,
C:\\dev\\cedar-hollow-staff (or wherever --dir says):

    content.html   the guide itself: a <nav class="quick"> of quick links, then
                   one <section id data-title data-hint> per part, each a run
                   of <article class="card"> (data-day="1".."7" on the daily
                   jobs, Monday to Sunday, for the "Today" box)
    media/         photographs and video the content refers to as /staff/media/<name>
                   (the video an MP4 named .m4v: see worker/staff.js)

This script holds only the page around them (layout, styles, search), wraps
the content in it, writes build/guide.html into that folder, and with --upload
puts the page and every media file into the site's IG_KV store, where
worker/staff.js serves them to anyone signed in with the staff password.

    python scripts/build-staff-guide.py                    # build only
    python scripts/build-staff-guide.py --upload local     # into wrangler dev's store
    python scripts/build-staff-guide.py --upload remote    # live (a change to Cloudflare)

Made for a phone first: everything is one column, the sections open and shut,
the search stays at the top, and buttons are big enough for a thumb.
"""

import argparse
import html
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_DIR = pathlib.Path(r"C:\dev\cedar-hollow-staff")


def parse(content):
    # Notes for whoever edits the content are comments; they are never part of the page.
    content = re.sub(r"<!--.*?-->", "", content, flags=re.S)
    quick = re.search(r'<nav class="quick"[^>]*>(.*?)</nav>', content, re.S)
    sections = []
    for m in re.finditer(r'<section id="([a-z0-9-]+)" data-title="([^"]+)" data-hint="([^"]*)">(.*?)</section>', content, re.S):
        sections.append({"id": m.group(1), "title": m.group(2), "hint": m.group(3), "body": m.group(4).strip()})
    if not sections:
        sys.exit("No <section id data-title data-hint> found in content.html")
    return (quick.group(1).strip() if quick else ""), sections


def build(folder):
    content = (folder / "content.html").read_text(encoding="utf-8")
    quick, sections = parse(content)
    owl = (ROOT / "public" / "images" / "cedar-hollow-owl.svg").read_text(encoding="utf-8")
    owl = owl[owl.index("<svg"):].replace('fill="#F1ECDB"', 'fill="currentColor"').replace("<svg", '<svg aria-hidden="true" focusable="false" class="owl"', 1)
    body = "".join(
        '<details class="sec" id="%s"><summary><span class="sec-t">%s</span><span class="sec-h">%s</span></summary>'
        '<div class="sec-body">%s</div></details>' % (s["id"], html.escape(s["title"]), html.escape(s["hint"]), s["body"])
        for s in sections)
    page = (TEMPLATE.replace("{{OWL}}", owl).replace("{{QUICK}}", quick).replace("{{SECTIONS}}", body))
    out = folder / "build" / "guide.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(page, encoding="utf-8", newline="\n")
    # Every media file the page refers to should be there, and nothing extra uploaded by mistake.
    wanted = sorted(set(re.findall(r'/staff/media/([a-z0-9-]+\.(?:m4v|webp|jpg|png))', page)))
    missing = [w for w in wanted if not (folder / "media" / w).exists()]
    if missing:
        sys.exit("Missing from media/: " + ", ".join(missing))
    cards = len(re.findall(r'<article class="card', page))
    print(f"built {out}: {len(sections)} sections, {cards} cards, {len(wanted)} media files, {len(page) // 1024} KB")
    return out, [folder / "media" / w for w in wanted]


def upload(page, media, where, persist=None):
    def put(key, path):
        cmd = ["npx", "wrangler", "kv", "key", "put", key, "--path", str(path), "--binding", "IG_KV", "--" + where]
        if where == "local" and persist:
            cmd += ["--persist-to", str(persist)]
        r = subprocess.run(cmd, cwd=ROOT, shell=(sys.platform == "win32"), capture_output=True, text=True)
        if r.returncode:
            sys.exit(f"Upload of {key} failed:\n{r.stdout}\n{r.stderr}")
        print(f"  {key}  ({path.stat().st_size // 1024} KB)")
    print(f"uploading to the {where} IG_KV:")
    for m in media:
        put(f"staff:media/{m.name}", m)
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
  <style>
    @font-face { font-family: "Crimson Pro"; src: url("/fonts/CrimsonPro-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    @font-face { font-family: "Inter"; src: url("/fonts/Inter_24pt-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    @font-face { font-family: "Inter"; src: url("/fonts/Inter_24pt-SemiBold.woff2") format("woff2"); font-weight: 600; font-display: swap; }
    :root { --ink: #3b4126; --text: #34392a; --muted: #62664f; --paper: #f7f6ea; --card: #fffef8; --line: rgba(59, 65, 38, .18); --focus: #1f5fa8; --wa: #1f7a45; }
    * { box-sizing: border-box; }
    html { scroll-padding-top: 6.5rem; -webkit-text-size-adjust: 100%; }
    body { margin: 0; background: var(--paper); color: var(--text); font: 17px/1.55 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    a { color: var(--ink); text-underline-offset: .15em; }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 0 16px; padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }
    header.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 0 6px; }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; }
    .brand .owl { width: 28px; height: auto; flex: none; }
    .brand b { font: 400 1.5rem/1 "Crimson Pro", Georgia, serif; }
    .signout { font-size: .9rem; color: var(--muted); padding: 10px 4px; }
    .bar { position: sticky; top: 0; z-index: 5; background: var(--paper); padding: 10px 0 8px; border-bottom: 1px solid var(--line); }
    .search { position: relative; }
    .search input { width: 100%; font: inherit; font-size: 1.05rem; padding: 13px 48px 13px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--text); -webkit-appearance: none; appearance: none; }
    .search input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
    .search button { position: absolute; right: 4px; top: 4px; width: 44px; height: 44px; border: 0; background: none; font-size: 1.4rem; color: var(--muted); cursor: pointer; border-radius: 10px; }
    .status { margin: 6px 0 0; font-size: .9rem; color: var(--muted); min-height: 1.3em; }
    .quick { display: flex; gap: 8px; overflow-x: auto; padding: 12px 0 4px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .quick::-webkit-scrollbar { display: none; }
    .quick a { flex: none; display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 999px; background: var(--ink); color: #fffef8; text-decoration: none; font-weight: 600; font-size: .95rem; white-space: nowrap; }
    .today { margin: 14px 0 4px; background: #eef1e2; border: 1px solid rgba(59, 65, 38, .25); border-radius: 16px; padding: 14px 16px 6px; }
    .today > p { margin: 0 0 6px; font-size: .78rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
    .today .card { background: none; border: 0; padding: 0; margin: 0 0 8px; }
    main { padding: 10px 0 40px; }
    .sec { margin: 10px 0; background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
    .sec > summary { list-style: none; cursor: pointer; display: flex; flex-direction: column; gap: 2px; padding: 16px 52px 16px 16px; position: relative; min-height: 64px; }
    .sec > summary::-webkit-details-marker { display: none; }
    .sec > summary::after { content: ""; position: absolute; right: 20px; top: 50%; width: 10px; height: 10px; border-right: 2px solid var(--ink); border-bottom: 2px solid var(--ink); transform: translateY(-70%) rotate(45deg); transition: transform .2s; }
    .sec[open] > summary::after { transform: translateY(-30%) rotate(-135deg); }
    .sec-t { font: 400 1.45rem/1.15 "Crimson Pro", Georgia, serif; color: var(--ink); }
    .sec-h { font-size: .9rem; color: var(--muted); }
    .sec-body { padding: 0 12px 12px; }
    .lead { margin: 0 4px 10px; }
    .card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px 14px 12px; margin: 0 0 10px; }
    .card h3 { margin: 0 0 6px; font-size: 1.05rem; line-height: 1.3; color: var(--ink); }
    .card p, .card ul, .card ol { margin: 0 0 8px; }
    .card ul, .card ol { padding-left: 1.25rem; }
    .card li { margin: 0 0 6px; }
    .card li:last-child, .card p:last-child { margin-bottom: 0; }
    .role { display: block; font-weight: 400; font-size: .85rem; color: var(--muted); }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px !important; }
    .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 46px; padding: 0 16px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: .95rem; }
    .btn.call { background: var(--ink); color: #fffef8; flex: 1 1 auto; }
    .btn.wa { background: var(--wa); color: #fff; flex: 1 1 auto; }
    .code { display: inline-block; font: 600 1.05rem/1 ui-monospace, "SFMono-Regular", Consolas, monospace; letter-spacing: .08em; background: var(--ink); color: #fffef8; border-radius: 8px; padding: 6px 10px; margin-left: 4px; }
    ul.codes { list-style: none; padding: 0; }
    ul.codes li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
    ul.codes li:last-child { border-bottom: 0; }
    .warn { background: #fff3e0; border: 1px solid #e8b06a; border-radius: 10px; padding: 10px 12px; }
    .small { font-size: .88rem; color: var(--muted); }
    figure { margin: 10px 0 0; }
    figure img, video { display: block; width: 100%; height: auto; border-radius: 10px; background: #e9e7d7; }
    video { margin-top: 6px; }
    .tbl { width: 100%; border-collapse: collapse; font-size: .95rem; }
    .tbl th, .tbl td { padding: 8px 6px; border-bottom: 1px solid var(--line); text-align: left; }
    .tbl thead th { font-size: .85rem; color: var(--muted); }
    .tbl tbody th { font-weight: 600; }
    .none { text-align: center; color: var(--muted); padding: 24px 0; }
    .totop { position: fixed; right: 16px; bottom: max(16px, env(safe-area-inset-bottom)); width: 48px; height: 48px; border-radius: 50%; border: 0; background: var(--ink); color: #fffef8; font-size: 1.3rem; box-shadow: 0 4px 14px rgba(0, 0, 0, .18); cursor: pointer; opacity: 0; pointer-events: none; transition: opacity .2s; }
    .totop.is-on { opacity: 1; pointer-events: auto; }
    [hidden] { display: none !important; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (min-width: 700px) { .sec-body { padding: 0 16px 16px; } .card { padding: 16px 18px 14px; } }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <a class="brand" href="/staff/">{{OWL}}<b>Staff guide</b></a>
      <a class="signout" href="/staff/logout">Sign out</a>
    </header>
  </div>
  <div class="bar">
    <div class="wrap">
      <form class="search" role="search" onsubmit="return false">
        <label for="q" class="sr">Search the guide</label>
        <input type="search" id="q" placeholder="Search: codes, sauna, parking…" autocomplete="off" enterkeyhint="search">
        <button type="button" id="clear" aria-label="Clear the search" hidden>&times;</button>
      </form>
      <p class="status" id="status" aria-live="polite"></p>
    </div>
  </div>
  <div class="wrap">
    <nav class="quick" aria-label="Quick links">{{QUICK}}</nav>
    <div class="today" id="today" hidden><p id="today-label">Today</p></div>
    <main id="main">{{SECTIONS}}<p class="none" id="none" hidden>Nothing in the guide matches that.</p></main>
  </div>
  <button class="totop" id="totop" type="button" aria-label="Back to the top">&uarr;</button>
  <script>
  (function () {
    "use strict";
    var secs = [].slice.call(document.querySelectorAll(".sec"));
    var q = document.getElementById("q");
    var clear = document.getElementById("clear");
    var status = document.getElementById("status");

    // A link to a section (#hottub) opens it.
    function openTo(id) {
      var el = id && document.getElementById(id);
      if (!el) return;
      var sec = el.closest(".sec");
      if (sec) sec.open = true;
      el.scrollIntoView({ block: "start" });
    }
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute("href").slice(1);
      if (document.getElementById(id)) { e.preventDefault(); openTo(id); history.replaceState(null, "", "#" + id); }
    });
    if (location.hash) openTo(location.hash.slice(1));

    // Today's job from the daily rota, by London's day of the week.
    var day = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" }).format(new Date());
    var n = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].indexOf(day) + 1;
    var todays = document.querySelectorAll('.card[data-day="' + n + '"]');
    if (todays.length) {
      var box = document.getElementById("today");
      document.getElementById("today-label").textContent = "Today, " + day;
      [].forEach.call(todays, function (c) {
        var copy = c.cloneNode(true);
        copy.removeAttribute("data-day");
        copy.classList.add("is-copy");
        box.appendChild(copy);
      });
      box.hidden = false;
    }

    // Search: every word has to be somewhere in a card (or its section's
    // title); sections with a match open, the rest step aside.
    var cards = secs.map(function (s) {
      var title = s.querySelector(".sec-t").textContent;
      return [].map.call(s.querySelectorAll(".card"), function (c) {
        return { el: c, text: (title + " " + c.textContent).toLowerCase().replace(/\s+/g, " ") };
      });
    });
    var wasOpen = null;
    function filter() {
      var words = q.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      clear.hidden = !words.length;
      document.getElementById("today").style.display = words.length ? "none" : "";
      if (!words.length) {
        cards.forEach(function (list) { list.forEach(function (c) { c.el.hidden = false; }); });
        secs.forEach(function (s, i) {
          s.hidden = false;
          [].forEach.call(s.querySelectorAll(".lead"), function (p) { p.hidden = false; });
          if (wasOpen) s.open = wasOpen[i];
        });
        wasOpen = null;
        status.textContent = "";
        document.getElementById("none").hidden = true;
        return;
      }
      if (!wasOpen) wasOpen = secs.map(function (s) { return s.open; });
      var total = 0;
      secs.forEach(function (s, i) {
        var hits = 0;
        cards[i].forEach(function (c) {
          var hit = words.every(function (w) { return c.text.indexOf(w) >= 0; });
          c.el.hidden = !hit;
          if (hit) hits++;
        });
        [].forEach.call(s.querySelectorAll(".lead"), function (p) { p.hidden = true; });
        s.hidden = !hits;
        s.open = hits > 0;
        total += hits;
      });
      status.textContent = total ? total + (total === 1 ? " match" : " matches") : "";
      document.getElementById("none").hidden = total > 0;
    }
    q.addEventListener("input", filter);
    clear.addEventListener("click", function () { q.value = ""; filter(); q.focus(); });

    var top = document.getElementById("totop");
    window.addEventListener("scroll", function () { top.classList.toggle("is-on", window.scrollY > 600); }, { passive: true });
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
        upload(out, media, a.upload, a.persist_to)
