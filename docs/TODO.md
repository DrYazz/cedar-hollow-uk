# TODO — Cedar Hollow UK

Outstanding gaps in the current site, from an exhaustive page-by-page audit
(links & nav, assets, interactivity, content, structure, SEO, accessibility,
production-readiness). Grouped by priority. Line references are approximate and
may shift as files change.

> **Root cause for most High/Blocker items:** this is a Webflow *template clone*
> (originally "The Oaks" / Mallinson) that was rebranded visually to "Cedar
> Hollow" but never rewired. Real links still point at the source businesses,
> and the interactive pieces (booking widget, search, detail pages) were never
> connected to a backend — which does not exist in a static export.

**Tally at audit time:** 6 blocker · 22 high · 44 medium · 23 low (before consolidation).

---

## Handoff — open items (as of 2026-07-26)

Current outstanding items. All are waiting on the owner (DNS access, content
review, or a decision) — none are blocked on further build work.

- [x] **Custom domain is connected and live.** `cedarhollow.uk` and
  `www.cedarhollow.uk` both serve the site over HTTPS. `ALLOWED_ORIGINS` is set
  on the form-handler. Mail for the domain is handled by Google Workspace, so
  `hello@cedarhollow.uk` has a real mailbox behind it.
- [ ] **Migrate off Railway to Cloudflare Workers.** Phase 1 is deployed and
  verified; see [`CLOUDFLARE_MIGRATION.md`](CLOUDFLARE_MIGRATION.md). Remaining
  work is dashboard-side: turn on email sending, then cut the domain over.
  Takes the hosting bill to £0 and closes the exposure below.
  - [ ] **`docs/` and `form-handler/` are publicly served on Railway today.**
    `https://cedarhollow.uk/docs/TODO.md` returns 200 — this audit, including
    "the booking path is fake", is readable by anyone. Fixed at cutover.
  - [ ] Pick one canonical host (root or `www`) and redirect the other.
    Do it as a Cloudflare Redirect Rule during Phase 3.
- [ ] **Check the Repuso plan covers cedarhollow.uk.** The review wall and the
  live figures both read the owner's Repuso feed, which is configured against
  theoaks.uk. The endpoint is public and unauthenticated so nothing blocks us
  technically, but his plan may be licensed per website, and Repuso is the
  party holding the arrangement with Google and Tripadvisor for redisplaying
  review text. Worth a look at his account before this is promoted anywhere.
  Note also that reviews can be hidden inside Repuso, so the wall shows what
  the feed returns, not necessarily everything a platform holds — the on-page
  wording claims only "most recent first", which stays true either way.
- [ ] **Confirm what makes up Oxford's Airbnb figure.** The site now shows the
  owner's own Repuso total (`js/reviews-live.js`), which reports Airbnb as 141
  reviews across two merged channels. The two public listings we link to add up
  to 106. The 35-review difference is only visible inside his Repuso account:
  either a listing we cannot see (Beaver's Den sells direct and is on no OTA we
  found) or a stale duplicate channel inflating it. Ask him to read off the
  per-channel counts. Until then we are publishing a number we cannot fully
  account for — it is his own published figure, but it is not independently
  checkable from the links on the page, which is the standard the rest of that
  page sets. His Tripadvisor entry likewise merges two channels (66 against the
  65 on the live listing); the second is almost certainly the dead
  `d15009143` vacation-rental page.
- [ ] **Review the legal copy before relying on it.** `privacy-policy.html`,
  `terms-of-service.html`, `cookies.html` are real drafts, publicly live, dated
  23 Jul 2026. Accurate about how the site behaves, but not a lawyer's review.
- [ ] **Check the Sustainability copy for overclaims.** `sustainability.html`
  deliberately states no certifications or figures; confirm every claim is true
  of the actual operation.
- [ ] **Turn on analytics when ready.** `js/analytics.js` is disabled by default
  (`PROVIDER = "none"`, honours Do Not Track). Flip to `"plausible"` or `"ga4"`;
  **update `cookies.html` first** (and add a consent banner if using GA4).

### Resolved since the audit below (2026-07-22 → 26)

