/*
 * The private visitor map at /wdtcf: draws /wdtcf/data -- visits by town and
 * by day, for all visits or one woodland's, over a run of days -- as dots on
 * a map, a chart and two tables. The choice is kept in the address after the
 * #, so a view can be bookmarked or reloaded.
 */
(function () {
  "use strict";

  var NAMES = { all: "All visits", oxford: "Oxford", dorset: "Dorset" };
  var COLOURS = { all: "#3b4126", oxford: "#2f6b3a", dorset: "#b5652a" };
  var number = new Intl.NumberFormat("en-GB");
  var regions = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en-GB"], { type: "region" }) : null;
  var $ = function (id) {
    return document.getElementById(id);
  };

  function countryName(code) {
    if (code === "T1") return "Tor network";
    if (!code || code === "XX") return "Unknown";
    try {
      return (regions && regions.of(code)) || code;
    } catch (e) {
      return code;
    }
  }
  function escape(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  // Dates are London days, YYYY-MM-DD, worked on as UTC midnights.
  function today() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function addDays(day, n) {
    var d = new Date(day + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function between(from, to) {
    return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  }
  function nice(day, withYear) {
    return new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
  }

  // What is shown: part, and either a run of days to today or two dates.
  var view = { part: "all", days: "30", from: "", to: "" };
  (function fromAddress() {
    var q = new URLSearchParams(location.hash.slice(1));
    if (NAMES[q.get("part")]) view.part = q.get("part");
    if (/^(1|7|30|90|365|all)$/.test(q.get("days") || "")) view.days = q.get("days");
    else if (/^\d{4}-\d{2}-\d{2}$/.test(q.get("from") || "") && /^\d{4}-\d{2}-\d{2}$/.test(q.get("to") || "")) {
      view.days = "";
      view.from = q.get("from");
      view.to = q.get("to");
    }
  })();

  var map = L.map("map", { worldCopyJump: true, minZoom: 2, zoomSnap: 0.5 }).setView([52.6, -1.8], 6);
  map.attributionControl.setPrefix("");
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  var dots = L.layerGroup().addTo(map);

  function range() {
    if (view.days === "") return [view.from, view.to];
    var to = today();
    if (view.days === "all") return ["2026-01-01", to];
    return [addDays(to, 1 - Number(view.days)), to];
  }

  var asked = 0;
  function load() {
    var r = range();
    var q = "part=" + view.part + (view.days ? "&days=" + view.days : "&from=" + r[0] + "&to=" + r[1]);
    history.replaceState(null, "", "#" + q);
    document.documentElement.style.setProperty("--part", COLOURS[view.part]);
    document.querySelectorAll(".seg button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.part === view.part));
    });
    document.querySelectorAll(".chips button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.days === view.days));
    });
    var mine = ++asked;
    $("summary").replaceChildren(el("p", "Loading…", "note"));
    fetch("/wdtcf/data?part=" + view.part + "&from=" + r[0] + "&to=" + r[1], { credentials: "same-origin", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("The figures could not be read (" + res.status + ").");
        return res.json();
      })
      .then(function (d) {
        if (mine === asked) draw(d);
      })
      .catch(function (err) {
        if (mine === asked) $("summary").replaceChildren(el("p", err.message || "The figures could not be read.", "note"));
      });
  }

  function draw(d) {
    // "All" starts where the counting did.
    var from = view.days === "all" && d.first ? d.first : d.from;
    $("from").value = from;
    $("to").value = d.to;
    var total = 0;
    d.towns.forEach(function (t) {
      total += t[5];
    });
    summary(d, from, total);
    drawMap(d.towns, total);
    chart(d, from);
    tables(d.towns, total);
  }

  function summary(d, from, total) {
    var countries = {};
    d.towns.forEach(function (t) {
      countries[t[0]] = 1;
    });
    var box = $("summary");
    box.replaceChildren();
    var big = el("span", number.format(total), "big");
    box.appendChild(big);
    var what = el("span", null, "stat");
    what.innerHTML =
      "<b>" + escape(NAMES[d.part]) + "</b> · " + number.format(d.towns.length) + " town" + (d.towns.length === 1 ? "" : "s") + " in " +
      number.format(Object.keys(countries).length) + " countr" + (Object.keys(countries).length === 1 ? "y" : "ies") + " · " +
      escape(from === d.to ? nice(from, true) : nice(from, from.slice(0, 4) !== d.to.slice(0, 4)) + " – " + nice(d.to, true));
    box.appendChild(what);
    // Against as many days just before, unless that is before counting began.
    if (view.days !== "all" && d.first && d.before.from >= d.first) {
      var was = d.before.visits;
      var cmp = el("span", null, "stat");
      if (was) {
        var change = Math.round(((total - was) / was) * 100);
        cmp.innerHTML =
          '<b class="' + (change >= 0 ? "up" : "down") + '">' + (change >= 0 ? "▲ " : "▼ ") + Math.abs(change) + "%</b> on the " +
          between(d.before.from, d.before.to) + " day" + (between(d.before.from, d.before.to) === 1 ? "" : "s") + " before (" + number.format(was) + ")";
      } else cmp.textContent = "None in the " + between(d.before.from, d.before.to) + " days before";
      box.appendChild(cmp);
    }
    if (!d.first) box.appendChild(el("p", "No visits counted yet. Counting began when this map went live; it cannot see visits before that.", "note"));
    else if (d.first > from) box.appendChild(el("p", "Counting began on " + nice(d.first, true) + ", so there is nothing before then.", "note"));
  }

  function place(t) {
    return t[2] || t[1] || countryName(t[0]);
  }
  function where(t) {
    return [t[2] && t[1] !== t[2] ? t[1] : "", countryName(t[0])].filter(Boolean).join(", ");
  }

  var drawnPart = null;
  function drawMap(towns, total) {
    dots.clearLayers();
    var most = towns.length ? towns[0][5] : 1;
    var bounds = [];
    // Framed on the country most visits come from, when that is most of
    // them, so a few from far away do not shrink the rest to one blob.
    var byCountry = {};
    towns.forEach(function (t) {
      byCountry[t[0]] = (byCountry[t[0]] || 0) + t[5];
    });
    var main = Object.keys(byCountry).sort(function (a, b) {
      return byCountry[b] - byCountry[a];
    })[0];
    var frameOn = main && byCountry[main] >= total / 2 ? main : null;
    // Smallest last, so they sit on top and can still be pointed at.
    towns
      .filter(function (t) {
        return t[3] != null && t[4] != null;
      })
      .forEach(function (t) {
        var share = total ? Math.round((t[5] / total) * 1000) / 10 : 0;
        L.circleMarker([t[3], t[4]], {
          radius: 4 + 22 * Math.sqrt(t[5] / most),
          color: "#fff",
          weight: 1,
          fillColor: COLOURS[view.part],
          fillOpacity: 0.6,
        })
          .bindTooltip("<b>" + escape(place(t)) + "</b><br>" + escape(where(t)) + "<br>" + number.format(t[5]) + " visit" + (t[5] === 1 ? "" : "s") + " (" + share + "%)")
          .addTo(dots);
        if (!frameOn || t[0] === frameOn) bounds.push([t[3], t[4]]);
      });
    // Frame the dots when the part changes or on first drawing; otherwise
    // leave the map where it was put.
    if (bounds.length && drawnPart !== view.part) {
      if (bounds.length === 1) map.setView(bounds[0], 8);
      else map.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
    }
    drawnPart = view.part;
  }

  // Bars by day, or by week once the run is longer than three months.
  function chart(d, from) {
    var box = $("chart");
    box.replaceChildren();
    var counts = {};
    d.days.forEach(function (x) {
      counts[x[0]] = x[1];
    });
    var n = between(from, d.to);
    var weekly = n > 92;
    $("chart-title").textContent = weekly ? "Visits each week" : "Visits each day";
    var bars = [];
    for (var day = from; day <= d.to; day = addDays(day, 1)) {
      var v = counts[day] || 0;
      if (weekly && bars.length && new Date(day + "T00:00:00Z").getUTCDay() !== 1) bars[bars.length - 1].v += v;
      else bars.push({ day: day, v: v });
    }
    if (!bars.length) return;
    var most = Math.max.apply(null, bars.map(function (b) { return b.v; })) || 1;
    var W = 1000, H = 140, gap = bars.length > 60 ? 1 : 3, w = W / bars.length;
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + (weekly ? "Visits each week" : "Visits each day") + '">';
    bars.forEach(function (b, i) {
      var h = b.v ? Math.max(2, (b.v / most) * (H - 4)) : 0;
      svg +=
        '<rect x="' + (i * w + gap / 2).toFixed(2) + '" y="' + (H - h).toFixed(2) + '" width="' + Math.max(0.5, w - gap).toFixed(2) + '" height="' + h.toFixed(2) +
        '" fill="' + COLOURS[view.part] + '" rx="1.5"><title>' + (weekly ? "Week of " : "") + nice(b.day, true) + ": " + number.format(b.v) + "</title></rect>";
    });
    box.innerHTML = svg + "</svg>";
    var axis = el("div", null, "axis");
    axis.appendChild(el("span", nice(bars[0].day, false)));
    axis.appendChild(el("span", "busiest " + (weekly ? "week " : "day ") + number.format(most)));
    axis.appendChild(el("span", nice(bars[bars.length - 1].day, false)));
    box.appendChild(axis);
  }

  function tables(towns, total) {
    var pct = function (v) {
      return total ? Math.round((v / total) * 1000) / 10 + "%" : "";
    };
    // Towns: the first 25, then all of them on request.
    var box = $("towns");
    box.replaceChildren();
    if (!towns.length) {
      box.appendChild(el("p", "No visits in these dates.", "empty"));
      $("countries").replaceChildren(el("p", "None.", "empty"));
      return;
    }
    var shown = 25;
    var table = el("table");
    function fill() {
      table.innerHTML = '<thead><tr><th>Town</th><th class="n">Visits</th><th class="n">Share</th></tr></thead>';
      var body = el("tbody");
      towns.slice(0, shown).forEach(function (t) {
        var tr = el("tr");
        var td = el("td", place(t));
        td.appendChild(document.createElement("br"));
        td.appendChild(el("small", where(t)));
        tr.appendChild(td);
        tr.appendChild(el("td", number.format(t[5]), "n"));
        tr.appendChild(el("td", pct(t[5]), "n"));
        body.appendChild(tr);
      });
      table.appendChild(body);
    }
    fill();
    box.appendChild(table);
    if (towns.length > shown) {
      var more = el("button", "Show all " + number.format(towns.length) + " towns", "more");
      more.type = "button";
      more.addEventListener("click", function () {
        shown = towns.length;
        fill();
        more.remove();
      });
      box.appendChild(more);
    }

    // Countries, every one.
    var byCountry = {};
    towns.forEach(function (t) {
      byCountry[t[0]] = (byCountry[t[0]] || 0) + t[5];
    });
    var rows = Object.keys(byCountry).sort(function (a, b) {
      return byCountry[b] - byCountry[a];
    });
    var cbox = $("countries");
    cbox.replaceChildren();
    var ct = el("table");
    ct.innerHTML = '<thead><tr><th>Country</th><th class="n">Visits</th><th class="n">Share</th></tr></thead>';
    var cbody = el("tbody");
    rows.forEach(function (code) {
      var tr = el("tr");
      tr.appendChild(el("td", countryName(code)));
      tr.appendChild(el("td", number.format(byCountry[code]), "n"));
      tr.appendChild(el("td", pct(byCountry[code]), "n"));
      cbody.appendChild(tr);
    });
    ct.appendChild(cbody);
    cbox.appendChild(ct);
  }

  document.querySelectorAll(".seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      view.part = b.dataset.part;
      load();
    });
  });
  document.querySelectorAll(".chips button").forEach(function (b) {
    b.addEventListener("click", function () {
      view.days = b.dataset.days;
      load();
    });
  });
  ["from", "to"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      if (!$("from").value || !$("to").value) return;
      view.days = "";
      view.from = $("from").value;
      view.to = $("to").value;
      load();
    });
  });
  load();
})();
