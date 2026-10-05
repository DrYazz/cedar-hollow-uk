/*
 * The private page's tabs -- Cedar Hollow, Oxford, Dorset and the map -- and
 * the first three: the visitor report, live, one of its parts in each. The
 * report is the weekly email's own, built on demand by /wdtcf/report for
 * this week, month or year so far or the last whole one, and shown in a
 * frame sized to it. It is rebuilt every five minutes while the tab is in
 * view (the Worker builds it at most that often anyway); "Refresh now" asks
 * for a fresh one regardless. The tab and the period are kept in the address
 * after the #, beside the map's own choices.
 *
 * Opening this page also marks the browser as Cedar Hollow's own (ch_staff
 * in local storage), which js/analytics.js reads to leave it out of every
 * count on the site; the switch at the top undoes that, or does it again.
 * "1" is left out and "0" counted; a browser that has never been here has
 * neither, and is marked on its first visit only, so "Count it" sticks.
 */
(function () {
  "use strict";

  var VIEWS = ["week", "lastweek", "month", "lastmonth", "year", "lastyear"];
  // The report's parts, each a tab, and the map's.
  var TABS = ["all", "oxford", "dorset", "map"];
  var STAFF = "ch_staff";
  var EVERY = 5 * 60 * 1000;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var hash = function () {
    return new URLSearchParams(location.hash.slice(1));
  };
  var state = {
    tab: TABS.indexOf(hash().get("tab")) >= 0 ? hash().get("tab") : "all",
    view: VIEWS.indexOf(hash().get("view")) >= 0 ? hash().get("view") : "week",
  };
  function remember() {
    var q = hash();
    q.set("tab", state.tab);
    q.set("view", state.view);
    history.replaceState(null, "", "#" + q.toString());
  }

  // Last year has nothing in it before 2027: counting began in October 2026.
  if (new Date().getFullYear() > 2026) document.querySelector('#views [data-view="lastyear"]').hidden = false;

  // ---- this browser: counted or not ---------------------------------------------
  function mark() {
    try {
      return localStorage.getItem(STAFF);
    } catch (e) {
      return undefined;
    }
  }
  try {
    if (mark() === null) localStorage.setItem(STAFF, "1");
  } catch (e) {}
  function showMark() {
    var m = mark();
    $("staff-note").textContent =
      m === undefined
        ? "This browser’s storage is off, so its visits to the site are counted."
        : m === "1"
          ? "This device is left out of the visitor figures."
          : "This device is counted in the visitor figures.";
    $("staff-toggle").hidden = m === undefined;
    $("staff-toggle").textContent = m === "1" ? "Count it" : "Leave it out";
  }
  $("staff-toggle").addEventListener("click", function () {
    try {
      localStorage.setItem(STAFF, mark() === "1" ? "0" : "1");
    } catch (e) {}
    showMark();
  });
  showMark();

  // ---- tabs ------------------------------------------------------------------
  var shown = false;
  function showTab(tab) {
    state.tab = tab;
    remember();
    TABS.forEach(function (name) {
      $("tab-" + name).setAttribute("aria-selected", String(name === tab));
    });
    $("panel-map").hidden = tab !== "map";
    $("panel-stats").hidden = tab === "map";
    if (tab === "map") {
      if (window.wdtcfShowMap) window.wdtcfShowMap();
    } else {
      $("panel-stats").setAttribute("aria-labelledby", "tab-" + tab);
      if (!shown) load(false);
      else showPart();
    }
    // Back to the top of the tab, if the page was scrolled past it.
    var top = document.querySelector(".tabs").getBoundingClientRect().top;
    if (top < 0) window.scrollBy(0, top);
  }
  TABS.forEach(function (name) {
    $("tab-" + name).addEventListener("click", function () {
      showTab(name);
    });
  });

  // ---- the report ------------------------------------------------------------
  var frame = $("report");
  var box = $("report-box");
  var loadedAt = 0;
  function load(fresh) {
    shown = true;
    remember();
    document.querySelectorAll("#views button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
    });
    $("csv").href = "/wdtcf/report?view=" + state.view + "&format=csv";
    box.classList.add("loading");
    $("built").textContent = "Building the report…";
    // The time on the end makes it a new address, so the frame always loads.
    frame.src = "/wdtcf/report?view=" + state.view + (fresh ? "&fresh=1" : "") + "&t=" + Date.now();
    loadedAt = Date.now();
  }

  // The frame shows the chosen tab's part of the report alone.
  function showPart() {
    try {
      var doc = frame.contentDocument;
      if (doc && doc.head) {
        var style = doc.getElementById("only-part");
        if (!style) {
          style = doc.createElement("style");
          style.id = "only-part";
          doc.head.appendChild(style);
        }
        style.textContent = '[data-part]{display:none}[data-part="' + state.tab + '"]{display:block}';
      }
    } catch (e) {}
    fit();
  }

  // The report's own height: the document's is never less than the frame's,
  // so a shorter report after a longer one would keep the longer's height.
  function fit() {
    try {
      var doc = frame.contentDocument;
      if (doc && doc.body) frame.style.height = doc.body.scrollHeight + "px";
    } catch (e) {}
  }
  frame.addEventListener("load", function () {
    box.classList.remove("loading");
    showPart();
    try {
      var doc = frame.contentDocument;
      var meta = doc.querySelector('meta[name="built"]');
      $("built").textContent = meta
        ? "Updated " + new Date(meta.content).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
        : "The report could not be built just now.";
      // Pictures and fonts can change its height after it loads.
      if (window.ResizeObserver) new ResizeObserver(fit).observe(doc.body);
    } catch (e) {}
  });
  window.addEventListener("resize", fit);

  document.querySelectorAll("#views button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.view = b.dataset.view;
      load(false);
    });
  });
  $("refresh").addEventListener("click", function () {
    load(true);
  });

  // Kept current while it is being looked at.
  setInterval(function () {
    if (!document.hidden && state.tab !== "map" && Date.now() - loadedAt >= EVERY) load(false);
  }, 30 * 1000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state.tab !== "map" && shown && Date.now() - loadedAt >= EVERY) load(false);
  });

  showTab(state.tab);
})();
