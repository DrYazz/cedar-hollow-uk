/*
 * The controls above the press coverage: which woodland, and which kind.
 *
 * Woodland (All / Oxfordshire / Dorset) narrows both grids, because a reader
 * asking for Dorset wants the Dorset films too. Anything carrying
 * data-location is in scope, so the markup decides what is filterable and
 * this file does not need to know about grids.
 *
 * Kind (All / Press / TV) hides a whole section, heading and all, so the
 * sections carry data-kind and the bar sits above both of them -- a control
 * cannot hide itself.
 *
 * A woodland page renders the kind control on its own: which woodland is
 * already settled by which page you are on. So neither control is assumed --
 * whichever buttons the page renders are the ones this file drives.
 *
 * Where both are present they combine: Dorset and TV shows the Dorset films
 * only. The counts on the buttons are recounted after every choice so each
 * one says how many entries that button would actually reveal, given the
 * other control.
 *
 * The choice is kept in the URL (?w=dorset&k=screen) so a filtered view can
 * be linked and survives a refresh, using replaceState so flicking between
 * them does not pile up history entries.
 *
 * Progressive enhancement: the pages are rendered whole and in order by
 * scripts/update-press.py, with the server's own counts on the buttons. With
 * JavaScript off the buttons do nothing and every entry stays visible, which
 * is the sensible fallback for a filter.
 */
(function () {
  "use strict";

  var bar = document.querySelector(".ch-press__filters");
  if (!bar) return;

  var ANY = "all";
  var items = document.querySelectorAll("[data-location]");
  var sections = document.querySelectorAll("[data-kind]");
  if (!items.length || !sections.length) return;

  /* Only the controls this page actually renders. */
  var PARAMS = { location: "w", kind: "k" };
  var groups = {};
  for (var name in PARAMS) {
    var buttons = bar.querySelectorAll('.ch-feed__btn[data-group="' + name + '"]');
    if (buttons.length) {
      groups[name] = { param: PARAMS[name], state: ANY, buttons: buttons };
    }
  }
  if (!groups.location && !groups.kind) return;

  function stateOf(group) {
    return groups[group] ? groups[group].state : ANY;
  }

  /* An entry's kind is the section it sits in. */
  function kindOf(el) {
    var section = el.closest && el.closest("[data-kind]");
    return section ? section.getAttribute("data-kind") : "";
  }

  function matches(el, group, value) {
    var actual = group === "kind" ? kindOf(el) : el.getAttribute("data-location");
    return value === ANY || actual === value;
  }

  /* What a button would reveal: entries it matches that the OTHER control
     is not already excluding. */
  function tally(group, value) {
    var other = group === "kind" ? "location" : "kind";
    var n = 0;
    for (var i = 0; i < items.length; i++) {
      if (matches(items[i], group, value) &&
          matches(items[i], other, stateOf(other))) n++;
    }
    return n;
  }

  function apply() {
    for (var i = 0; i < items.length; i++) {
      items[i].hidden = !matches(items[i], "location", stateOf("location"));
    }
    for (var s = 0; s < sections.length; s++) {
      sections[s].hidden = !matches(sections[s], "kind", stateOf("kind"));
    }
    for (var name in groups) {
      var buttons = groups[name].buttons;
      for (var b = 0; b < buttons.length; b++) {
        var value = buttons[b].getAttribute("data-filter");
        var count = buttons[b].querySelector(".ch-feed__count");
        buttons[b].setAttribute(
          "aria-pressed", value === groups[name].state ? "true" : "false");
        if (count) count.textContent = tally(name, value);
      }
    }
  }

  function remember() {
    var url = new URL(window.location.href);
    for (var name in groups) {
      if (groups[name].state === ANY) url.searchParams.delete(groups[name].param);
      else url.searchParams.set(groups[name].param, groups[name].state);
    }
    window.history.replaceState({}, "", url);
  }

  bar.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".ch-feed__btn");
    if (!btn) return;
    var group = groups[btn.getAttribute("data-group")];
    if (!group) return;
    group.state = btn.getAttribute("data-filter") || ANY;
    apply();
    remember();
  });

  /* honour ?w= and ?k= on arrival, ignoring a value no button offers */
  var wanted = new URL(window.location.href).searchParams;
  for (var name in groups) {
    var asked = wanted.get(groups[name].param);
    if (!asked) continue;
    var offered = groups[name].buttons;
    for (var k = 0; k < offered.length; k++) {
      if (offered[k].getAttribute("data-filter") === asked) {
        groups[name].state = asked;
        break;
      }
    }
  }
  apply();
})();