Much of the historical audit is now done — kept below for reference, but these are
complete and verified live:

- [x] Railway hosting + GitHub auto-deploy (static site + `form-handler` service).
- [x] Working contact form on the homepage (`#contact`) → emails via the
  self-hosted form-handler over SMTP (live); honeypot + submission logging.
- [x] Client-side search built (`js/listings.js` + `search-results.html`); homepage
  hero search and featured cards deep-link into it.
- [x] Featured Treehouses carousel made data-driven; card images/specs reconciled.
- [x] All footer links wired — phone→`tel:`, email→`mailto:`, legal + content pages,
  Contact→`#contact`. **Zero `href="#"` remain on any live page.**
- [x] Footer social icons rebuilt to the correct platforms (Instagram, TikTok,
  YouTube, Tripadvisor, Facebook) and wired to real profiles.
- [x] Legal pages authored (Privacy, Terms, Cookies) with real draft copy.
- [x] Sustainability + Experiences pages created in the site's style.
- [x] Orphaned `home-copy.html` duplicate removed.
- [x] Analytics scaffold added (off by default).

### Still open from the audit (not yet started)

- [x] `detail_properties.html` is no longer an empty shell answering 200: it now
  forwards to `search-results.html`, which became the property-detail page in
  practice (gallery, facts, description, booking and 3D tour per property).
  (Bookings still hand off to partner sites — see
  [[site-search-and-booking-ctas]] — so a real booking engine remains open.)
- [ ] SEO gaps remain on the original pages: no Open Graph / Twitter / JSON-LD /
  canonical, no `sitemap.xml` or `robots.txt`; `style-guide.html` still indexable
  and shipped to production. (New content/legal pages are `noindex` with meta
  descriptions.)
- [ ] No cookie-consent banner (fine while analytics is off; required if GA4 is enabled).
- [ ] No custom 404 page.
- [ ] Fonts shipped as raw TTF only (no WOFF2); each `@font-face` declared twice.
- [ ] Accessibility polish: skip-to-content link, stronger landmarks,
  `prefers-reduced-motion` on the auto-scrolling carousels.
- [ ] `README.md` still largely boilerplate.
- [ ] No physical address / map / directions for a location-based business.

---

## Blockers — the site is broken for a real visitor

- [ ] **Booking / conversion path is fake.** Each listing's booking area is the
  literal text `<div>Checked.in widget</div>` (`search-results.html:183,248,313`).
  No widget, iframe, or script exists anywhere. Embed the real booking/availability
  engine or a working "Book" CTA. *(Original TODO item — search page not wired.)*
- [x] **`detail_properties.html` is an empty shell.** Resolved by removing it:
  the shell now forwards to `search-results.html`, which carries the gallery,
  description, facts, pricing and booking CTA the template was meant to hold.
  Nothing ever linked to it and it was never in the sitemap.
- [ ] **Dead CTAs everywhere.** `index.html` has 19 `href="#"` links. The hero
  "Explore Retreats" button (`index.html:109`) is dead; half the "View Treehouse"
  buttons (`index.html:415,467`) are dead. Point every CTA at a real destination.
- [ ] **No real navigation menu on any page.** The header (`index.html:100-102`)
  is logo-only; `search-results.html` has no header/nav at all, stranding visitors.
  Add a functional primary nav (Treehouses, Our Story, Experiences, Contact, Book).

## High — broken rebrand, orphaned pages, placeholder catalogue

- [ ] **Half-rebranded template.** "Cedar Hollow" content links out to two
  unrelated businesses — `theoaks.uk` (x11) and `mallinson.co.uk` (x8). "Explore
  Oxford"/"Explore Dorset" (`index.html:320,338`), all booking CTAs →
  `theoaks.uk/availability`, listing copy still says "the magic of The Oaks"
  (`search-results.html:177,242,307`). Repoint every outbound link to Cedar Hollow.
- [ ] **Contact email mismatch.** Footer says `hello@cedarhollow.uk`
  (`index.html:779`) vs README's `hello@theoaks.uk`. Reconcile the correct address.
