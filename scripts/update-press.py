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

# The name is a whole word after a space, so a sibling marker such as
# ch:press-filter is not read as this block with the name "-filter" and
# then closed against the articles grid's end marker further down.
BLOCK_RE = re.compile(r"(<!-- ch:press(?: ([\w-]+))? -->)(.*?)(<!-- /ch:press -->)", re.S)
SCREEN_RE = re.compile(r"(<!-- ch:press-screen ?([\w-]*) -->)(.*?)(<!-- /ch:press-screen -->)", re.S)
FEED_RE = re.compile(r"(<!-- ch:press-feed ?([\w-]*) -->)(.*?)(<!-- /ch:press-feed -->)", re.S)
FILTER_RE = re.compile(r"(<!-- ch:press-filter(?: ([\w-]+))? -->)(.*?)(<!-- /ch:press-filter -->)", re.S)
AWARDS_RE = re.compile(r"(<!-- ch:press-awards(?: ([\w-]+))? -->)(.*?)(<!-- /ch:press-awards -->)", re.S)

LOCATIONS = {"oxford": "Oxfordshire", "dorset": "Dorset"}

# Awards are grouped under the name they were won under. Several of the
# Dorset ones predate the rebranding, and RIBA and VisitEngland gave them to
# the retreat as it was then, so the old name is kept beside the new one
# rather than quietly replaced.
AWARD_GROUPS = {
    "oxford": ("Cedar Hollow Oxford", "formerly Cedar Hollow @ The Oaks"),
    "dorset": ("Cedar Hollow Dorset",
               "formerly Mallinson%ss Woodland Retreat" % chr(0x2019)),
}


def both(sections, key):
    """Every entry from every woodland, for the combined page.

    "counts" is what the woodland filter shows on its buttons: articles and
    films together, since one choice narrows both sections at once.
    """
    out = []
    counts = {"all": 0}
    for sec in sections.values():
        out.extend(sec.get(key) or [])
        entries = ((sec.get("items") or []) + (sec.get("screen") or [])
                   + (sec.get("awards") or []))
        for entry in entries:
            where = entry.get("location")
            counts["all"] += 1
            counts[where] = counts.get(where, 0) + 1
    return {key: out, "counts": counts}


def marker_indent(match):
    line_start = match.string.rfind("\n", 0, match.start()) + 1
    indent = match.string[line_start : match.start()]
    return "" if indent.strip() else indent


def asset(path):
    """Fail loudly on a missing file rather than shipping a broken image."""
    # A cache-busting ?v= stamp is part of the URL, not part of the filename.
    bare = path.split("?", 1)[0]
    if not (ROOT / "public" / bare).exists():
        sys.exit("press-data.json: no such file: public/%s" % bare)
    return html.escape(path, quote=True)


