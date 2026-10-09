/*
 * theoaks.uk -- the old Oxford site, forwarded to cedarhollow.uk.
 *
 * theoaks.uk was Cedar Hollow Oxford's site, built on Wix, until October
 * 2026. Every page on it has an equivalent here, and this Worker answers
 * every request for the old domain -- either host, http or https -- with one
 * permanent redirect to that equivalent's canonical address. One hop, to the
 * exact final URL: Google advises against redirect chains in a site move, and
 * every extra hop is another fetch for every crawler.
 *
 * It is its own Worker, not part of worker/index.js, attached to theoaks.uk
 * and www.theoaks.uk as custom domains, so nothing here can affect
 * cedarhollow.uk. Mail to @theoaks.uk is not involved: that is the zone's MX
 * records, which still point at Google Workspace.
 *
 * Keep it running for years. Search Console's Change of Address carries the
 * old site's standing across for 180 days, Google's site-move guide says to
 * keep redirects for at least a year, and bookmarks, old reviews and printed
 * cards point at theoaks.uk for far longer than either. The domain is
 * registered at names.co.uk until June 2028.
 *
 * Deploying: Cloudflare dashboard > Workers & Pages > theoaks-redirect >
 * Edit code, paste this file over what is there, Deploy. Then run
 *
 *   python scripts/check-theoaks-redirects.py
 *
 * which fetches every old address on both hosts, over http and https, and
 * fails on anything that is not a single 301 to a live page.
 */

const NEW_SITE = "https://cedarhollow.uk";
const OLD_SITE = "https://www.theoaks.uk"; // Wix's canonical host

/*
 * Every address in Wix's sitemaps at the move, as it is matched: lower case,
 * no trailing slash. Each target is that page's canonical URL on
 * cedarhollow.uk, never an address that redirects again.
 *
 * Most pages kept their slug under /oxford/. Of the rest, the shop and the
 * three 3D-tour pages (vr, vr2 and copy-of-map) go where their /oxford/ twins
 * go in public/_redirects, the Oxford home page, and copy-of-facilities --
 * Wix's Vouchers page, never renamed -- goes to the Oxford retreats, since
 * vouchers are due to return as part of booking a stay.
 *
 * Strict JSON (double quotes, no trailing comma), so the check script can
 * read it straight out of this file.
 */
const MAP = {
  "/": "/oxford.html",
  "/experiences": "/oxford/experiences.html",
  "/map": "/oxford/map.html",
  "/accessibility": "/oxford/accessibility.html",
  "/form": "/oxford/form.html",
  "/schoolgroups": "/oxford/schoolgroups.html",
  "/wasps": "/oxford/wasps.html",
  "/faq": "/oxford/faq.html",
  "/bees": "/oxford/bees.html",
  "/philanthropy": "/oxford/philanthropy.html",
  "/mutualism": "/oxford/mutualism.html",
  "/parasitoid": "/oxford/parasitoid.html",
  "/todo": "/oxford/todo.html",
  "/chocolate": "/oxford/chocolate.html",
  "/illusions": "/oxford/illusions.html",
  "/story": "/about.html#oxford-story",
  "/beemuseum": "/oxford/beemuseum.html",
  "/colonial": "/oxford/colonial.html",
  "/wellness": "/oxford/wellness.html",
  "/adaptation": "/oxford/adaptation.html",
  "/invasion": "/oxford/invasion.html",
  "/honey": "/oxford/honey.html",
  "/dining": "/oxford/dining.html",
  "/otherbees": "/oxford/otherbees.html",
  "/enemies": "/oxford/enemies.html",
  "/facilities": "/oxford/facilities.html",
  "/makeamemory": "/oxford/philanthropy.html#make-a-memory",
  "/availability": "/oxford-stays.html",
  "/influencers": "/influencers.html",
  "/sustainability": "/sustainability.html#oxford",
  "/reviews": "/oxford-reviews.html",
  "/working": "/careers.html",
  "/events": "/oxford/celebrations.html",
  "/terms": "/terms-of-service.html",
  "/privacy": "/privacy-policy.html",
  "/klevio": "/oxford/faq.html",
  "/copy-of-facilities": "/oxford-stays.html",
  "/shop": "/oxford.html",
  "/vr": "/oxford.html",
  "/vr2": "/oxford.html",
  "/copy-of-map": "/oxford.html",
  "/product-page/cedar-hollow-honey": "/oxford/honey.html",
  "/product-page/chocolate-bonbons-4-pieces": "/oxford/chocolate.html"
};

// Anything not in the map -- a Wix system page, a mistyped link -- lands on
// the Oxford home page rather than an error.
const FALLBACK = "/oxford.html";

/*
 * Google's site-move guide asks for a sitemap of the old URLs to stay up while
 * the move is crawled, so Google revisits them and finds the redirects. So
 * Wix's three sitemap files keep answering at their old addresses, listing
 * the old URLs. Once Search Console shows the old pages have left the index,
 * these and the Sitemap line in robots.txt can go.
 *
 * robots.txt must not block anything: a crawler that may not fetch an old
 * URL never sees where it went.
 *
 * MOVED is the day the redirects went live, which is the day each old URL's
 * content last changed.
 */
const MOVED = "2026-10-02";

const ROBOTS = `User-agent: *
Allow: /

Sitemap: ${OLD_SITE}/sitemap.xml
`;

export default {
  fetch(request) {
    const url = new URL(request.url);
    const path = normalise(url.pathname);

    if (path === "/robots.txt") return file(ROBOTS, "text/plain");
    if (path === "/sitemap.xml") return file(sitemapIndex(), "application/xml");
    if (path === "/pages-sitemap.xml") return file(urlset((p) => !isProduct(p)), "application/xml");
    if (path === "/store-products-sitemap.xml") return file(urlset(isProduct), "application/xml");

    // The query string is kept (an old link's utm_ tags still count); a
    // fragment in the map goes after it, where a fragment belongs.
    const [page, fragment] = (MAP[path] || FALLBACK).split("#");
    const location = NEW_SITE + page + url.search + (fragment ? "#" + fragment : "");

    return new Response(null, {
      status: 301,
      headers: {
        Location: location,
        // A day rather than forever, which is how long a browser keeps a 301
        // without being told: a mapping corrected here should reach people
        // who have already followed the old one.
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
};

// "/Facilities/", "/facilities" and "//facilities" are the same page.
function normalise(pathname) {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    // A malformed escape is matched as written, and so falls back.
  }
  return p.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
}

function isProduct(path) {
  return path.startsWith("/product-page/");
}

function sitemapIndex() {
  const maps = ["pages-sitemap.xml", "store-products-sitemap.xml"].map(
    (name) => `  <sitemap><loc>${OLD_SITE}/${name}</loc><lastmod>${MOVED}</lastmod></sitemap>`
  );
  return xml("sitemapindex", maps);
}

function urlset(keep) {
  const urls = Object.keys(MAP)
    .filter(keep)
    .map((path) => `  <url><loc>${OLD_SITE}${path}</loc><lastmod>${MOVED}</lastmod></url>`);
  return xml("urlset", urls);
}

function xml(root, lines) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${lines.join("\n")}
</${root}>
`;
}

function file(body, type) {
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