- [ ] **Four of five pages are orphaned.** The only internal `.html` link is the
  logo → `index.html`. Nothing links to `search-results.html`,
  `detail_properties.html`, `home-copy.html`, or `style-guide.html`. Wire the
  homepage cards/CTAs into the funnel.
- [ ] **Search page can't search.** `search-results.html` has zero `<form>` /
  `<input>` — no dates, guests, or location fields; it's a hard-coded list of
  three items. Add real search inputs wired to listing data.
- [ ] **Placeholder / duplicate catalogue content:**
  - [ ] A cabin is named "The Fox Den 2" (`index.html:427`).
  - [ ] All three search results share identical description and price
    (`From £120`, "Sleeps 2") — one cabin cloned three times
    (`search-results.html:178,243,308`).
  - [ ] "The Bear Lodge" reuses "The Fox Den 2"'s exact features/price; two cards
    share the rating "★★★★☆ 4.7 (58 reviews)".
  - [ ] Property names don't overlap between homepage (Fox Den, Owl's Nest, Bear
    Lodge) and search page (The Treehouse, Faun's Hideaway, Beaver's Den).
  - [ ] Reconcile to one canonical, per-property catalogue with real copy/prices.
- [ ] **Property cards never link to an internal detail page** — all go off-site,
  and the one local detail template is the empty stub above.
- [ ] **Legally-required pages missing.** Footer "Privacy Policy", "Terms of
  Service", "Cookies Settings" (`index.html:843,846,849`) are all `href="#"`
  with no pages behind them (UK GDPR / PECR). Author and link real pages.
- [ ] **No way to contact the business.** Phone and email are shown but not
  clickable — no `tel:` / `mailto:` anywhere — and every "Contact" link is dead.
  No contact form. Add clickable contact links and/or a form (via a form service).
- [ ] **All five footer social links are dead** (`index.html:785,790,795,800,805`,
  all `href="#"`). Set real profile URLs or remove.

## Medium — SEO, compliance, dependencies

- [ ] **SEO largely absent site-wide:** no `<meta name="description">` on any page;
  titles generic/duplicated ("Cedar Hollow UK" ×3) or a raw slug ("Search-results",
  `search-results.html:5`); no Open Graph / Twitter / canonical tags on content
  pages; no JSON-LD for a lodging business; no `sitemap.xml` or `robots.txt`; the
  internal `style-guide.html` is indexable.
- [ ] **Fragile third-party dependencies.** All JS libraries load from CDNs with no
  local fallback; `split-type` and `choosebumps` are loaded unpinned ("latest");
  no Subresource Integrity (SRI) on any remote script; dead commented-out
  CodeSandbox references (`mmmj7h.csb.app`). Vendor locally and/or pin + add SRI.
- [ ] **No cookie-consent banner** despite loading several third-party CDNs
  unconditionally (GDPR / PECR).
- [ ] **No web analytics / conversion tracking** on a marketing & booking site.
- [ ] **No physical address, map, or directions** for a location-based retreat.
- [ ] **`home-copy.html` is a duplicate homepage** — orphaned, and a duplicate-
  content risk with no canonical. Remove or consolidate.

## Low — polish, accessibility, artifacts

- [ ] **Accessibility:** content images carry empty `alt=""`; icon-only social/
  search controls and image-only links lack accessible names; no skip-to-content
  link; weak landmarks (footer is a plain `<section>`, `<nav>` sits inside
  `<main>`); auto-scrolling carousels ignore `prefers-reduced-motion`.
- [ ] **`style-guide.html` shipped to production** with lorem ipsum, a Placeholder
  image, and dead demo forms (a Webflow dev artifact). Remove or de-index.
- [ ] **README is still boilerplate** — wrong contact, empty sections, no
  setup/deploy docs.
- [ ] **No 404 page.**
- [ ] **Fonts shipped as raw TTF only** (no WOFF2), and every `@font-face` is
  declared twice.
- [ ] **Dead code:** `search-results.html` loads two Splide scripts that
  initialise nothing (no `.splide` elements).
- [ ] **No newsletter / email lead-capture** on any live page.
- [ ] **`lang="en"`** rather than `en-GB` for a UK business.
- [ ] **No social-share image asset** present.
