#!/usr/bin/env python3
"""Put the guest album on the creator page, from the reviews page's copy.

The album of familiar faces lives on reviews.html, which is where it is
edited. The creator page shows the same twelve-or-so prints, so rather than
keep a second copy that drifts, this lifts the list out of reviews.html and
writes it between the ch:guests markers wherever they appear.

Both pages sit in public/, so the image paths inside the album need no
rewriting.

    python scripts/update-guests.py           # write
    python scripts/update-guests.py --check   # fail if anything is stale

The --check form is the one to run in CI: it writes nothing and exits
non-zero if a page no longer matches the source.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "reviews.html"
PAGES = [ROOT / "public" / "influencers.html"]

ALBUM_RE = re.compile(r'<ul class="ch-album">.*?</ul>', re.S)
BLOCK_RE = re.compile(r"(<!-- ch:guests -->)(.*?)(<!-- /ch:guests -->)", re.S)


def marker_indent(text, at):
    """The spaces before the opening marker, so the block lands in line."""
    line_start = text.rfind("\n", 0, at) + 1
    return re.match(r"[ \t]*", text[line_start:at]).group(0)


def album():
    text = SOURCE.read_text(encoding="utf-8")
    found = ALBUM_RE.search(text)
    if not found:
        sys.exit("%s: no <ul class=\"ch-album\"> to copy" % SOURCE.name)
    prints = found.group(0).count('class="ch-album__print"')
    if not prints:
        sys.exit("%s: the album has no prints in it" % SOURCE.name)
    return found.group(0), prints


def main():
    check = "--check" in sys.argv
    source, prints = album()
    stale = []

    for page in PAGES:
        if not page.exists():
            sys.exit("missing page: %s" % page)
        text = page.read_text(encoding="utf-8")
        if not BLOCK_RE.search(text):
            sys.exit("%s: no ch:guests markers found" % page.name)

        def replace(match):
            nl = "\r\n" if "\r\n" in text else "\n"
            pad = marker_indent(text, match.start())
            body = nl.join(pad + line for line in source.split("\n"))
            return match.group(1) + nl + body + nl + pad + match.group(3)

        updated = BLOCK_RE.sub(replace, text)
        if updated != text:
            stale.append(page.name)
            if not check:
                page.write_text(updated, encoding="utf-8")
        print("  %-22s %d prints" % (page.name, prints))

    if check and stale:
        sys.exit("\nout of date, run scripts/update-guests.py: %s" % ", ".join(stale))
    print("\n%s (%d prints from %s)" %
          ("Would rewrite: " + ", ".join(stale) if (check and stale)
           else "All guest albums are up to date.", prints, SOURCE.name))


if __name__ == "__main__":
    main()
