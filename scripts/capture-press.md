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
2. **Remove ad slots, do not hide them.** `display:none` leaves the wrapper
   holding its reserved height, so the ad becomes a white band instead of an
   ad -- that is what the first pass shipped, including a 383px void filling
   half the GQ tile. Call `.remove()` on
   `[id^="div-gpt-ad"], ins.adsbygoogle, [class*="advert" i], [id*="advert" i],
   iframe[src*="doubleclick"], [class*="taboola" i], [class*="outbrain" i],
   [class*="sponsor" i], [class*="promo" i]`, and on any empty block still
   measuring more than 30px tall.
3. **Hide anything fixed or sticky taller than 60px**, which otherwise sits
   across the capture — sticky headers, newsletter bars, video players that
   follow you down the page.
4. **Scroll the whole article and come back to the top** before shooting, or
   lazy-loaded images are still blank placeholders when the shutter falls.
5. **Clean again immediately before the screenshot, with no wait after.** Push
   prompts arrive late: Euro Weekly's OneSignal slide-down appears about eight
   seconds in, after an earlier cleanup has already run, and it landed across
   the top of that tile. Kill `[id*="onesignal" i], [class*="slidedown" i],
   [class*="webpushr" i], [class*="pushly" i]` on that final pass.

Then convert with Pillow to two widths, 206 and 412, as WebP quality 80. The
whole set of 21 is about 1.2 MB.

## Capture tall, then tidy

Shoot at 412x1200 rather than 412x740 and post-process: drop any blank run that
starts at the very top (a void, not spacing), squeeze interior blank runs over
55px down to about 22px, then take the first 740px. That way a tile always
opens on real content. Twenty of twenty-one now have no blank band over 55px;
the exception is the Times Narnia piece, whose gap is the paper's own spacing
between nav and headline.

Bump the `?v=` stamp on the shot URLs in press-data.json after recapturing --
the filenames do not change and Railway sends no cache-control header.

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
