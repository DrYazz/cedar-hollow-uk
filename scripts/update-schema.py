#!/usr/bin/env python3
"""Write schema.org structured data into the pages that sell a stay.

Twenty-six Oxford sub-pages already carried a LodgingBusiness block, but the
pages a search engine most needs to understand -- the homepage, the two
woodland pages, the two stays pages and the three Dorset treehouses -- carried
none. This writes it, between <!-- ch:schema --> markers in each page's head.

Everything here is read from somewhere the page already shows it:

  * each stay's name, description, sleeps, bedrooms, bathrooms, beds and
    "from" price come from public/js/listings.js, the same catalogue the stays
    pages render, so a price changed there changes here on the next run;
  * addresses, email and profiles are the ones in each page's footer;
  * every URL is the target page's own rel="canonical", read from the page.

Nothing is invented. There is no geo block, because no coordinates are
published anywhere on the site, and a pin placed by guesswork is worse than
an address Google can geocode itself. There is no telephone for Dorset,
because none appears on the Dorset pages.

There is deliberately no AggregateRating. The ratings are gathered on Google,
Tripadvisor and Airbnb, and Google's structured-data policy does not allow a
site to mark up reviews collected by other platforms as its own. See the same
note at the top of public/js/reviews-live.js.

Usage:
    python scripts/update-schema.py            # write it
    python scripts/update-schema.py --check    # fail if any page is stale
"""
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
HOST = "https://cedarhollow.uk"

ORG_ID = HOST + "/#organization"
SITE_ID = HOST + "/#website"
# The Oxford id is the one the twenty-six sub-pages already use, so the new
# blocks and the old ones describe a single business rather than two.
BIZ_ID = {"Oxford": HOST + "/oxford/#business", "Dorset": HOST + "/dorset/#business"}

START, END = "<!-- ch:schema -->", "<!-- /ch:schema -->"

BUSINESS = {
    "Oxford": {
        "name": "Cedar Hollow Oxford",
        "alternateName": ["Cedar Hollow @ The Oaks", "Cedar Hollow at The Oaks",
                          "The Oaks", "Cedar Hollow Treehouse Oxford"],
        "description": ("Three C.S. Lewis-inspired woodland retreats (a treehouse, a "
                        "faun's cave and a beaver's den) in 12 acres of private "
                        "woodland on the edge of Oxford."),
        "page": "oxford.html",
        "telephone": "+44 7488 894589",
        "address": {"streetAddress": "The Oaks, Old Road", "addressLocality": "Oxford",
                    "addressRegion": "Oxfordshire", "postalCode": "OX3 8GH"},
        "sameAs": [
            "https://www.instagram.com/cedarhollowoxford/",
            "https://www.tiktok.com/@cedarhollowoxford",
            "https://www.facebook.com/cedarhollowoxford",
            "https://www.youtube.com/@CedarHollow",
            "https://www.tripadvisor.co.uk/Hotel_Review-g186361-d32973964-Reviews-"
            "Cedar_Hollow_Oxford_The_Oaks-Oxford_Oxfordshire_England.html",
        ],
    },
    "Dorset": {
        "name": "Cedar Hollow Dorset",
        "alternateName": ["Mallinson's Woodland Retreat", "Mallinsons Woodland Retreat"],
        "description": ("Three treehouses in private woodland at Yonder Hill, "
                        "Holditch, on the West Dorset border."),
        "page": "dorset.html",
        "telephone": None,
        "address": {"streetAddress": "Yonder Hill", "addressLocality": "Holditch",
                    "addressRegion": "Dorset", "postalCode": "TA20 4NL"},
        "sameAs": [
            "https://www.instagram.com/mallinsonswoodlandretreat/",
            "https://www.youtube.com/@CedarHollow",
            "https://www.tripadvisor.co.uk/Hotel_Review-g4041688-d5063870-Reviews-"
            "Mallinson_s_Woodland_Retreat-Holditch_Dorset_England.html",
        ],
    },
}

CANON_TAG = re.compile(r'<link[^>]*rel="canonical"[^>]*>', re.I)
HREF = re.compile(r'href="([^"]+)"', re.I)
OG_IMAGE = re.compile(r'<meta[^>]*property="og:image"[^>]*>', re.I)
CONTENT = re.compile(r'content="([^"]+)"', re.I)


# --------------------------------------------------------------------- inputs

def listings():
    """The catalogue, exactly as the stays pages load it."""
    js = ("global.window={};require('./public/js/listings.js');"
          "process.stdout.write(JSON.stringify(window.CedarHollowSearch.listings))")
    out = subprocess.run(["node", "-e", js], cwd=ROOT, capture_output=True,
                         text=True, encoding="utf-8", check=True).stdout
    return json.loads(out)


