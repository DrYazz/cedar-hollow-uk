/* The nav panel's place switcher, on phones only.

   Below 768px the panel shows one place at a time, chosen by the three-way
   switch at the top: Cedar Hollow, Oxford, Dorset. The place you are already
   on is chosen when the panel opens, so the switch is a way out rather than
   something you have to use. Above 768px the panel keeps the two-column
   layout, both places side by side, and the switch is not drawn at all --
   that is css/navpanel-places.css, not this file.

   Progressive enhancement, deliberately. The switch ships `hidden` in the
   markup and every group is visible, so a phone with no JavaScript gets the
   whole panel as a plain scrolling list rather than a dead control and two
   thirds of the links missing. This script unhides the switch and marks the
   panel `is-tabbed`, which is the only thing the hiding rules key off.

   The switch is a radio group, not a tab set: three mutually exclusive
   filters over one panel, which is what a radiogroup describes. The brand
   group is not a panel of its own -- it sits at the foot as a row of links on
   the two place choices and becomes the full list on its own choice -- so the
   tab/tabpanel pattern would have been a lie about the markup. */
(function () {
  "use strict";

  var menu = document.getElementById("ch-nav-menu");
  if (!menu || !menu.classList.contains("is-places")) return;

  var group = menu.querySelector(".ch-navswitch");
  if (!group) return;

  var tabs = Array.prototype.slice.call(group.querySelectorAll(".ch-navswitch__tab"));
  if (tabs.length < 2) return;

  function select(place, moveFocus) {
    menu.setAttribute("data-place", place);
    tabs.forEach(function (tab) {
      var on = tab.getAttribute("data-place") === place;
      tab.setAttribute("aria-checked", on ? "true" : "false");
      /* Roving tabindex: one stop for the whole group, arrows move inside it. */
      tab.tabIndex = on ? 0 : -1;
      if (on && moveFocus) tab.focus();
    });
  }

  group.hidden = false;
  menu.classList.add("is-tabbed");
  /* data-site is the page's own place, written into the markup per page. */
  select(menu.getAttribute("data-site") || "brand", false);

  group.addEventListener("click", function (e) {
    var tab = e.target.closest ? e.target.closest(".ch-navswitch__tab") : null;
    if (tab) select(tab.getAttribute("data-place"), false);
  });

  group.addEventListener("keydown", function (e) {
    var here = tabs.indexOf(document.activeElement);
    if (here < 0) return;
    var next;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (here + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (here - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    select(tabs[next].getAttribute("data-place"), true);
  });
})();
