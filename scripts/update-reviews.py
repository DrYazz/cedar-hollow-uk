#!/usr/bin/env python3
"""Push the figures in docs/reviews-data.json into every review strip on the site.

A review strip is any run of markup wrapped in marker comments:

    <!-- ch:reviews oxford -->   ... <!-- /ch:reviews -->
    <!-- ch:reviews dorset -->   ... <!-- /ch:reviews -->
    <!-- ch:reviews all -->      ... <!-- /ch:reviews -->

The name is a property key from the data file, or "all" for both woodlands
combined. Inside a strip this script maintains four things and touches nothing
else, so each page keeps its own markup:

  * the rating numeral after the stars
  * the fill on the fifth star, so 4.9 does not draw as five full stars
  * the "from N guest reviews" line
  * the aria-label and the href, where the strip is a link: each woodland's
    strip points at its own review page, "all" points at the hub

To add a strip to a new page, wrap it in the markers and run this. The star
gradient is inserted on first run.

Three more markers fill in the review pages themselves:

    <!-- ch:reviews-breakdown oxford -->  ... <!-- /ch:reviews-breakdown -->
    <!-- ch:reviews-breakdown -->         ... <!-- /ch:reviews-breakdown -->
    <!-- ch:reviews-index -->             ... <!-- /ch:reviews-index -->

A breakdown names every platform a woodland is rated on, with its own rating,
count and link, so a reader can add the total up. Naming a property limits it
to that one; leaving it bare lists them all. The index is the hub listing: one
line per woodland, linking to its page.

Usage:
    python3 scripts/update-reviews.py           # write the figures
    python3 scripts/update-reviews.py --check   # report drift, change nothing
"""

import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "reviews-data.json"
PAGES = ROOT / "public"
LIVE_JS = ROOT / "public" / "js" / "reviews-live.js"

BLOCK_RE = re.compile(r"<!-- ch:reviews ([\w-]+) -->(.*?)<!-- /ch:reviews -->", re.S)
BREAKDOWN_RE = re.compile(
    r"(<!-- ch:reviews-breakdown ?([\w-]*) -->)(.*?)(<!-- /ch:reviews-breakdown -->)", re.S
)
INDEX_RE = re.compile(r"(<!-- ch:reviews-index -->)(.*?)(<!-- /ch:reviews-index -->)", re.S)
NUMERAL_RE = re.compile(r"(</svg><span>)[\d.]+(\s*</span>)")
LINE_RE = re.compile(r'(<p class="text-size-medium">).*?(</p>)', re.S)
ARIA_RE = re.compile(r'(aria-label=")Read guest reviews:[^"]*(")')
SVG_OPEN_RE = re.compile(r"<svg\b[^>]*\bclass=\"hero_rating-stars\"[^>]*>")
LAST_STAR_RE = re.compile(r"(<path\b(?:(?!</path>).)*?)fill=\"currentColor\"((?:(?!</path>).)*?></path>)(?!.*<path\b(?:(?!</path>).)*?fill=\"currentColor\")", re.S)
STOP_RE = re.compile(r'(<stop offset=")[\d.]+(%")')
HREF_RE = re.compile(r'(<a href=")[^"]*("[^>]*\bch-reviews-link\b)')
JS_DATA_RE = re.compile(r"(/\* ch:data\b.*?\*/\n)(.*?)(\n[ \t]*/\* /ch:data \*/)", re.S)


def aggregate(sources):
    """Count-weighted mean rating, and the total number of reviews behind it."""
    total = sum(s["count"] for s in sources)
    if not total:
        return 0.0, 0
    mean = sum(s["rating"] * s["count"] for s in sources) / total
    return round(mean, 1), total


def figures(data):
    """Rating and review count for each strip name, including the combined one."""
    out = {}
    combined = []
    for key, prop in data["properties"].items():
        out[key] = aggregate(prop["sources"])
        combined.extend(prop["sources"])
    out["all"] = aggregate(combined)
    return out


def star_gradient(grad_id, rating):
    """Defs for a fifth star filled to the fraction the rating actually earns."""
    pct = max(0.0, min(1.0, rating - 4)) * 100
    pct = f"{pct:g}"
    return (
        f'<defs><linearGradient id="{grad_id}" x1="0" y1="0" x2="1" y2="0">'
        f'<stop offset="{pct}%" stop-color="currentColor"></stop>'
        f'<stop offset="{pct}%" stop-color="currentColor" stop-opacity="0.25"></stop>'
        f"</linearGradient></defs>"
    )