STARS = {"Five-Star Glamping": 5, "Four-Star Glamping": 4}


def star_gradings():
    """The VisitEngland glamping star gradings, from the awards data.

    Read from docs/press-data.json, where the press pages' awards come from,
    so the structured data and the visible awards cannot disagree. Keyed by
    the award's slug.
    """
    path = os.path.join(ROOT, "docs", "press-data.json")
    data = json.load(io.open(path, encoding="utf-8"))
    out = {}
    for key in ("oxford", "dorset"):
        for a in data["sections"][key].get("awards") or []:
            if a.get("org") == "VisitEngland" and a.get("award") in STARS:
                out[a["slug"]] = a
    return out


# Which stays each grading covers. The recipient line in the awards data is
# prose ("Woodsman's, Dazzle and Pinwheel Treehouses"), so the mapping is
# written out here and checked against that line on every run: if the awards
# data changes, this stops rather than quietly claiming a grading for a stay
# that does not hold it, and a grading that appears in the data without an
# entry here stops it too. "*" is a grading VisitEngland gives the site as a
# whole rather than stay by stay; the word beside it is what the recipient
# line must still say.
RATED = {
    "Oxford": {
        "ve-5star-oxford": {"*": "Cedar Hollow Oxford"},
    },
    "Dorset": {
        "ve-5star-dorset": {"woodsmans-treehouse": "Woodsman",
                            "dazzle-treehouse": "Dazzle",
                            "pinwheel-treehouse": "Pinwheel"},
    },
}


def read(rel):
    return io.open(os.path.join(PUBLIC, rel), encoding="utf-8", newline="").read()


def canonical(rel):
    tag = CANON_TAG.search(read(rel))
    m = HREF.search(tag.group(0)) if tag else None
    if not m:
        sys.exit("%s has no rel=canonical to take its URL from" % rel)
    return m.group(1)


def og_image(rel):
    tag = OG_IMAGE.search(read(rel))
    m = CONTENT.search(tag.group(0)) if tag else None
    return m.group(1) if m else None


def absolute(src):
    return HOST + "/" + src.split("?")[0].lstrip("/")


# ------------------------------------------------------------------ entities

def organization():
    return {
        "@type": "Organization",
        "@id": ORG_ID,
        "name": "Cedar Hollow",
        "url": canonical("index.html"),
        "logo": HOST + "/images/apple-touch-icon.png",
        "email": "hello@cedarhollow.uk",
        "sameAs": ["https://www.youtube.com/@CedarHollow"],
        "subOrganization": [{"@id": BIZ_ID[k]} for k in ("Oxford", "Dorset")],
    }


def website():
    return {
        "@type": "WebSite",
        "@id": SITE_ID,
        "url": canonical("index.html"),
        "name": "Cedar Hollow",
        "inLanguage": "en-GB",
        "publisher": {"@id": ORG_ID},
    }


def stay_url(item):
    if item["destination"] == "Oxford":
        # The Oxford stays share one page; each has its own card and anchor,
        # which is what the existing sub-page blocks already point at.
        return canonical("oxford-stays.html").split("#")[0] + "#property-" + item["id"]
    return canonical("dorset-%s.html" % item["id"])


def stay_id(item):
    url = stay_url(item)
    return url if "#" in url else url + "#accommodation"


def business(dest, stays, ratings):
    b = BUSINESS[dest]
    prices = [s["price"] for s in stays if s.get("price")]
    node = {
        "@type": "LodgingBusiness",
        "@id": BIZ_ID[dest],
        "name": b["name"],
        "alternateName": b["alternateName"],
        "description": b["description"],
        "url": canonical(b["page"]),
        "image": og_image(b["page"]),
        "email": "hello@cedarhollow.uk",
        "address": dict({"@type": "PostalAddress", "addressCountry": "GB"}, **b["address"]),
        "sameAs": b["sameAs"],
        "parentOrganization": {"@id": ORG_ID},
        "containsPlace": [{"@id": stay_id(s)} for s in stays],
    }
    if prices:
        # The same "from" figure the stays cards print, in words a crawler reads.
        node["priceRange"] = "From £%d per night" % min(prices)
    if b["telephone"]:
        node["telephone"] = b["telephone"]

    # VisitEngland's glamping stars are an official quality grading, not a
    # review score, so they are not caught by the rule against marking up
    # other platforms' reviews. A grading goes on as starRating only where
    # every stay in the woodland holds it; schema.org has no starRating for a
    # single Accommodation, so where the stays are graded differently each
    # grading is named as an award with the stays it belongs to, rather than
    # one figure claimed for the whole business.
    awards = []
    for slug, covered in RATED[dest].items():
        rating = ratings.get(slug)
        if not rating:
            sys.exit("%s: no %s in the awards data" % (dest, slug))
        for word in covered.values():
            if word.lower() not in rating["recipient"].lower():
                sys.exit("%s recipient no longer names %r: %s"
                         % (slug, word, rating["recipient"]))
        stars = STARS[rating["award"]]
        stay_names = [s["name"] for s in stays if s["id"] in covered]
        if "*" in covered or len(covered) == len(stays):
            node["starRating"] = {
                "@type": "Rating",
                "ratingValue": str(stars),
                "bestRating": "5",
                "author": {"@type": "Organization", "name": "VisitEngland"},
            }
            awards.append("VisitEngland " + rating["award"])
        else:
            awards.append("VisitEngland %s: %s" % (rating["award"], ", ".join(stay_names)))
    unmapped = [slug for slug, a in ratings.items()
                if a.get("location") == dest.lower() and slug not in RATED[dest]]
    if unmapped:
        sys.exit("%s: gradings with no stays mapped in RATED: %s" % (dest, ", ".join(unmapped)))
    if awards:
        node["award"] = awards
    return node


