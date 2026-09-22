#!/usr/bin/env python3
"""Render the press tiles from docs/press-data.json.

A press block is any run of markup wrapped in marker comments:

    <!-- ch:press oxford -->  ...  <!-- /ch:press -->
    <!-- ch:press dorset -->  ...  <!-- /ch:press -->

The name is a section key from the data file. Everything between the markers is
regenerated, so the tiles are never edited in the HTML directly -- the data file
is the only place a quote or a URL is written down, which is what makes it
possible to re-check the whole set against the live articles in one pass, and
what keeps the combined page and the two location pages from drifting apart.

Usage:
    python3 scripts/update-press.py           # write the cards
    python3 scripts/update-press.py --check   # report drift, change nothing
"""

import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "press-data.json"
# Every page carrying press markers. The combined page shows both sections;
# each location page shows its own. One data file feeds all three, so a
# corrected URL or a new quote lands everywhere at once.
PAGES = [
    ROOT / "public" / "press.html",
    ROOT / "public" / "oxford-press.html",
    ROOT / "public" / "dorset-press.html",
]

BLOCK_RE = re.compile(r"(<!-- ch:press ([\w-]+) -->)(.*?)(<!-- /ch:press -->)", re.S)
SCREEN_RE = re.compile(r"(<!-- ch:press-screen ([\w-]+) -->)(.*?)(<!-- /ch:press-screen -->)", re.S)


def marker_indent(match):
    line_start = match.string.rfind("\n", 0, match.start()) + 1
    indent = match.string[line_start : match.start()]
    return "" if indent.strip() else indent


def asset(path):
    """Fail loudly on a missing file rather than shipping a broken image."""
    if not (ROOT / "public" / path).exists():
        sys.exit("press-data.json: no such file: public/%s" % path)
    return html.escape(path, quote=True)


def card(item):
    """One article: who ran it, what they called it, and a line from the piece."""
    pub = html.escape(item["publication"])
    url = html.escape(item["url"], quote=True)
    headline = html.escape(item["headline"])
    quote = item.get("quote")
    logo = item.get("logo")
    shot = item.get("shot")

    parts = ['<article class="ch-press__card%s">' % ("" if quote else " ch-press__card--bare")]

    if shot:
        # The clipping is the tile, as on the Oaks reviews page: the article as
        # it was published, masthead and headline and lead picture together.
        # The whole thing is the link, so the headline is not repeated as text
        # underneath -- it is already in the image. aria-label carries it for
        # anyone who cannot see the clipping, which is why the <img> alt is
        # empty: the label would otherwise be read out twice.
        parts.append(
            '  <a class="ch-press__clip" href="%s" target="_blank" rel="noopener" '
            'aria-label="Read &ldquo;%s&rdquo; on %s"><img src="%s" srcset="%s" '
            'sizes="(max-width: 767px) 45vw, 14rem" loading="lazy" decoding="async" '
            'alt=""></a>' % (url, headline, pub, asset(shot["src"]),
                             html.escape(shot["srcset"], quote=True))
        )

    parts.append('  <div class="ch-press__body">')
    if logo:
        # Drawn as a mask (see press.css), so the file is named in a style
        # rather than a src. role/aria-label carry the masthead, so the
        # publication is still announced once to a screen reader.
        src = asset(logo)
        parts.append(
            '    <span class="ch-press__logo" role="img" aria-label="%s" '
            "style=\"-webkit-mask-image:url('%s');mask-image:url('%s')\"></span>"
            % (pub, src, src)
        )
    else:
        parts.append('    <p class="ch-press__pub">%s</p>' % pub)

    if not shot:
        parts.append(
            '    <h3 class="ch-press__headline">'
            '<a href="%s" target="_blank" rel="noopener">%s</a></h3>' % (url, headline)
        )
    if quote:
        # &ldquo;/&rdquo; rather than bare quotes: this is someone else's
        # sentence and it should look like one.
        parts.append(
            '    <blockquote class="ch-press__quote"><p>&ldquo;%s&rdquo;</p></blockquote>'
            % html.escape(quote)
        )
    elif item.get("note"):
        parts.append('    <p class="ch-press__note">%s</p>' % html.escape(item["note"]))
    parts.append("  </div>")
    parts.append("</article>")
    return parts


