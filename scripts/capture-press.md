# Recapturing the press clippings

`public/images/press-shots/` holds one screenshot per article, taken at phone
width, which `docs/press-data.json` points at and `scripts/update-press.py`
renders into the tiles on `press.html`.

They are captured with a headless browser rather than saved by hand so the set
stays consistent: same width, same crop, same treatment of cookie banners. A
publication redesigns every few years, so expect to redo one occasionally
rather than the whole set.

## The recipe

Viewport **412 x 900**, capture clipped to **412 x 740** from the top of the
page. That ratio is what the tile expects; anything else gets letterboxed or
cropped by `object-fit: cover`.

Before the screenshot:

1. **Dismiss the cookie banner.** Click a button whose text matches
   `accept|agree|consent|continue|got it|allow` but *not*
   `reject|pay|manage|settings|purpose|options|log in|subscribe` — several
   sites put "Reject & Pay" next to "Accept All & Continue", and the wrong one
   sends you to a paywall. Check inside iframes: most consent tools render in
   one. Some sites stack two banners, so run the pass twice.
2. **Hide ad slots**, or a Google ad lands across the middle of the clipping:
   `[id^="div-gpt-ad"], ins.adsbygoogle, [class*="advert" i], [id*="advert" i],
   iframe[src*="doubleclick"]`.
3. **Hide anything fixed or sticky taller than 60px**, which otherwise sits
   across the capture — sticky headers, newsletter bars, video players that
   follow you down the page.
4. Scroll to the top and wait a beat for lazy images to settle.

Then convert with Pillow to two widths, 206 and 412, as WebP quality 80. The
whole set of 21 is about 1.2 MB.

## Two that need special handling

**The Daily Mail** serves a desktop layout whatever the viewport, so a 412-wide
capture clips its headline mid-word. Capture it at **824 x 1480** — the same
ratio — and downscale. Its `.co.uk` URL also redirects to `.com`.

**Iterating `page.frames()` on ad-heavy sites can hang the browser for good.**
Two capture runs died that way and had to be abandoned after the tool timed
out; worse, the pending navigations resolved later and wrote the *next* site's
screenshot under the previous site's name, which is easy to miss. If a run
stalls, close the browser rather than reusing it, capture the stragglers one at
a time, and check the page title after each navigation to confirm you are
photographing what you think you are.

## After recapturing

Run `python3 scripts/update-press.py`. It aborts on a missing file rather than
rendering a broken image, so a wrong filename fails loudly.
