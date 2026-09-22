/*
 * The All / Oxfordshire / Dorset filter on the combined press page.
 *
 * The feed is rendered in full and in date order by scripts/update-press.py;
 * this only hides what does not match. That way the page is complete before any
 * script runs -- every entry is in the HTML for a crawler and for anyone with
 * JavaScript off, who simply sees the whole list, which is the sensible
 * fallback for a filter.
 *
 * The choice is kept in the URL (?w=oxford) so a filtered view can be linked
 * and survives a refresh, using replaceState so it does not pile up history
 * entries as someone flicks between the three.
 */
(function () {
  "use strict";

  var feed = document.querySelector(".ch-feed");
  if (!feed) return;

  var buttons = feed.querySelectorAll(".ch-feed__btn");
  var items = feed.querySelectorAll(".ch-feed__item");
  var status = feed.querySelector(".ch-feed__status");
  if (!buttons.length || !items.length) return;

  var LABELS = { all: "all", oxford: "Oxfordshire", dorset: "Dorset" };

  function apply(value, push) {
    var shown = 0;
    Array.prototype.forEach.call(items, function (li) {
      var match = value === "all" || li.getAttribute("data-location") === value;
      li.hidden = !match;
      if (match) shown++;
    });

    Array.prototype.forEach.call(buttons, function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-filter") === value ? "true" : "false");
    });

    if (status) {
      status.textContent = value === "all"
        ? "Showing all " + shown
        : "Showing " + shown + " from " + LABELS[value];
    }

    if (push && window.history && window.history.replaceState) {
      var url = new URL(window.location.href);
      if (value === "all") {
        url.searchParams.delete("w");
      } else {
        url.searchParams.set("w", value);
      }
      try {
        window.history.replaceState({}, "", url);
      } catch (e) {}
    }
  }

  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener("click", function () {
      apply(b.getAttribute("data-filter"), true);
    });
  });

  /* Honour ?w= on arrival, so a shared link opens on the right woodland. */
  var start = "all";
  try {
    var w = new URL(window.location.href).searchParams.get("w");
    if (w && LABELS[w]) start = w;
  } catch (e) {}
  if (start !== "all") apply(start, false);
})();