def video_card(v):
    """A video as a still with a play button, not an iframe.

    Pressing play is what inserts the player -- see js/press-video.js. Until
    then nothing is requested from YouTube at all: the thumbnail is ours, and
    the embed uses youtube-nocookie.com when it does load. cookies.html tells
    readers that other companies' cookies apply once they arrive at those
    sites, and an iframe sitting on the page from the start would quietly make
    that untrue.
    """
    title = html.escape(v["title"])
    source = html.escape(v["source"])
    return [
        '<article class="ch-vid">',
        '  <button class="ch-vid__play" type="button" data-video="%s"' % html.escape(v["id"], quote=True),
        '          aria-label="Play &ldquo;%s&rdquo; (%s) \u2014 opens the YouTube player">' % (title, source),
        '    <img src="%s" srcset="%s" sizes="(max-width: 767px) 92vw, 22rem"'
        % (asset(v["thumb"]["src"]), html.escape(v["thumb"]["srcset"], quote=True)),
        '         loading="lazy" decoding="async" alt="">',
        '    <span class="ch-vid__icon" aria-hidden="true">'
        '<svg viewBox="0 0 68 48" width="100%" height="100%">'
        '<path class="ch-vid__icon-bg" d="M66.5 7.7c-.8-2.9-2.5-5.4-5.4-6.2C55.8 0 34 0 34 0S12.2 0 6.9 1.4C4 2.2 2.3 4.8 1.5 7.7 0 13 0 24 0 24s0 11 1.5 16.3c.8 2.9 2.5 5.4 5.4 6.2C12.2 48 34 48 34 48s21.8 0 27.1-1.5c2.9-.8 4.6-3.3 5.4-6.2C68 35 68 24 68 24s0-11-1.5-16.3z"></path>'
        '<path d="M45 24 27 14v20" fill="#fff"></path></svg></span>',
        "  </button>",
        '  <p class="ch-vid__meta"><span class="ch-vid__title">%s</span>' % title,
        '    <span class="ch-vid__source">%s%s</span></p>'
        % (source, "" if v.get("duration", "\u2014") == "\u2014" else " &middot; " + html.escape(v["duration"])),
        '  <a class="ch-vid__link" href="%s" target="_blank" rel="noopener">Watch on YouTube</a>'
        % html.escape(v["url"], quote=True),
        "</article>",
    ]


def render_screen(section, indent):
    videos = section.get("screen") or []
    if not videos:
        return None
    lines = ['<div class="ch-vid-wrap">', '  <ul class="ch-vid-grid">']
    for v in videos:
        lines.append("    <li>")
        lines.extend("      " + line for line in video_card(v))
        lines.append("    </li>")
    lines.append("  </ul>")
    lines.append(
        '  <p class="ch-vid__note">Nothing is requested from YouTube until you '
        "press play.</p>"
    )
    lines.append("</div>")
    body = ("\n" + indent).join(lines)
    return "\n%s%s\n%s" % (indent, body, indent)


def render(section, indent):
    items = section.get("items") or []
    if not items:
        return None

    lines = ['<div class="ch-press">', '  <ul class="ch-press__grid">']
    for item in items:
        lines.append("    <li>")
        lines.extend("      " + line for line in card(item))
        lines.append("    </li>")
    lines.append("  </ul>")
    lines.append(
        '  <p class="ch-press__foot">Each extract is quoted from the article it '
        "names and links to, so it can be read in full at the source.</p>"
    )
    lines.append("</div>")
    body = ("\n" + indent).join(lines)
    return "\n%s%s\n%s" % (indent, body, indent)


def main():
    check = "--check" in sys.argv
    data = json.loads(DATA.read_text(encoding="utf-8"))
    sections = data["sections"]
    changed = []
    total = 0

    for page in PAGES:
        if not page.exists():
            sys.exit("missing page: %s" % page)
        text = page.read_text(encoding="utf-8")
        seen = []

        def replace(match):
            name = match.group(2)
            if name not in sections:
                sys.exit("%s: unknown press section '%s'" % (page.name, name))
            body = render(sections[name], marker_indent(match))
            if body is None:
                seen.append((name, 0, "tiles"))
                return match.group(0)
            seen.append((name, len(sections[name]["items"]), "tiles"))
            return match.group(1) + body + match.group(4)

        def replace_screen(match):
            name = match.group(2)
            if name not in sections:
                sys.exit("%s: unknown press section '%s'" % (page.name, name))
            body = render_screen(sections[name], marker_indent(match))
            if body is None:
                return match.group(0)
            seen.append((name, len(sections[name]["screen"]), "screen"))
            return match.group(1) + body + match.group(4)

        updated = BLOCK_RE.sub(replace, text)
        updated = SCREEN_RE.sub(replace_screen, updated)
        if not seen:
            sys.exit("%s: no ch:press markers found" % page.name)

        for name, count, kind in seen:
            if kind == "screen":
                state = "%d videos" % count
            elif not count:
                state = "skipped (no items yet)"
            else:
                quoted = sum(1 for i in sections[name].get("items", []) if i.get("quote"))
                state = "%d tiles, %d quoted" % (count, quoted)
            print("  %-18s %-8s %s" % (page.name, name, state))
            total += count

        if updated != text:
            changed.append(page.relative_to(ROOT))
            if not check:
                page.write_text(updated, encoding="utf-8")

    print()
    if not changed:
        print("All press pages are up to date (%d tiles rendered)." % total)
        return
    if check:
        print("Out of date:")
        for c in changed:
            print("  %s" % c)
        sys.exit(1)
    print("Updated:")
    for c in changed:
        print("  %s" % c)


if __name__ == "__main__":
    main()
