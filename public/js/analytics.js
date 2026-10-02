/*
 * Cedar Hollow analytics loader.
 *
 * ON, WITH CLOUDFLARE WEB ANALYTICS (since 2 October 2026). Every page loads
 * this file, so switching provider is one edit here rather than ninety.
 *
 * Cloudflare used to inject its beacon by itself, at the edge, while the site
 * was proxied to Railway. Pages served straight from Workers static assets
 * never pass through that injection, so since the move to Workers the beacon
 * has to be asked for, and this is where it is asked for. (The Web Analytics
 * site is set to "Enable with JS Snippet installation" for the same reason:
 * should Cloudflare ever inject again, it must not count every visit twice.)
 *
 * Cloudflare Web Analytics sets no cookies and stores nothing on the device,
 * so it needs no consent banner. The Cookies Policy and Privacy Policy say
 * what it records; change them first if this ever changes.
 *
 * The other providers stay available:
 *
 *   Cloudflare Web Analytics (cookie-free, no consent banner needed; in use)
 *     The token is under Analytics > Web analytics > cedarhollow.uk >
 *     Manage site, in the JS snippet. It is not a secret: every page view
 *     sends it.
 *
 *   Plausible (cookie-free, no consent banner needed)
 *     1. Sign up at plausible.io and add the domain cedarhollow.uk
 *     2. Set PROVIDER = "plausible" and DOMAIN = "cedarhollow.uk"
 *
 *   Google Analytics 4 (sets cookies; you will need a consent banner in the
 *   UK/EU, and the Cookies Policy must be updated before you enable it)
 *     1. Create a GA4 property and copy the Measurement ID (G-XXXXXXXXXX)
 *     2. Set PROVIDER = "ga4" and MEASUREMENT_ID = "G-XXXXXXXXXX"
 *
 * Whichever you choose, update cookies.html to describe it.
 */
(function () {
  "use strict";

  // ---- configuration -------------------------------------------------------
  var PROVIDER = "cloudflare"; // "none" | "cloudflare" | "plausible" | "ga4"
  var CLOUDFLARE_TOKEN = "8f05ad07106f4133b274dcdf7dfdd1aa"; // Cloudflare only
  var DOMAIN = "cedarhollow.uk"; // Plausible only
  var MEASUREMENT_ID = ""; // GA4 only, e.g. "G-XXXXXXXXXX"
  // -------------------------------------------------------------------------

  if (PROVIDER === "none") return;

  // Respect a browser "do not track" or Global Privacy Control signal rather
  // than ignoring it -- the same two js/tlg-beacon.js honours, so a visitor
  // who asks not to be measured is not measured by either.
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
  if (navigator.globalPrivacyControl) return;

  function inject(src, attrs) {
    var s = document.createElement("script");
    s.async = true;
    s.src = src;
    Object.keys(attrs || {}).forEach(function (k) {
      s.setAttribute(k, attrs[k]);
    });
    document.head.appendChild(s);
    return s;
  }

  if (PROVIDER === "cloudflare") {
    if (!CLOUDFLARE_TOKEN) return;
    // The same tag Cloudflare's dashboard hands out, built here instead.
    inject("https://static.cloudflareinsights.com/beacon.min.js", {
      type: "module",
      "data-cf-beacon": JSON.stringify({ token: CLOUDFLARE_TOKEN }),
    });
    return;
  }

  if (PROVIDER === "plausible") {
    if (!DOMAIN) return;
    inject("https://plausible.io/js/script.js", { "data-domain": DOMAIN });
    return;
  }

  if (PROVIDER === "ga4") {
    if (!MEASUREMENT_ID) return;
    inject("https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID);
    window.dataLayer = window.dataLayer || [];
    function gtag() {
      window.dataLayer.push(arguments);
    }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", MEASUREMENT_ID, { anonymize_ip: true });
  }
})();
