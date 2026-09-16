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
  * the aria-label, where the strip is a link

To add a strip to a new page, wrap it in the markers and run this. The star
gradient is inserted on first run.

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

BLOCK_RE = re.compile(r"<!-- ch:reviews ([\w-]+) -->(.*?)<!-- /ch:reviews -->", re.S)
BREAKDOWN_RE = re.compile(
    r"(<!-- ch:reviews-breakdown -->)(.*?)(<!-- /ch:reviews-breakdown -->)", re.S
)
NUMERAL_RE = re.compile(r"(</svg><span>)[\d.]+(\s*</span>)")
LINE_RE = re.compile(r'(<p class="text-size-medium">).*?(</p>)', re.S)
ARIA_RE = re.compile(r'(aria-label=")Read guest reviews:[^"]*(")')
SVG_OPEN_RE = re.compile(r"<svg\b[^>]*\bclass=\"hero_rating-stars\"[^>]*>")
LAST_STAR_RE = re.compile(r"(<path\b(?:(?!</path>).)*?)fill=\"currentColor\"((?:(?!</path>).)*?></path>)(?!.*<path\b(?:(?!</path>).)*?fill=\"currentColor\")", re.S)
STOP_RE = re.compile(r'(<stop offset=")[\d.]+(%")')


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


def render(block, name, rating, count, badge, grad_id):
    rating_text = f"{rating:.1f}"
    line = f"from {count:,} guest reviews • {badge}"
    block = ensure_gradient(block, grad_id, rating)
    block = NUMERAL_RE.sub(lambda m: m.group(1) + rating_text + m.group(2), block)
    block = LINE_RE.sub(lambda m: m.group(1) + line + m.group(2), block)
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


def breakdown(data, figs, indent):
    """The per-platform evidence behind the headline numbers, for reviews.html."""
    checked = _long_date(data["checked"])
    lines = []
    for key, prop in data["properties"].items():
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
    lines.append(
        f'<p class="text-size-medium">Each figure was read from that platform&#x27;s'
        f" own listing on {checked}. We do not use a review widget, so the numbers"
        f" move only when someone updates them here.</p>"
    )
    body = ("\n" + indent).join(lines)
    return f"\n{indent}{body}\n{indent}"


def _long_date(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    months = ("January", "February", "March", "April", "May", "June", "July",
              "August", "September", "October", "November", "December")
    return f"{d} {months[m - 1]} {y}"


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
            body = render(block, name, rating, count, badge, grad_id)
            return f"<!-- ch:reviews {name} -->{body}<!-- /ch:reviews -->"

        def replace_breakdown(match):
            line_start = match.string.rfind("\n", 0, match.start()) + 1
            indent = match.string[line_start : match.start()]
            if indent.strip():
                indent = ""
            return match.group(1) + breakdown(data, figs, indent) + match.group(3)

        updated = BREAKDOWN_RE.sub(replace_breakdown, BLOCK_RE.sub(replace, text))
        if updated != text:
            changed.append(path.relative_to(ROOT))
            if not check:
                path.write_text(updated, encoding="utf-8")

    for key in sorted(figs):
        rating, count = figs[key]
        print(f"  {key:<8} {rating:.1f} from {count:,} reviews")
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