def accommodation(item):
    photos = [absolute(p["src"]) for p in (item.get("photos") or [])[:6] if p.get("src")]
    image = item.get("image") or {}
    main = absolute(image["src"]) if isinstance(image, dict) and image.get("src") else None
    images = ([main] if main else []) + [p for p in photos if p != main]

    node = {
        "@type": "Accommodation",
        "@id": stay_id(item),
        "name": item["name"],
        "url": stay_url(item),
        "description": item.get("description") or "",
        "accommodationCategory": item.get("type") or "",
        "occupancy": {"@type": "QuantitativeValue", "maxValue": item["sleeps"],
                      "unitCode": "C62"},
        "numberOfBedrooms": item.get("bedrooms"),
        "containedInPlace": {"@id": BIZ_ID[item["destination"]]},
    }
    # Beaver's Den has no bathroom of its own; the shared one is not counted.
    if item.get("bathrooms"):
        node["numberOfBathroomsTotal"] = item["bathrooms"]
    if item.get("beds"):
        node["bed"] = item["beds"]
    if images:
        node["image"] = images
    return {k: v for k, v in node.items() if v not in ("", None)}


# --------------------------------------------------------------------- pages

def graphs(items):
    by = {"Oxford": [i for i in items if i["destination"] == "Oxford"],
          "Dorset": [i for i in items if i["destination"] == "Dorset"]}
    org = organization()
    ratings = star_gradings()

    def woodland(dest):
        return [business(dest, by[dest], ratings)] + [accommodation(i) for i in by[dest]]

    pages = {
        "index.html": [org, website()],
        "oxford.html": woodland("Oxford"),
        "oxford-stays.html": woodland("Oxford"),
        "dorset.html": woodland("Dorset"),
        "dorset-stays.html": woodland("Dorset"),
    }
    # Each Dorset treehouse page describes that one stay, with the business
    # it belongs to so containedInPlace resolves on the page itself.
    for item in by["Dorset"]:
        pages["dorset-%s.html" % item["id"]] = [accommodation(item),
                                                 business("Dorset", by["Dorset"], ratings)]
    return pages


def block(graph, nl):
    body = json.dumps({"@context": "https://schema.org", "@graph": graph},
                      ensure_ascii=False, indent=2)
    # a literal </script> inside the JSON would end the element early
    body = body.replace("</", "<\\/")
    return nl.join([START, '<script type="application/ld+json">', body, "</script>", END])


def apply(rel, graph):
    s = read(rel)
    nl = "\r\n" if "\r\n" in s else "\n"
    new = block(graph, "\n")
    if nl == "\r\n":
        new = new.replace("\n", "\r\n")
    if START in s:
        a = s.index(START)
        b = s.index(END, a) + len(END)
        out = s[:a] + new + s[b:]
    else:
        i = s.lower().index("</head>")
        out = s[:i] + new + nl + s[i:]
    return s, out


def main():
    check = "--check" in sys.argv
    stale = []
    for rel, graph in graphs(listings()).items():
        before, after = apply(rel, graph)
        if before != after:
            stale.append(rel)
            if not check:
                io.open(os.path.join(PUBLIC, rel), "w", encoding="utf-8",
                        newline="").write(after)
        types = ", ".join(sorted({g["@type"] for g in graph}))
        print("  %-34s %s" % (rel, types))
    if check:
        if stale:
            sys.exit("structured data out of date in: " + ", ".join(stale))
        print("structured data is up to date")
    else:
        print("updated %d page(s)" % len(stale))


if __name__ == "__main__":
    main()
