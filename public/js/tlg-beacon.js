/*
 * The Lab Group engagement beacon.
 *
 * Measures one thing Cloudflare Web Analytics cannot: how long someone actually
 * spent on a page. Cloudflare stores no cookie, no localStorage and no derived
 * identifier, so its page views cannot be stitched into sessions and dwell time
 * is unavailable there in principle, not by omission.
 *
 * DEPLOY THIS INTO EACH APP — do not load it from the portal. The portal sits
 * behind Cloudflare Access, and even if a path were opened, making an internal
 * ops dashboard a runtime dependency of fourteen customer-facing sites trades a
 * real outage risk for a convenience. Copy it into the app's layout instead; it
 * has no dependencies and is not expected to change.
 *
 * In a Laravel app that means one line before </body> in the root layout:
 *
 *     <script src="{{ asset('js/tlg-beacon.js') }}" defer></script>
 *
 * WHAT IT SENDS. A per-tab random id, the pathname, and milliseconds of visible
 * time. No query strings, no fragments, no referrer, no user agent parsing, no
 * personal data of any kind. The id lives in sessionStorage, dies with the tab
 * and is hashed server-side before storage.
 *
 * WHAT IT MEASURES. Engaged time — time the tab was actually visible — not
 * wall-clock time. A tab opened and abandoned for an hour contributes the
 * seconds someone looked at it. This is why the numbers will read lower than
 * most analytics products, and why they are worth more.
 */
(function () {
  "use strict";

  var ENDPOINT = "https://dev.thelabgroup.com/collect";

  // Honour the browser's stated preference. Both of these are the visitor
  // saying they do not want to be measured, and an internal dashboard's
  // curiosity does not outrank that.
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
  if (navigator.globalPrivacyControl) return;

  // Inside an iframe the parent already measures the page; counting it twice
  // would double every figure on sites that embed their own widgets.
  if (window.top !== window.self) return;

  var KEY = "tlg_sid";
  var sid;
  try {
    sid = sessionStorage.getItem(KEY);
    if (!sid) {
      sid =
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      sessionStorage.setItem(KEY, sid);
    }
  } catch (e) {
    // Private mode, or storage disabled. Without a session id there is nothing
    // meaningful to report, so stop rather than send unattributable rows.
    return;
  }

  var path = location.pathname;
  var visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
  var pending = 0;

  function accumulate() {
    if (visibleSince) {
      pending += Date.now() - visibleSince;
      visibleSince = Date.now();
    }
  }

  function send(isNewPage) {
    // A beacon worth less than a second of reading adds a write to the
    // portal's budget and nothing to the average. The page-view beacon is
    // exempt: it has to land even at zero, or a visitor who leaves instantly
    // is never counted and the bounce rate flatters itself.
    if (!isNewPage && pending < 1000) return;

    var body = JSON.stringify({
      sid: sid,
      path: path,
      ms: pending,
      np: isNewPage ? 1 : 0,
    });
    pending = 0;

    try {
      // text/plain keeps this a "simple" request, so the browser never sends a
      // CORS preflight — one round trip instead of two, from a real visitor's
      // connection.
      var blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (!navigator.sendBeacon || !navigator.sendBeacon(ENDPOINT, blob)) {
        fetch(ENDPOINT, {
          method: "POST",
          body: body,
          keepalive: true,
          mode: "cors",
        }).catch(function () {});
      }
    } catch (e) {
      // Never surface anything. This runs on live customer sites, where a
      // console error from an internal dashboard is a real support ticket.
    }
  }

  // Count the page view immediately. Waiting until the tab hides would lose
  // every visitor who closes the tab abruptly — and those are precisely the
  // ones a bounce rate is meant to describe.
  send(true);

  document.addEventListener(
    "visibilitychange",
    function () {
      if (document.visibilityState === "hidden") {
        accumulate();
        visibleSince = 0;
        send(false);
      } else {
        visibleSince = Date.now();
      }
    },
    true,
  );

  // pagehide rather than unload: unload is unreliable on mobile Safari and
  // blocks the back/forward cache on every browser that has one.
  window.addEventListener(
    "pagehide",
    function () {
      accumulate();
      send(false);
    },
    true,
  );

  // Single-page navigation. Laravel apps with Livewire or Inertia change the
  // path without a document load, and without this every such visit would be
  // recorded as one very long page view of whichever page happened to load
  // first.
  function navigated() {
    if (location.pathname === path) return;
    accumulate();
    send(false);
    path = location.pathname;
    pending = 0;
    visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
    send(true);
  }

  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    if (typeof original !== "function") return;
    history[name] = function () {
      var result = original.apply(this, arguments);
      navigated();
      return result;
    };
  });
  window.addEventListener("popstate", navigated, true);
})();
