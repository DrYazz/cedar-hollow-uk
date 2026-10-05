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

/*
 * Clicks to book: which ways of finding the site lead people on to book.
 *
 * Booking happens on other sites -- Checked.in for Oxford, Mallinson's for
 * Dorset -- and Cloudflare's analytics cannot follow anyone there, or even
 * from page to page. So the tab remembers, in session storage, where its
 * visit came from: a random id, the website that sent it and the page it
 * landed on, gone when the tab closes. A click through to a booking site
 * sends that, with the retreat, to /api/intent; once per retreat a visit.
 * Links to Checked.in also take the id and the website along (see tag), so
 * that Checked.in can report a booking back with them (/api/booking).
 * The Cookies Policy and Privacy Policy describe it; change them first if
 * this changes.
 *
 * A visit begins where Cloudflare's does: on any page reached from anywhere
 * but this site, the address typed in included. A link tagged with
 * ?utm_source= -- Coolstays' listing, an Instagram bio -- names where it
 * came from better than any referrer can, so its tag ("coolstays") becomes
 * the visit's source, and a new tag begins a new visit.
 *
 * The Oxford calendars on the stay pages are Checked.in's own frames, which
 * open the booking themselves; they say so with a { cinBookingOpened }
 * message, and that counts as a click too.
 *
 * The same visit is counted once more, for the private map of where visits
 * come from (/wdtcf): /api/visit hears when it begins, and when it first
 * reaches Oxford's or Dorset's pages, and counts it against the town
 * Cloudflare places it in. Nothing about the visit goes with that but which
 * of those it is.
 */
(function () {
  "use strict";

  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
  if (navigator.globalPrivacyControl) return;
  if (window.top !== window.self) return;

  var KEY = "ch_visit";
  function ours(host) {
    return host === location.hostname || /(^|\.)cedarhollow\.uk$/.test(host);
  }
  var visit;
  try {
    var from = "";
    var campaign = "";
    try {
      from = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : "";
      // In the shape a host name has, so it travels the same way: lower
      // case, anything else a hyphen, no hyphen at either end.
      campaign = (new URL(location.href).searchParams.get("utm_source") || "")
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 100)
        .replace(/-+$/, "");
    } catch (e) {}
    visit = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (campaign ? !visit || visit.from !== campaign : !visit || !ours(from)) {
      visit = {
        id: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
        from: campaign || (ours(from) ? "" : from),
        landed: location.pathname,
        sent: {},
      };
      sessionStorage.setItem(KEY, JSON.stringify(visit));
    }
  } catch (e) {
    return; // private mode or storage off: nothing to attribute a click to
  }

  // Where visits come from: once a visit, and once for each woodland whose
  // pages it reaches -- the same test as partOf in the Worker.
  try {
    var woodland = (/^\/(oxford|dorset)(?:[./-]|$)/i.exec(location.pathname) || [])[1];
    var mapped = visit.mapped || (visit.mapped = {});
    var parts = ["all", woodland && woodland.toLowerCase()].filter(function (part) {
      return part && !mapped[part];
    });
    if (parts.length) {
      parts.forEach(function (part) {
        mapped[part] = 1;
      });
      sessionStorage.setItem(KEY, JSON.stringify(visit));
      var where = JSON.stringify({ parts: parts });
      if (!(navigator.sendBeacon && navigator.sendBeacon("/api/visit", where))) {
        fetch("/api/visit", { method: "POST", body: where, keepalive: true }).catch(function () {});
      }
    }
  } catch (e) {}

  // Checked.in is Cedar Hollow's own booking system, so the links to it and
  // the calendars from it carry the visit's id and the website it came from
  // (cin_ref, cin_src), and a booking made there can be matched to them.
  // js/properties-page.js tags its calendars with this as it draws them.
  var CHECKED_IN = /(^|\.)checked\.in$/;
  function tag(href) {
    try {
      var url = new URL(href, location.href);
      if (!CHECKED_IN.test(url.hostname)) return href;
      url.searchParams.set("cin_ref", visit.id);
      url.searchParams.set("cin_src", visit.from);
      return url.href;
    } catch (e) {
      return href;
    }
  }
  window.cinTag = tag;

  function send(href, retreat) {
    var once = href.split(/[?#]/)[0] + " " + (retreat || "");
    if (visit.sent[once]) return;
    visit.sent[once] = 1;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(visit));
    } catch (e) {}
    var body = JSON.stringify({
      v: visit.id,
      s: visit.from,
      l: visit.landed,
      p: location.pathname,
      h: href,
      r: retreat || "",
    });
    // A beacon outlives the page, should the click take the tab with it.
    if (!(navigator.sendBeacon && navigator.sendBeacon("/api/intent", body))) {
      fetch("/api/intent", { method: "POST", body: body, keepalive: true }).catch(function () {});
    }
  }

  var BOOKING = /(^|\.)(checked\.in|mallinson\.co\.uk)$/;
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      var url;
      try {
        url = new URL(a.href, location.href);
      } catch (err) {
        return;
      }
      if (!BOOKING.test(url.hostname)) return;
      // Retagged as it is followed: the link takes the address it has once
      // the click is over.
      if (CHECKED_IN.test(url.hostname)) a.href = tag(a.href);
      send(url.href, a.getAttribute("data-retreat"));
    },
    true
  );

  window.addEventListener("message", function (e) {
    var opened = e.data && e.data.cinBookingOpened;
    if (!opened || !/^https:\/\/([a-z0-9-]+\.)*checked\.in$/.test(e.origin)) return;
    var slug = String(opened.property || "").replace(/[^a-z0-9-]/g, "");
    send("https://app.checked.in/widget/calendar2/" + slug, "");
  });
})();
