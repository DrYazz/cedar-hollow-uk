/*
 * The press filters: woodland (All / Oxfordshire / Dorset) and kind of
 * coverage (Everything / In words / On screen).
 *
 * The combined page carries both rows; the two location pages carry only the
 * kind row, since the woodland is already settled by which page you are on.
 *
 * The feed is rendered in full and in date order by scripts/update-press.py;
 * this only hides what does not match. That way the page is complete before
 * any script runs -- every entry is in the HTML for a crawler and for anyone
 * with JavaScript off, who simply sees the whole list, which is the sensible
 * fallback for a filter.
 *
 * Both choices are kept in the URL (?w=oxford&k=video) so a filtered view can
 * be linked and survives a refresh, using replaceState so it does not pile up
 * history entries as someone flicks between them.
 */
(function () {
  "use strict";

  var feed = document.querySelector(".ch-feed");
  if (!feed) return;

  var items = feed.querySelectorAll(".ch-feed__item");
  var status = feed.querySelector(".ch-feed__status");
  var empty = feed.querySelector(".ch-feed__empty");
  if (!items.length) return;

  /* group name -> { param, attribute, everything, labels } */
  var GROUPS = {
    location: {
      param: "w",
      attr: "data-location",
      any: "all",
      labels: { oxford: "Oxfordshire", dorset: "Dorset" }
    },
    kind: {
      param: "k",
      attr: "data-kind",
      any: "any",
      labels: { article: "in words", video: "on screen" }
    }
  };

  var state = {};
  Object.keys(GROUPS).forEach(function (g) {
    if (feed.querySelector('.ch-feed__btn[data-group="' + g + '"]')) state[g] = GROUPS[g].any;
  });
  if (!Object.keys(state).length) return;

  function describe(shown) {
    var bits = [];
    Object.keys(state).forEach(function (g) {
      var cfg = GROUPS[g];
      if (state[g] !== cfg.any) bits.push(cfg.labels[state[g]]);
    });
    if (!bits.length) return "Showing all " + shown;
    return "Showing " + shown + " " + bits.join(", ");
  }

  function apply(push) {
    var shown = 0;
    Array.prototype.forEach.call(items, function (li) {
      var match = Object.keys(state).every(function (g) {
        var cfg = GROUPS[g];
        return state[g] === cfg.any || li.getAttribute(cfg.attr) === state[g];
      });
      li.hidden = !match;
      if (match) shown++;
    });

    Array.prototype.forEach.call(feed.querySelectorAll(".ch-feed__btn"), function (b) {
      var g = b.getAttribute("data-group");
      b.setAttribute("aria-pressed",
        state[g] === b.getAttribute("data-filter") ? "true" : "false");
    });

    if (status) status.textContent = describe(shown);
    /* Two filters can genuinely exclude everything -- Dorset has no video on
       some views -- so say so rather than showing a blank grid. */
    if (empty) empty.hidden = shown !== 0;

    if (push && window.history && window.history.replaceState) {
      try {
        var url = new URL(window.location.href);
        Object.keys(state).forEach(function (g) {
          var cfg = GROUPS[g];
          if (state[g] === cfg.any) url.searchParams.delete(cfg.param);
          else url.searchParams.set(cfg.param, state[g]);
        });
        window.history.replaceState({}, "", url);
      } catch (e) {}
    }
  }

  feed.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".ch-feed__btn");
    if (!b) return;
    var g = b.getAttribute("data-group");
    if (!(g in state)) return;
    state[g] = b.getAttribute("data-filter");
    apply(true);
  });

  /* Honour the URL on arrival, so a shared link opens on the right view. */
  var changed = false;
  try {
    var params = new URL(window.location.href).searchParams;
    Object.keys(state).forEach(function (g) {
      var cfg = GROUPS[g];
      var v = params.get(cfg.param);
      if (v && (v === cfg.any || cfg.labels[v])) {
        state[g] = v;
        changed = changed || v !== cfg.any;
      }
    });
  } catch (e) {}
  if (changed) apply(false);
})();
