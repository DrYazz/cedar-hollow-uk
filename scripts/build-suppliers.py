#!/usr/bin/env python3
"""Build the staff suppliers page, public/staff/suppliers.html, from docs/suppliers.json.

Served at cedarhollow.uk/staff/suppliers (a 200 rewrite in public/_redirects).
It is for the team, not for guests: it carries noindex, public/_headers adds
X-Robots-Tag for everything under /staff/, and nothing on the site links to it,
so it stays out of search engines and out of the sitemap. Nothing on it is
secret, so it has no password; logins and passwords are never put in the data.

The page is complete without its script: every supplier is in the HTML, by
woodland and by section. The script adds the two tabs (Oxford, Dorset) and the
search, which looks through both woodlands at once.

To add or change a supplier, edit docs/suppliers.json and run:
    python scripts/build-suppliers.py
"""

import html
import json
import pathlib
import re
from urllib.parse import quote

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "suppliers.json"
OUT = ROOT / "public" / "staff" / "suppliers.html"

e = html.escape


def tel(number):
    return "tel:" + re.sub(r"[^\d+]", "", number)


def nice_date(iso):
    import datetime
    d = datetime.date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%B %Y')}"


def card(item, section_title):
    role, name = item.get("role", ""), item["name"]
    people = item.get("people", "")
    actions = []
    words = [role, name, people, item.get("note", ""), section_title]
    for p in item.get("phones", []):
        label, number = (p.get("label"), p["number"]) if isinstance(p, dict) else (None, p)
        words.append(number)
        actions.append('<a class="act is-call" href="%s"><span class="act-k">Call%s</span> %s</a>'
                       % (e(tel(number)), " " + e(label) if label else "", e(number)))
    for m in item.get("emails", []):
        href = "mailto:" + m["address"] + ("?subject=" + quote(m["subject"]) if m.get("subject") else "")
        words.append(m["address"])
        actions.append('<a class="act is-mail" href="%s"><span class="act-k">Email%s</span> %s</a>'
                       % (e(href), " " + e(m["label"]) if m.get("label") else "", e(m["address"])))
    for l in item.get("links", []):
        host = re.sub(r"^https?://(www\.)?", "", l["url"]).split("/")[0]
        words.append(host)
        actions.append('<a class="act is-web" href="%s" target="_blank" rel="noopener"><span class="act-k">%s</span> %s</a>'
                       % (e(l["url"]), e(l["label"]), e(host)))
    search = " ".join(w for w in words if w).lower()
    return ('<li class="sup" data-search="%s"><p class="sup-role">%s</p><h3 class="sup-name">%s</h3>%s%s%s</li>'
            % (e(search), e(role), e(name),
               '<p class="sup-people">%s</p>' % e(people) if people else "",
               '<div class="sup-acts">%s</div>' % "".join(actions) if actions else "",
               '<p class="sup-note">%s</p>' % e(item["note"]) if item.get("note") else ""))


def place_panel(place, first):
    jump = "".join('<a href="#%s-%s">%s</a>' % (place["id"], s["id"], e(s["title"])) for s in place["sections"])
    sections = "".join(
        '<section class="sec" id="%s-%s" aria-labelledby="%s-%s-h"><h2 id="%s-%s-h">%s</h2><ul class="sups" role="list">%s</ul></section>'
        % (place["id"], s["id"], place["id"], s["id"], place["id"], s["id"], e(s["title"]),
           "".join(card(i, s["title"]) for i in s["items"]))
        for s in place["sections"])
    count = sum(len(s["items"]) for s in place["sections"])
    return ('<div class="panel" id="panel-%s" role="tabpanel" aria-labelledby="tab-%s" data-place="%s">'
            '<h2 class="place-h">%s suppliers <span class="place-n">%d</span></h2>'
            '<nav class="jump" aria-label="%s sections">%s</nav>%s'
            '<p class="none" hidden>No %s suppliers match.</p></div>'
            % (place["id"], place["id"], place["id"], e(place["name"]), count, e(place["name"]), jump, sections, e(place["name"])))