def ensure_gradient(block, grad_id, rating):
    """Add the partial-star gradient on first run; afterwards just move the stop."""
    if grad_id in block:
        return STOP_RE.sub(
            lambda m: m.group(1) + f"{max(0.0, min(1.0, rating - 4)) * 100:g}" + m.group(2),
            block,
        )

    svg = SVG_OPEN_RE.search(block)
    if not svg:
        return block
    block = block[: svg.end()] + star_gradient(grad_id, rating) + block[svg.end() :]
    # Point the last full star at the gradient so it can render a partial fill.
    return LAST_STAR_RE.sub(
        lambda m: m.group(1) + f'fill="url(#{grad_id})"' + m.group(2), block, count=1
    )


def render(block, name, rating, count, badge, grad_id, page):
    rating_text = f"{rating:.1f}"
    line = f"from {count:,} guest reviews • {badge}"
    block = ensure_gradient(block, grad_id, rating)
    block = NUMERAL_RE.sub(lambda m: m.group(1) + rating_text + m.group(2), block)
    block = LINE_RE.sub(lambda m: m.group(1) + line + m.group(2), block)
    block = HREF_RE.sub(lambda m: m.group(1) + page + m.group(2), block)
    block = ARIA_RE.sub(
        lambda m: m.group(1)
        + f"Read guest reviews: rated {rating_text} from {count:,} guest reviews, {badge}"
        + m.group(2),
        block,
    )
    return block


def fmt_rating(rating):
    """Two decimals where a platform reports them (Airbnb's 4.97), one otherwise."""
    text = f"{rating:.2f}"
    return text[:-1] if text.endswith("0") else text


def breakdown(data, figs, indent, scope=""):
    """The per-platform evidence behind a headline number."""
    checked = _long_date(data["checked"])
    wanted = [scope] if scope else list(data["properties"])
    lines = []
    for key in wanted:
        prop = data["properties"][key]
        rating, count = figs[key]
        lines.append(
            f'<p class="text-size-large"><strong>{html.escape(prop["name"])}</strong>'
            f" &mdash; {rating:.1f} from {count:,} guest reviews</p>"
        )
        lines.append('<ul class="ch-list text-size-large">')
        for src in prop["sources"]:
            label = html.escape(src["platform"])
            if src.get("listing"):
                label += f' &mdash; {html.escape(src["listing"])}'
            lines.append(
                f'  <li><a href="{html.escape(src["url"])}" target="_blank"'
                f' rel="noopener">{label}</a> &mdash; {fmt_rating(src["rating"])}'
                f' from {src["count"]:,} reviews</li>'
            )
        lines.append("</ul>")
        # The sentence has to be true of whatever the reader is actually
        # looking at. For a property on the live feed this markup is the
        # fallback -- real figures, read by hand, possibly a little behind --
        # and js/reviews-live.js replaces the whole block when it can reach
        # the feed. For a property without one, this is all there ever is.
        if prop.get("live"):
            lines.append(
                f'<p class="text-size-medium">Each figure was read from that'
                f" platform&#x27;s own listing on {checked}, and updates to the"
                f" platform&#x27;s current total automatically where your browser"
                f" can reach it.</p>"
            )
        else:
            lines.append(
                f'<p class="text-size-medium">Each figure was read from that'
                f" platform&#x27;s own listing on {checked}."
                f" {html.escape(prop['short'])} is not on the live feed, so these"
                f" move only when someone updates them here.</p>"
            )
    body = ("\n" + indent).join(lines)
    return f"\n{indent}{body}\n{indent}"


def index_links(data, figs, indent):
    """Hub listing: each woodland's headline figure, linking to its own page."""
    lines = ['<ul class="ch-list text-size-large">']
    for key, prop in data["properties"].items():
        rating, count = figs[key]
        lines.append(
            f'  <li><a href="{prop["page"]}">{html.escape(prop["short"])}</a>'
            f' &mdash; {rating:.1f} from {count:,} guest reviews'
            f' on {sources_sentence(prop)}</li>'
        )
    lines.append("</ul>")
    return "\n" + indent + ("\n" + indent).join(lines) + "\n" + indent


def sources_sentence(prop):
    """"Google, Tripadvisor and Airbnb" — each platform once, in data order."""
    seen = []
    for src in prop["sources"]:
        if src["platform"] not in seen:
            seen.append(html.escape(src["platform"]))
    if len(seen) == 1:
        return seen[0]
    return ", ".join(seen[:-1]) + " and " + seen[-1]