def card(item, show_location=False):
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

    # The year the piece ran, under the masthead: a reader should be able to
    # tell a 2018 cutting from a 2026 one without opening it.
    where = LOCATIONS.get(item.get("location"), "")
    parts.append(
        '    <p class="ch-press__year">%s%s</p>'
        % (html.escape(item["date"][:4]),
           " &middot; " + where if (show_location and where) else "")
    )

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

    Two shapes: most are a button that swaps in the player, and the ones
    whose owner has blocked off-site playback ("embed": false) are a link
    straight to YouTube.

    Pressing play is what inserts the player -- see js/press-video.js. Until
    then nothing is requested from YouTube at all: the thumbnail is ours, and
    the embed uses youtube-nocookie.com when it does load. cookies.html tells
    readers that other companies' cookies apply once they arrive at those
    sites, and an iframe sitting on the page from the start would quietly make
    that untrue.
    """
    title = html.escape(v["title"])
    source = html.escape(v["source"])
    url = html.escape(v["url"], quote=True)

    # "embed": false means the owner has disallowed off-site playback, so an
    # iframe here renders YouTube's "This video is unavailable" panel instead
    # of the film. Those entries keep the still and the play badge but are a
    # link straight to YouTube: a tile that goes somewhere beats one that
    # fails. Confirmed in a browser, not from the API, which reports
    # playableInEmbed true for both of them.
    if v.get("embed") is False:
        opener = [
            '  <a class="ch-vid__play is-offsite" href="%s" target="_blank" rel="noopener"' % url,
            '     aria-label="Watch &ldquo;%s&rdquo; (%s) on YouTube, which is the only place it can be played">' % (title, source),
        ]
        closer = "  </a>"
    else:
        opener = [
            '  <button class="ch-vid__play" type="button" data-video="%s"' % html.escape(v["id"], quote=True),
            '          aria-label="Play &ldquo;%s&rdquo; (%s) in the YouTube player">' % (title, source),
        ]
        closer = "  </button>"

    # The masthead carries the source where we have its logo, and the text
    # name where we do not. "detail" is for what the name alone does not say,
    # such as which episode. Running time is deliberately not shown.
    marks = v.get("logo") or []
    if marks:
        # One tile can carry more than one mark, such as the broadcaster
        # beside the programme. Each is announced separately.
        spans = []
        for mark in marks:
            src = asset(mark["src"])
            spans.append(
                '<span class="ch-vid__logo" role="img" aria-label="%s" '
                "style=\"--ch-logo-ar:%s;-webkit-mask-image:url('%s');mask-image:url('%s')\"></span>"
                % (html.escape(mark["label"]), mark["ar"], src, src)
            )
        source_line = ('    <span class="ch-vid__logos">%s</span>'
                       % "".join(spans))
    else:
        source_line = '    <span class="ch-vid__source">%s</span>' % source
    if v.get("detail"):
        # what the name alone does not say, such as which episode
        source_line += ('<span class="ch-vid__detail">%s</span>'
                        % html.escape(v["detail"]))
    year = video_year(v)
    if year:
        source_line += '<span class="ch-vid__year">%s</span>' % html.escape(year)
    source_line += "</p>"

    # The tile takes the film's own shape. ratio comes from the video's
    # largest stream, not from the thumbnail: YouTube pads a Short's
    # thumbnail out to 16:9 with a blurred copy of itself, so the still
    # lies about the shape and the stream does not.
    ratio = v.get("ratio") or "16/9"
    rw, rh = (int(x) for x in ratio.split("/"))
    portrait = " is-portrait" if rh > rw else ""

    return [
        '<article class="ch-vid%s" style="--ch-vid-ar:%s">' % (portrait, ratio),
        *opener,
        '    <img src="%s" srcset="%s" sizes="(max-width: 767px) 92vw, 22rem"'
        % (asset(v["thumb"]["src"]), html.escape(v["thumb"]["srcset"], quote=True)),
        '         loading="lazy" decoding="async" alt="">',
        '    <span class="ch-vid__icon" aria-hidden="true">'
        '<svg viewBox="0 0 68 48" width="100%" height="100%">'
        '<path class="ch-vid__icon-bg" d="M66.5 7.7c-.8-2.9-2.5-5.4-5.4-6.2C55.8 0 34 0 34 0S12.2 0 6.9 1.4C4 2.2 2.3 4.8 1.5 7.7 0 13 0 24 0 24s0 11 1.5 16.3c.8 2.9 2.5 5.4 5.4 6.2C12.2 48 34 48 34 48s21.8 0 27.1-1.5c2.9-.8 4.6-3.3 5.4-6.2C68 35 68 24 68 24s0-11-1.5-16.3z"></path>'
        '<path d="M45 24 27 14v20" fill="#fff"></path></svg></span>',
        closer,
        '  <p class="ch-vid__meta"><span class="ch-vid__title">%s</span>' % title,
        source_line,
        '  <a class="ch-vid__link" href="%s" target="_blank" rel="noopener">Watch on YouTube</a>'
        % html.escape(v["url"], quote=True),
        "</article>",
    ]


def render_screen(section, indent):
    videos = section.get("screen") or []
    if not videos:
        return None
    # Newest first by broadcast year, to read the same way as the clippings.
    videos = sorted(videos, key=video_year, reverse=True)
    # Split by shape. A landscape tile beside a portrait one leaves the
    # shorter of the two stranded at the top of a tall row, so each shape
    # gets its own grid and its own column count.
    def is_portrait(v):
        rw, rh = (int(x) for x in (v.get("ratio") or "16/9").split("/"))
        return rh > rw

    groups = [
        ("is-landscapes", [v for v in videos if not is_portrait(v)]),
        ("is-portraits", [v for v in videos if is_portrait(v)]),
    ]
    lines = ['<div class="ch-vid-wrap">']
    for cls, group in groups:
        if not group:
            continue
        lines.append('  <ul class="ch-vid-grid %s">' % cls)
        for v in group:
            lines.append('    <li data-location="%s">' % html.escape(v.get("location","")))
            lines.extend("      " + line for line in video_card(v))
            lines.append("    </li>")
        lines.append("  </ul>")
    lines.append("</div>")
    body = ("\n" + indent).join(lines)
    return "\n%s%s\n%s" % (indent, body, indent)


def video_year(v):
    """The year the programme went out, not the day we uploaded the clip.

    Every entry's "date" is dateKind "uploaded", which for the older
    programmes is long after broadcast: the Amazing Spaces film aired in
    2016 and went on the channel in 2026. Where the two differ, "aired"
    carries the broadcast year and wins.
    """
    return (v.get("aired") or v.get("date", ""))[:4]


def kind_counts(sections):
    """What the kind buttons count: articles, films and recognitions."""
    counts = {}
    for key, field in (("press", "items"), ("screen", "screen"),
                       ("awards", "awards")):
        counts[key] = sum(len(sec.get(field) or []) for sec in sections.values())
    counts["all"] = sum(counts.values())
    return counts


def filter_btn(group, value, label, count, on):
    return ('    <button class="ch-feed__btn" type="button" data-group="%s" '
            'data-filter="%s" aria-pressed="%s">%s '
            '<span class="ch-feed__count">%d</span></button>'
            % (group, value, "true" if on else "false", label, count))


def filters(sections, indent, scope=None):
    """The controls above the coverage: which woodland, and which kind.

    They sit above both sections rather than inside either. The woodland
    control narrows the grids, so its counts are articles and films together;
    the kind control hides a whole section, which is why neither can live
    inside one.

    A named marker scopes the bar to one woodland, and the woodland control
    is then left out: that page has already settled which woodland, so only
    the kind control has anything left to ask.

    Rendered server-side and complete: with JavaScript off the buttons do
    nothing and every entry stays on the page, which is the sensible
    fallback for a filter.
    """
    kinds = ("kind", "Type",
             (("all", "All"), ("press", "Press"), ("screen", "TV"),
              ("awards", "Awards")))
    if scope:
        groups = [(kinds, kind_counts({scope: sections[scope]}))]
    else:
        groups = [
            (("location", "Location",
              (("all", "All"), ("oxford", "Oxford"), ("dorset", "Dorset"))),
             both(sections, "items")["counts"]),
            (kinds, kind_counts(sections)),
        ]
    lines = ['<div class="ch-press__filters">']
    for (group, label, options), counts in groups:
        # The group is named on the page rather than only to a screen
        # reader, so the buttons can be a word each: four long ones wrapped
        # into a wall on a phone.
        lines.append('  <div class="ch-press__filter" role="group" '
                     'aria-labelledby="ch-filter-%s">' % group)
        lines.append('    <span class="ch-press__filter-label" '
                     'id="ch-filter-%s">%s:</span>' % (group, label))
        for key, text in options:
            lines.append(filter_btn(group, key, text, counts.get(key, 0), key == "all"))
        lines.append("  </div>")
    lines.append("</div>")
    body = ("\n" + indent).join(lines)
    return "\n%s%s\n%s" % (indent, body, indent)


def award_card(a):
    """One recognition: the mark on top, what it was for underneath.

    Shaped like the clippings above it -- picture, then words, and no frame
    around either -- so the page reads as one list in three parts rather
    than three designs. The band for the mark is there whether or not we
    hold one, so the words start on the same line across a row.
    """
    parts = ['<article class="ch-awards__item">']
    if a.get("logo"):
        # The badge says the same thing as the words under it, so it is
        # decorative: an empty alt keeps it from being read out twice.
        parts.append('  <p class="ch-awards__badge"><img src="%s" alt="" '
                     'loading="lazy" decoding="async"></p>' % asset(a["logo"]))
    else:
        parts.append('  <p class="ch-awards__badge"></p>')
    parts.append('  <div class="ch-awards__body">')
    parts.append('    <p class="ch-awards__kind">%s</p>' % html.escape(a["kind"]))
    parts.append('    <h4 class="ch-awards__org">%s</h4>' % html.escape(a["org"]))
    parts.append('    <p class="ch-awards__name">%s</p>' % html.escape(a["award"]))
    line = " &middot; ".join(html.escape(bit) for bit in
                             (a.get("distinction"), a.get("year")) if bit)
    if line:
        parts.append('    <p class="ch-awards__distinction">%s</p>' % line)
    for key in ("description", "category"):
        if a.get(key):
            parts.append('    <p class="ch-awards__note">%s</p>' % html.escape(a[key]))
    parts.append('    <p class="ch-awards__recipient">%s</p>'
                 % html.escape(a["recipient"]))
    # The architecture awards were given to a building, so they name who
    # designed it, the way the awarding body does.
    if a.get("architect"):
        parts.append('    <p class="ch-awards__architect">Architect: %s</p>'
                     % html.escape(a["architect"]))
    # One award covering three treehouses is rated separately for each, so
    # the entry carries a link per accommodation rather than one for all.
    if a.get("links"):
        anchors = ['<a href="%s" target="_blank" rel="noopener">%s</a>'
                   % (html.escape(link["url"], quote=True), html.escape(link["label"]))
                   for link in a["links"]]
        parts.append('    <p class="ch-awards__source">Sources: %s</p>'
                     % ", ".join(anchors))
    elif a.get("url"):
        parts.append('    <p class="ch-awards__source"><a href="%s" target="_blank" '
                     'rel="noopener">Source</a></p>' % html.escape(a["url"], quote=True))
    parts.append('  </div>')
    parts.append('</article>')
    return parts


def render_awards(sections, indent, scope=None):
    """The recognition cards, grouped by woodland, newest first.

    Undated entries -- the quality ratings and the sustainability
    certification, which are held rather than won in a given year -- fall to
    the end of their group rather than being given a year they do not have.

    The group wrapper carries data-location alongside its cards, so the
    woodland filter takes the heading away with them and never leaves one
    standing over nothing.
    """
    names = [scope] if scope else [k for k in AWARD_GROUPS if k in sections]
    lines = ['<div class="ch-awards">']
    for name in names:
        awards = sections[name].get("awards") or []
        if not awards:
            continue
        title, formerly = AWARD_GROUPS[name]
        lines.append('  <div class="ch-awards__group" data-location="%s">' % name)
        lines.append('    <h3 class="ch-awards__title">%s '
                     '<span class="ch-awards__formerly">&middot; %s</span></h3>'
                     % (html.escape(title), html.escape(formerly)))
        lines.append('    <ul class="ch-awards__grid">')
        for a in sorted(awards, key=lambda x: x.get("year") or "", reverse=True):
            lines.append('      <li data-location="%s">'
                         % html.escape(a.get("location", name)))
            lines.extend("        " + one for one in award_card(a))
            lines.append('      </li>')
        lines.append('    </ul>')
        lines.append('  </div>')
    if len(lines) == 1:
        return None
    lines.append('</div>')
    body = ("\n" + indent).join(lines)
    return "\n%s%s\n%s" % (indent, body, indent)

def render(section, indent, show_location=False):
    items = section.get("items") or []
    # Newest first. The data file keeps them in the order they were added;
    # the page decides how they read.
    items = sorted(items, key=lambda it: it["date"], reverse=True)
    if not items:
        return None

    lines = ['<div class="ch-press">']
    lines.append('  <ul class="ch-press__grid">')
    for item in items:
        # data-location is what js/press-filter.js narrows on
        lines.append('    <li data-location="%s">' % html.escape(item.get("location","")))
        lines.extend("      " + line for line in card(item, show_location))
        lines.append("    </li>")
    lines.append("  </ul>")
    lines.append("</div>")
    body = ("\n" + indent).join(lines)
    return "\n%s%s\n%s" % (indent, body, indent)


def month_year(iso):
    months = ("January", "February", "March", "April", "May", "June", "July",
              "August", "September", "October", "November", "December")
    y, m, _ = iso.split("-")
    return "%s %s" % (months[int(m) - 1], y)


def feed_entries(sections, scope=None):
    """Everything, newest first, articles and film together.

    `scope` limits it to one woodland, which is what the location pages want:
    there the woodland is a given and only the kind of coverage is worth
    filtering on.
    """
    rows = []
    for key, sec in sections.items():
        if scope and key != scope:
            continue
        for item in sec.get("items", []):
            rows.append((item["date"], key, "article", item))
        for v in sec.get("screen", []):
            rows.append((v["date"], key, "video", v))
    rows.sort(key=lambda r: (r[0], r[3].get("publication") or r[3].get("source")), reverse=True)
    return rows


def feed_card(kind, item, location):
    """One entry in the feed, tagged so the filters can hide it."""
    stamp = ' data-location="%s" data-kind="%s"' % (location, kind)
    date = item.get("date", "")
    label = "Added" if item.get("dateKind") == "uploaded" else ""
    when = ('<span class="ch-feed__date">%s%s</span>'
            % (label + " " if label else "", month_year(date))) if date else ""

    lines = ['<li class="ch-feed__item"%s>' % stamp]
    lines.extend("  " + l for l in (card(item) if kind == "article" else video_card(item)))
    if when:
        lines.append('  <p class="ch-feed__meta">%s <span class="ch-feed__where">%s</span></p>'
                     % (when, LOCATIONS.get(location, location)))
    lines.append("</li>")
    return lines


def filter_group(name, label, options, counts):
    lines = ['<div class="ch-feed__filter" role="group" aria-label="%s">' % label]
    for value, text in options:
        pressed = "true" if value == options[0][0] else "false"
        lines.append('  <button class="ch-feed__btn" type="button" data-group="%s" '
                     'data-filter="%s" aria-pressed="%s">%s '
                     '<span class="ch-feed__count">%d</span></button>'
                     % (name, value, pressed, text, counts.get(value, 0)))
    lines.append("</div>")
    return lines


def render_feed(sections, indent, scope=None):
    rows = feed_entries(sections, scope)
    if not rows:
        return None

    where = {"all": len(rows)}
    kinds = {"any": len(rows)}
    for _, key, kind, _ in rows:
        where[key] = where.get(key, 0) + 1
        kinds[kind] = kinds.get(kind, 0) + 1

    lines = ['<div class="ch-feed">', '  <div class="ch-feed__filters">']
    # Only the combined page needs the woodland row; on a location page that
    # question is already answered by which page you are on.
    if not scope:
        lines.extend("    " + l for l in filter_group(
            "location", "Filter by woodland",
            [("all", "All"), ("oxford", "Oxfordshire"), ("dorset", "Dorset")], where))
    lines.extend("    " + l for l in filter_group(
        "kind", "Filter by kind of coverage",
        [("any", "Everything"), ("article", "In words"), ("video", "On screen")], kinds))
    lines.append("  </div>")
    lines.append('  <p class="ch-feed__status" role="status" aria-live="polite">Showing all %d</p>' % len(rows))
    lines.append('  <ul class="ch-feed__grid">')
    for _, key, kind, item in rows:
        lines.extend("    " + l for l in feed_card(kind, item, key))
    lines.append("  </ul>")
    lines.append('  <p class="ch-feed__empty" hidden>Nothing matches both filters.</p>')
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
            # no name means the combined page: both woodlands in one grid,
            # so each card names its woodland beside the year
            if name:
                if name not in sections:
                    sys.exit("%s: unknown press section '%s'" % (page.name, name))
                section, both_woodlands = sections[name], False
            else:
                section, both_woodlands = both(sections, "items"), True
            body = render(section, marker_indent(match), both_woodlands)
            label = name or "combined"
            if body is None:
                seen.append((label, 0, "tiles"))
                return match.group(0)
            seen.append((label, len(section["items"]), "tiles"))
            return match.group(1) + body + match.group(4)

        def replace_screen(match):
            name = match.group(2)
            if name:
                if name not in sections:
                    sys.exit("%s: unknown press section '%s'" % (page.name, name))
                section = sections[name]
            else:
                section = both(sections, "screen")
            body = render_screen(section, marker_indent(match))
            if body is None:
                return match.group(0)
            seen.append((name or "combined", len(section["screen"]), "screen"))
            return match.group(1) + body + match.group(4)

        def replace_feed(match):
            scope = match.group(2) or None
            if scope and scope not in sections:
                sys.exit("%s: unknown feed scope '%s'" % (page.name, scope))
            body = render_feed(sections, marker_indent(match), scope)
            if body is None:
                return match.group(0)
            seen.append((scope or "combined", len(feed_entries(sections, scope)), "feed"))
            return match.group(1) + body + match.group(4)

        def replace_filter(match):
            scope = match.group(2)
            if scope and scope not in sections:
                sys.exit("%s: unknown filter scope '%s'" % (page.name, scope))
            seen.append((scope or "combined", 0, "filter"))
            body = filters(sections, marker_indent(match), scope)
            return match.group(1) + body + match.group(4)

        updated = FILTER_RE.sub(replace_filter, text)
        updated = BLOCK_RE.sub(replace, updated)
        def replace_awards(match):
            scope = match.group(2)
            if scope and scope not in sections:
                sys.exit("%s: unknown awards scope '%s'" % (page.name, scope))
            body = render_awards(sections, marker_indent(match), scope)
            if body is None:
                return match.group(0)
            names = [scope] if scope else list(sections)
            seen.append((scope or "combined",
                         sum(len(sections[n].get("awards") or []) for n in names),
                         "awards"))
            return match.group(1) + body + match.group(4)

        updated = SCREEN_RE.sub(replace_screen, updated)
        updated = AWARDS_RE.sub(replace_awards, updated)
        updated = FEED_RE.sub(replace_feed, updated)
        if not seen:
            sys.exit("%s: no ch:press markers found" % page.name)

        for name, count, kind in seen:
            if kind == "filter":
                state = ("woodland and kind filters" if name == "combined"
                         else "kind filter")
            elif kind == "feed":
                state = "%d entries, newest first" % count
            elif kind == "screen":
                state = "%d videos" % count
            elif kind == "awards":
                state = "%d awards" % count
            elif not count:
                state = "skipped (no items yet)"
            else:
                pool = (
                    both(sections, "items")["items"] if name == "combined"
                    else sections[name].get("items", [])
                )
                quoted = sum(1 for i in pool if i.get("quote"))
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