def build():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    places = data["places"]
    tabs = "".join(
        '<button type="button" role="tab" id="tab-%s" aria-controls="panel-%s" aria-selected="%s">%s <span class="tab-n" data-n="%s"></span></button>'
        % (p["id"], p["id"], "true" if i == 0 else "false", e(p["name"]), p["id"])
        for i, p in enumerate(places))
    panels = "".join(place_panel(p, i == 0) for i, p in enumerate(places))
    owl = (ROOT / "public" / "images" / "cedar-hollow-owl.svg").read_text(encoding="utf-8")
    owl = owl[owl.index("<svg"):].replace('fill="#F1ECDB"', 'fill="currentColor"')
    owl = owl.replace("<svg", '<svg aria-hidden="true" focusable="false" class="owl"', 1)
    page = TEMPLATE.replace("{{OWL}}", owl).replace("{{TABS}}", tabs).replace("{{PANELS}}", panels).replace("{{UPDATED}}", nice_date(data["updated"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8", newline="\n")
    total = sum(len(s["items"]) for p in places for s in p["sections"])
    print(f"wrote {OUT.relative_to(ROOT)}: {total} suppliers, " + ", ".join(
        f"{p['name']} {sum(len(s['items']) for s in p['sections'])}" for p in places))


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Suppliers | Cedar Hollow staff</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- For the team only: kept out of search engines here, by X-Robots-Tag in
       public/_headers, and by nothing on the site linking to it. Built from
       docs/suppliers.json by scripts/build-suppliers.py: edit that, not this. -->
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="/images/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/images/apple-touch-icon.png">
  <style>
    @font-face { font-family: "Crimson Pro"; src: url("/fonts/CrimsonPro-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    @font-face { font-family: "Inter"; src: url("/fonts/Inter_24pt-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
    @font-face { font-family: "Inter"; src: url("/fonts/Inter_24pt-SemiBold.woff2") format("woff2"); font-weight: 600; font-display: swap; }
    :root { --ink: #3b4126; --text: #3f4433; --muted: #6b6f5a; --paper: #f7f6ea; --card: #fffef8; --line: rgba(59, 65, 38, .18); --focus: #1f5fa8; }
    * { box-sizing: border-box; }
    html { scroll-padding-top: 9rem; }
    body { margin: 0; background: var(--paper); color: var(--text); font: 16px/1.5 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    a { color: var(--ink); }
    :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 0 16px; }
    header { padding: 20px 0 8px; }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; }
    .brand .owl { width: 30px; height: auto; flex: none; }
    .brand span { font: 400 1.35rem/1 "Crimson Pro", Georgia, serif; }
    h1 { font: 400 clamp(2rem, 6vw, 2.75rem)/1.05 "Crimson Pro", Georgia, serif; color: var(--ink); margin: 16px 0 4px; letter-spacing: -.01em; }
    .lead { margin: 0 0 4px; color: var(--muted); font-size: .95rem; }
    .bar { position: sticky; top: 0; z-index: 5; background: var(--paper); padding: 12px 0 10px; border-bottom: 1px solid var(--line); }
    .search { display: flex; gap: 8px; }
    .search input { flex: 1; min-width: 0; font: inherit; font-size: 1.05rem; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--text); }
    .search button { font: 600 1rem/1 Inter, system-ui, sans-serif; padding: 0 18px; min-height: 48px; border: 0; border-radius: 10px; background: var(--ink); color: #fffef8; cursor: pointer; }
    .tabs { display: flex; gap: 8px; margin-top: 10px; }
    .tabs button { font: 600 1rem/1 Inter, system-ui, sans-serif; min-height: 44px; padding: 0 18px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); color: var(--text); cursor: pointer; }
    .tabs button[aria-selected="true"] { background: var(--ink); border-color: var(--ink); color: #fffef8; }
    .tab-n:not(:empty) { font-weight: 400; opacity: .85; }
    .tab-n:not(:empty)::before { content: "("; } .tab-n:not(:empty)::after { content: ")"; }
    .status { min-height: 1.4em; margin: 8px 0 0; font-size: .9rem; color: var(--muted); }
    .status button { font: inherit; color: var(--ink); background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; }
    .place-h { font: 400 1.6rem/1.2 "Crimson Pro", Georgia, serif; color: var(--ink); margin: 22px 0 8px; }
    .place-n { font: 400 .9rem/1 Inter, system-ui, sans-serif; color: var(--muted); }
    .jump { display: flex; flex-wrap: wrap; gap: 6px 8px; margin: 0 0 6px; }
    .jump a { font-size: .875rem; padding: 7px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); text-decoration: none; color: var(--text); }
    .sec { margin: 26px 0 0; }
    .sec h2 { font: 600 .8rem/1.2 Inter, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; }
    .sups { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }
    .sup { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
    .sup-role { margin: 0; font-size: .8rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
    .sup-name { margin: 2px 0 0; font: 400 1.35rem/1.2 "Crimson Pro", Georgia, serif; color: var(--ink); }
    .sup-people { margin: 2px 0 0; }
    .sup-acts { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .act { display: flex; align-items: baseline; gap: 8px; min-height: 44px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; text-decoration: none; color: var(--text); overflow-wrap: anywhere; }
    .act:hover { border-color: var(--ink); }
    .act-k { flex: none; font-weight: 600; color: var(--ink); }
    .sup-note { margin: 10px 0 0; font-size: .9rem; color: var(--muted); }
    .none { margin: 18px 0; color: var(--muted); }
    footer { margin: 40px 0; font-size: .85rem; color: var(--muted); }
    [hidden] { display: none !important; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .js .panel:not(.is-on) { display: none; }
    @media (max-width: 480px) { .sups { grid-template-columns: 1fr; } h1 { margin-top: 12px; } html { scroll-padding-top: 10.5rem; } }
  </style>
  <script>document.documentElement.className += " js";</script>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">{{OWL}}<span>Cedar Hollow</span></a>
      <h1>Suppliers</h1>
      <p class="lead">For the team: who to call, email or order from, at each woodland.</p>
    </header>
  </div>
  <div class="bar">
    <div class="wrap">
      <form class="search" role="search" onsubmit="return false">
        <label for="q" class="sr">Search suppliers in both woodlands</label>
        <input type="search" id="q" placeholder="Search: plumber, pool, gas, Lisa…" autocomplete="off">
        <button type="submit" id="go">Search</button>
      </form>
      <div class="tabs" role="tablist" aria-label="Woodland">{{TABS}}</div>
      <p class="status" id="status" aria-live="polite"></p>
    </div>
  </div>
  <main class="wrap">{{PANELS}}</main>
  <div class="wrap">
    <footer>Updated {{UPDATED}}. To add or change a supplier, ask for it to be added to the list. Logins and passwords are kept in the password manager, never on this page.</footer>
  </div>
  <script>
  (function () {
    "use strict";
    var tabs = [].slice.call(document.querySelectorAll('[role="tab"]'));
    var panels = [].slice.call(document.querySelectorAll(".panel"));
    var q = document.getElementById("q");
    var status = document.getElementById("status");
    // A tab names itself in the address (#oxford, #dorset) so it can be
    // shared; on arrival the address is left as it came, so a link to a
    // section (#oxford-pools) still lands on it.
    function show(id, focus, keep) {
      tabs.forEach(function (t) {
        var on = t.id === "tab-" + id;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      panels.forEach(function (p) { p.classList.toggle("is-on", p.dataset.place === id); });
      if (!keep && history.replaceState) history.replaceState(null, "", "#" + id);
    }
    function current() {
      var t = tabs.filter(function (t) { return t.getAttribute("aria-selected") === "true"; })[0];
      return t ? t.id.slice(4) : panels[0].dataset.place;
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { show(t.id.slice(4)); filter(); });
      t.addEventListener("keydown", function (e) {
        var k = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!k) return;
        e.preventDefault();
        var next = tabs[(i + k + tabs.length) % tabs.length];
        show(next.id.slice(4), true);
        filter();
      });
    });
    // Every word typed has to appear somewhere in the supplier's card: its
    // job, name, people, numbers, email, website or notes.
    function filter() {
      var words = q.value.toLowerCase().trim().split(/\\s+/).filter(Boolean);
      var found = {};
      panels.forEach(function (p) {
        var n = 0;
        p.querySelectorAll(".sec").forEach(function (sec) {
          var shown = 0;
          sec.querySelectorAll(".sup").forEach(function (c) {
            var text = c.dataset.search;
            var hit = words.every(function (w) { return text.indexOf(w) >= 0; });
            c.hidden = !hit;
            if (hit) shown++;
          });
          sec.hidden = !shown;
          n += shown;
        });
        p.querySelector(".jump").hidden = words.length > 0;
        p.querySelector(".none").hidden = n > 0;
        found[p.dataset.place] = n;
      });
      tabs.forEach(function (t) {
        t.querySelector(".tab-n").textContent = words.length ? String(found[t.id.slice(4)]) : "";
      });
      status.replaceChildren();
      if (!words.length) return;
      var here = current();
      var other = tabs.map(function (t) { return t.id.slice(4); }).filter(function (id) { return id !== here && found[id]; })[0];
      var label = function (id) { return document.getElementById("tab-" + id).firstChild.textContent.trim(); };
      var n = found[here];
      status.appendChild(document.createTextNode((n ? n + (n === 1 ? " match" : " matches") : "No matches") + " in " + label(here) + "."));
      if (other) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = "See " + found[other] + " in " + label(other);
        b.addEventListener("click", function () { show(other); filter(); });
        status.appendChild(document.createTextNode(" "));
        status.appendChild(b);
      }
    }
    q.addEventListener("input", filter);
    document.getElementById("go").addEventListener("click", function () { filter(); q.blur(); });
    var start = location.hash.replace("#", "").split("-")[0];
    show(panels.some(function (p) { return p.dataset.place === start; }) ? start : panels[0].dataset.place, false, true);
    filter();
  })();
  </script>
</body>
</html>
"""

if __name__ == "__main__":
    build()
