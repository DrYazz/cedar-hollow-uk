/*
 * The woodland filter on the combined press page: All / Oxfordshire / Dorset.
 *
 * One control, two sections. It sits above the clippings but narrows the
 * screen section as well, because a reader asking for Dorset wants the Dorset
 * films too. Anything carrying data-location is in scope, so the markup decides
 * what is filterable and this file does not need to know about grids.
 *
 * The two single-woodland pages render no control, so this exits immediately
 * there -- the woodland is already settled by which page you are on.
 *
 * The choice is kept in the URL (?w=dorset) so a filtered view can be linked
 * and survives a refresh, using replaceState so flicking between them does not
 * pile up history entries.
 *
 * Progressive enhancement: the page is rendered whole and in order by
 * scripts/update-press.py. With JavaScript off the buttons do nothing and every
 * entry stays visible, which is the sensible fallback for a filter.
 */
(function () {
  "use strict";

  var control = document.querySelector(".ch-press__filter");
  if (!control) return;

  var buttons = control.querySelectorAll(".ch-feed__btn[data-group=\"location\"]");
  var items = document.querySelectorAll("[data-location]");
  if (!buttons.length || !items.length) return;

  var ANY = "all";
  var PARAM = "w";
  var state = ANY;

  function apply() {
    for (var i = 0; i < items.length; i++) {
      var match = state === ANY || items[i].getAttribute("data-location") === state;
      items[i].hidden = !match;
    }
    for (var b = 0; b < buttons.length; b++) {
      var on = buttons[b].getAttribute("data-filter") === state;
      buttons[b].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function remember() {
    var url = new URL(window.location.href);
    if (state === ANY) url.searchParams.delete(PARAM);
    else url.searchParams.set(PARAM, state);
    window.history.replaceState({}, "", url);
  }

  control.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".ch-feed__btn");
    if (!btn) return;
    state = btn.getAttribute("data-filter") || ANY;
    apply();
    remember();
  });

  /* honour ?w= on arrival, ignoring a value no button offers */
  var wanted = new URL(window.location.href).searchParams.get(PARAM);
  if (wanted) {
    for (var k = 0; k < buttons.length; k++) {
      if (buttons[k].getAttribute("data-filter") === wanted) { state = wanted; break; }
    }
  }
  apply();
})();
