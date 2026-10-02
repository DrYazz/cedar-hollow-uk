#!/usr/bin/env python3
"""Check that every old theoaks.uk address forwards correctly.

theoaks-redirect/index.js answers the old Wix domain with one permanent
redirect per page, to that page's equivalent on cedarhollow.uk. This reads the
map out of that file and fetches every address in it, on both hosts and over
both http and https, checking that each answers 301 straight to the expected
URL -- and that the page there answers 200 itself rather than redirecting
again, since a chain is what the Worker exists to avoid.

It also checks what the Worker serves itself: a robots.txt that blocks
nothing, and Wix's three sitemap files, listing the old addresses. And the
edges: an unknown path, a capitalised one with a trailing slash, and a query
string, which must survive the trip.

Usage:
    python scripts/check-theoaks-redirects.py               # the live domain
    python scripts/check-theoaks-redirects.py --base URL    # one origin only

--base is for trying the Worker before the domain is attached to it: the
address `npx wrangler dev` prints, or its workers.dev address. The Worker
never looks at the host name, so one origin exercises all of it.

Exits non-zero if anything fails.
"""
import argparse
import concurrent.futures
import http.client
import json
import os
import re
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(ROOT, "theoaks-redirect", "index.js")
LIVE = ["https://www.theoaks.uk", "https://theoaks.uk", "http://www.theoaks.uk", "http://theoaks.uk"]
UA = "Mozilla/5.0 (compatible; Cedar Hollow redirect check)"


def read_worker():
    src = open(WORKER, encoding="utf-8").read()

    def const(name):
        return re.search(r'const %s = "([^"]+)"' % name, src).group(1)

    mapping = json.loads(re.search(r"const MAP = (\{.*?\n\});", src, re.S).group(1))
    return mapping, const("NEW_SITE"), const("OLD_SITE"), const("FALLBACK")


def fetch(url):
    """One GET, redirects not followed: (status, Location, body)."""
    u = urllib.parse.urlsplit(url)
    conn = (http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection)(u.netloc, timeout=30)
    try:
        conn.request("GET", (u.path or "/") + ("?" + u.query if u.query else ""), headers={"User-Agent": UA})
        r = conn.getresponse()
        return r.status, r.getheader("Location"), r.read().decode("utf-8", "replace")
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", help="check this one origin instead of the live domain")
    args = ap.parse_args()

    mapping, new_site, old_site, fallback = read_worker()
    origins = [args.base.rstrip("/")] if args.base else LIVE

    def to(target, query=""):
        page, _, fragment = target.partition("#")
        return new_site + page + query + ("#" + fragment if fragment else "")

    redirects = []  # (url, where it should send you)
    for origin in origins:
        redirects += [(origin + path, to(target)) for path, target in mapping.items()]
        redirects += [
            (origin + "/Facilities/", to(mapping["/facilities"])),
            (origin + "/makeamemory?utm_source=newsletter&utm_medium=email",
             to(mapping["/makeamemory"], "?utm_source=newsletter&utm_medium=email")),
            (origin + "/?fbclid=abc123", to(mapping["/"], "?fbclid=abc123")),
            (origin + "/blank-page-that-never-existed", to(fallback)),
        ]
    targets = sorted({t.partition("#")[0] for t in mapping.values()} | {fallback})

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        got = dict(zip([u for u, _ in redirects], pool.map(lambda r: fetch(r[0]), redirects)))
        live = dict(zip(targets, pool.map(lambda t: fetch(new_site + t), targets)))
        served = {(o, f): fetch(o + f) for o in origins
                  for f in ("/robots.txt", "/sitemap.xml", "/pages-sitemap.xml", "/store-products-sitemap.xml")}

    failures = []
    for url, want in redirects:
        status, location, _ = got[url]
        if status != 301 or location != want:
            hint = ""
            if location and url.startswith("http://") and location.startswith("https://" + urllib.parse.urlsplit(url).netloc):
                hint = "  <- an http-to-https hop first: turn off Always Use HTTPS for theoaks.uk"
            failures.append("%s\n    got  %s %s\n    want 301 %s%s" % (url, status, location, want, hint))

    for page, (status, location, _) in live.items():
        if status != 200:
            failures.append("%s%s answers %s %s -- a redirect target must be a final page"
                            % (new_site, page, status, location or ""))

    pages = {old_site + p for p in mapping if not p.startswith("/product-page/")}
    products = {old_site + p for p in mapping if p.startswith("/product-page/")}
    for origin in origins:
        status, _, body = served[origin, "/robots.txt"]
        if status != 200 or re.search(r"(?mi)^disallow:\s*\S", body) or "Sitemap: %s/sitemap.xml" % old_site not in body:
            failures.append("%s/robots.txt: %s, must allow everything and name the sitemap" % (origin, status))
        for name, want in (("/sitemap.xml", {old_site + "/pages-sitemap.xml", old_site + "/store-products-sitemap.xml"}),
                           ("/pages-sitemap.xml", pages),
                           ("/store-products-sitemap.xml", products)):
            status, _, body = served[origin, name]
            locs = set(re.findall(r"<loc>([^<]+)</loc>", body))
            if status != 200 or locs != want:
                failures.append("%s%s: %s, %d of %d addresses, %d unexpected"
                                % (origin, name, status, len(locs & want), len(want), len(locs - want)))

    for f in failures:
        print("FAIL " + f)
    print("%s: %d redirects across %d origin%s, %d target pages, robots.txt and 3 sitemaps per origin"
          % ("FAILED" if failures else "OK", len(redirects), len(origins), "" if len(origins) == 1 else "s", len(targets)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