def _long_date(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    months = ("January", "February", "March", "April", "May", "June", "July",
              "August", "September", "October", "November", "December")
    return f"{d} {months[m - 1]} {y}"


def live_config(data, figs):
    """The slice of the data file js/reviews-live.js needs at runtime.

    It carries the hand-read figures as the fallback, the endpoint for any
    property on a live feed, and each platform's link so the refreshed
    breakdown can still point a reader at the source.
    """
    props = {}
    for key, prop in data["properties"].items():
        rating, count = figs[key]
        entry = {
            "name": prop["name"],
            "short": prop["short"],
            "page": prop["page"],
            "rating": rating,
            "count": count,
            "sources": [
                {
                    "platform": s["platform"],
                    "listing": s.get("listing", ""),
                    "url": s["url"],
                }
                for s in prop["sources"]
            ],
        }
        if prop.get("live"):
            entry["live"] = {"endpoint": prop["live"]["endpoint"]}
        props[key] = entry
    return {"badge": data["badge"], "checked": data["checked"], "properties": props}


def write_live_config(data, figs, check):
    """Keep the generated DATA blob in js/reviews-live.js in step."""
    if not LIVE_JS.exists():
        return None
    text = LIVE_JS.read_text(encoding="utf-8")
    match = JS_DATA_RE.search(text)
    if not match:
        sys.exit(f"{LIVE_JS.name}: ch:data markers not found")
    blob = json.dumps(live_config(data, figs), indent=2, ensure_ascii=False)
    blob = "\n".join(
        ("  " + line) if line else line for line in f"var DATA = {blob};".split("\n")
    )
    updated = text[: match.start(2)] + blob + text[match.end(2) :]
    if updated == text:
        return None
    if not check:
        LIVE_JS.write_text(updated, encoding="utf-8")
    return LIVE_JS.relative_to(ROOT)


def main():
    check = "--check" in sys.argv
    data = json.loads(DATA.read_text(encoding="utf-8"))
    figs = figures(data)
    badge = data["badge"]

    changed = []
    for path in sorted(PAGES.glob("*.html")):
        text = path.read_text(encoding="utf-8")
        seen = {}

        def replace(match):
            name, block = match.group(1), match.group(2)
            if name not in figs:
                sys.exit(f"{path.name}: unknown review strip '{name}'")
            seen[name] = seen.get(name, 0) + 1
            grad_id = f"chStars-{name}-{seen[name]}"
            rating, count = figs[name]
            page = (data["properties"][name]["page"] if name in data["properties"]
                    else data["hub_page"])
            body = render(block, name, rating, count, badge, grad_id, page)
            return f"<!-- ch:reviews {name} -->{body}<!-- /ch:reviews -->"

        def marker_indent(match):
            line_start = match.string.rfind("\n", 0, match.start()) + 1
            indent = match.string[line_start : match.start()]
            return "" if indent.strip() else indent

        def replace_breakdown(match):
            scope = match.group(2)
            if scope and scope not in data["properties"]:
                sys.exit(f"{path.name}: unknown review breakdown '{scope}'")
            body = breakdown(data, figs, marker_indent(match), scope)
            return match.group(1) + body + match.group(4)

        def replace_index(match):
            body = index_links(data, figs, marker_indent(match))
            return match.group(1) + body + match.group(3)

        updated = BLOCK_RE.sub(replace, text)
        updated = BREAKDOWN_RE.sub(replace_breakdown, updated)
        updated = INDEX_RE.sub(replace_index, updated)
        if updated != text:
            changed.append(path.relative_to(ROOT))
            if not check:
                path.write_text(updated, encoding="utf-8")

    live_changed = write_live_config(data, figs, check)
    if live_changed:
        changed.append(live_changed)

    for key in sorted(figs):
        rating, count = figs[key]
        live = key in data["properties"] and data["properties"][key].get("live")
        note = f"  (live via {data['properties'][key]['live']['provider']})" if live else ""
        print(f"  {key:<8} {rating:.1f} from {count:,} reviews{note}")
    print()
    if not changed:
        print("All review strips are up to date.")
    elif check:
        print("Out of date:")
        for p in changed:
            print(f"  {p}")
        sys.exit(1)
    else:
        print("Updated:")
        for p in changed:
            print(f"  {p}")


if __name__ == "__main__":
    main()
