/*
 * The private page's tabs, and its first: the visitor report, live. The
 * report is the weekly email's own, built on demand by /wdtcf/report for
 * this week, month or year so far or the last whole one, and shown in a
 * frame sized to it. It is rebuilt every five minutes while the tab is in
 * view (the Worker builds it at most that often anyway); "Refresh now" asks
 * for a fresh one regardless. The tab and the period are kept in the address
 * after the #, beside the map's own choices.
 */
(function () {
  "use strict";

  var VIEWS = ["week", "lastweek", "month", "lastmonth", "year", "lastyear"];
  var EVERY = 5 * 60 * 1000;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var hash = function () {
    return new URLSearchParams(location.hash.slice(1));
  };
  var state = {
    tab: hash().get("tab") === "map" ? "map" : "stats",
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

  // ---- tabs ------------------------------------------------------------------
  var shown = false;
  function showTab(tab) {
    state.tab = tab;
    remember();
    ["stats", "map"].forEach(function (name) {
      $("tab-" + name).setAttribute("aria-selected", String(name === tab));
      $("panel-" + name).hidden = name !== tab;
    });
    if (tab === "map" && window.wdtcfShowMap) window.wdtcfShowMap();
    if (tab === "stats" && !shown) load(false);
  }
  $("tab-stats").addEventListener("click", function () {
    showTab("stats");
  });
  $("tab-map").addEventListener("click", function () {
    showTab("map");
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
    fit();
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
    if (!document.hidden && state.tab === "stats" && Date.now() - loadedAt >= EVERY) load(false);
  }, 30 * 1000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state.tab === "stats" && shown && Date.now() - loadedAt >= EVERY) load(false);
  });

  showTab(state.tab);
})();
