/*
 * The private page's Honey tab: the honey page's own figures, from
 * /wdtcf/honey. A scan is a visit opening cedarhollow.uk/honey, which the
 * code on the honesty box leads to; these are counted on their own and in
 * none of the other tabs. Shown: scans today, in the last 7 and 30 days, and
 * how many of those went on anywhere; how many pressed each of the page's
 * buttons, and what share of the visits that is -- Choose your honey and
 * Donate first; the year's scans month by month; and where else the visits
 * went from the honey page -- pages of the site, and other links off it. Drawn the first time the tab is shown, and again every five
 * minutes while it is in view.
 */
(function () {
  "use strict";

  var $ = function (id) {
    return document.getElementById(id);
  };
  var number = new Intl.NumberFormat("en-GB");
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var EVERY = 5 * 60 * 1000;
  var state = { year: null, at: 0 };

  // Where a visit went, in words: a link by its host and path, a page by its
  // name where it has an obvious one, else its address.
  var LINKS = [
    [/^theoaks\.menulab\.com\/menu\/shotover-honey/, "Honey shop (Choose your honey)"],
    [/menulab\.com/, "Menulab"],
    [/^pay\.sumup\.com/, "Donate to the Shotover Preservation Society (SumUp)"],
    [/shotoverpreservation\.uk|shotover\.net/, "Shotover Preservation Society’s website"],
    [/^wa\.me/, "WhatsApp message"],
    [/instagram\.com/, "Instagram"],
    [/tiktok\.com/, "TikTok"],
    [/youtube\.com/, "YouTube"],
    [/facebook\.com/, "Facebook"],
    [/tripadvisor\./, "Tripadvisor"],
    [/wizardsofox\.uk/, "Wizards of Ox"],
    [/^email$/, "Email to hello@cedarhollow.uk"],
    [/^phone$/, "Phone call"],
  ];
  var PAGES = {
    "/oxford/honey.html": "About our honey",
    "/oxford.html": "Cedar Hollow Oxford",
    "/dorset.html": "Cedar Hollow Dorset",
    "/index.html": "Cedar Hollow home page",
    "/": "Cedar Hollow home page",
    "/oxford/accessibility.html": "Accessibility",
    "/privacy-policy.html": "Privacy Policy",
    "/terms-of-service.html": "Terms of Service",
    "/cookies.html": "Cookies Policy",
  };
  // The honey page's buttons, by their data-honey names, in page order but
  // for the two that matter most, which lead.
  var BUTTONS = [
    ["purchase", "Choose your honey", "The button to buy honey, on Menulab"],
    ["donate", "Donate to the Shotover Preservation Society", "To SumUp"],
    ["proceeds", "“All proceeds donated to the Shotover Preservation Society”", "The link in the introduction, to the society’s website"],
    ["society", "About the Shotover Preservation Society", "To the society’s website"],
    ["about-honey", "About our honey", "Our Oxford honey page"],
    ["whatsapp", "WhatsApp number", "075 11 22 33 75, at the foot of the page"],
    ["email", "Email address", "hello@cedarhollow.uk, at the foot of the page"],
  ];
  function pct(n, of) {
    return of ? Math.round((100 * n) / of) + "%" : "–";
  }

  function name(kind, target) {
    if (kind === "next") return PAGES[target] || target;
    for (var i = 0; i < LINKS.length; i++) if (LINKS[i][0].test(target)) return LINKS[i][1];
    return target;
  }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function nice(day) {
    return new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }

  function load() {
    state.at = Date.now();
    var q = state.year ? "?year=" + state.year : "";
    fetch("/wdtcf/honey" + q, { credentials: "same-origin", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("The honey figures could not be read (" + res.status + ").");
        return res.json();
      })
      .then(draw)
      .catch(function (err) {
        $("honey-stats").replaceChildren(el("p", err.message || "The honey figures could not be read.", "note"));
      });
  }

  function draw(d) {
    state.year = d.year;
    var t = d.totals;

    // ---- three figures ------------------------------------------------------
    var box = $("honey-stats");
    box.replaceChildren();
    [["Today", "today"], ["Last 7 days", "week"], ["Last 30 days", "month"]].forEach(function (s) {
      var card = el("div", null, "honey-card");
      card.appendChild(el("div", number.format(t.scan[s[1]]), "big"));
      card.appendChild(el("div", "scan" + (t.scan[s[1]] === 1 ? "" : "s") + " · " + s[0].toLowerCase(), "stat"));
      var on = t.on[s[1]];
      card.appendChild(el("div", t.scan[s[1]] ? number.format(on) + " went on from the page" : "", "honey-on"));
      box.appendChild(card);
    });
    $("honey-note").textContent = d.first
      ? "Counting began on " + nice(d.first) + "."
      : "No scans counted yet. Counting began when this tab went live; it cannot see visits before that.";

    // ---- the buttons ----------------------------------------------------------
    // Each press counts once a visit, so a share is of the visits (scans) in
    // the same days.
    var yearScans = d.months.reduce(function (n, m) { return n + m[0]; }, 0);
    var pressed = {};
    (d.presses || []).forEach(function (r) {
      pressed[r[0]] = { today: r[1], week: r[2], month: r[3], year: r[4] };
    });
    var zero = { today: 0, week: 0, month: 0, year: 0 };
    var key = $("honey-key");
    key.replaceChildren();
    BUTTONS.slice(0, 2).forEach(function (b) {
      var p = pressed[b[0]] || zero;
      var card = el("div");
      card.appendChild(el("div", pct(p.month, t.scan.month), "big"));
      card.appendChild(el("div", "of visitors pressed " + b[1], "what"));
      card.appendChild(el("div",
        number.format(p.month) + " of " + number.format(t.scan.month) + " in the last 30 days · last 7 days " + pct(p.week, t.scan.week) +
        " · " + d.year + " " + pct(p.year, yearScans), "honey-more"));
      key.appendChild(card);
    });
    var table = el("table");
    table.innerHTML = '<thead><tr><th>Button</th><th class="n">7 days</th><th class="n">30 days</th><th class="n">' + d.year + "</th></tr></thead>";
    var body = el("tbody");
    BUTTONS.forEach(function (b) {
      var p = pressed[b[0]] || zero;
      var tr = el("tr");
      var td = el("td", b[1]);
      td.appendChild(document.createElement("br"));
      td.appendChild(el("small", b[2]));
      tr.appendChild(td);
      [[p.week, t.scan.week], [p.month, t.scan.month], [p.year, yearScans]].forEach(function (c) {
        var cell = el("td", number.format(c[0]), "n");
        cell.appendChild(el("small", pct(c[0], c[1])));
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    $("honey-presses").replaceChildren(table);
    $("honey-press-note").textContent =
      "Each visitor counts once for each button they press, however often they press it; the share is of all the visitors (scans) in the same days.";

    // ---- the year, month by month -------------------------------------------
    $("honey-months-title").textContent = "Scans each month, " + d.year;
    var years = $("honey-years");
    years.replaceChildren();
    if (d.years.length > 1) {
      d.years.forEach(function (y) {
        var b = el("button", y);
        b.type = "button";
        b.setAttribute("aria-pressed", String(y === d.year));
        b.addEventListener("click", function () {
          state.year = y;
          load();
        });
        years.appendChild(b);
      });
    }
    // Twelve columns of the page's own type, so the figures stay legible on
    // a phone, where a drawn chart would shrink them.
    var scans = d.months.map(function (m) { return m[0]; });
    var most = Math.max.apply(null, scans) || 1;
    var thisMonth = d.today.slice(0, 4) === d.year ? Number(d.today.slice(5, 7)) - 1 : -1;
    var chart = el("div", null, "honey-chart");
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", "Scans each month of " + d.year + ": " + MONTHS.map(function (m, i) { return m + " " + scans[i]; }).join(", "));
    scans.forEach(function (n, i) {
      var col = el("div", null, "honey-col" + (i === thisMonth ? " is-now" : ""));
      col.setAttribute("aria-hidden", "true");
      col.appendChild(el("span", n ? number.format(n) : "", "honey-n"));
      var bar = el("span", null, "honey-bar");
      bar.style.height = (n ? Math.max(2, (n / most) * 100) : 0) + "%";
      col.appendChild(bar);
      col.appendChild(el("span", MONTHS[i], "honey-m"));
      chart.appendChild(col);
    });
    $("honey-months").replaceChildren(chart);
    if (thisMonth >= 0) $("honey-months").appendChild(el("p", "This month, in gold, is the month so far.", "note"));

    // ---- where they went -----------------------------------------------------
    var share = t.scan.month ? Math.round((t.on.month / t.scan.month) * 100) : 0;
    $("honey-went-note").textContent = t.scan.month
      ? number.format(t.on.month) + " of the " + number.format(t.scan.month) + " scans in the last 30 days (" + share + "%) went on from the honey page: to another page of the site, or a link off it. Each place counts once a visit."
      : "Nobody has gone on from the honey page in the last 30 days.";
    // One table, so the two groups' figures line up.
    var went = $("honey-went");
    went.replaceChildren();
    var table = el("table");
    table.innerHTML = '<thead><tr><th>Went to</th><th class="n">Last 30 days</th><th class="n">' + d.year + "</th></tr></thead>";
    [["out", "Other links off the honey page"], ["next", "Pages of the site"]].forEach(function (g) {
      var rows = d.went.filter(function (r) { return r[0] === g[0]; });
      if (!rows.length) return;
      var body = el("tbody");
      var head = el("tr", null, "honey-group");
      var th = el("th", g[1]);
      th.colSpan = 3;
      head.appendChild(th);
      body.appendChild(head);
      rows.forEach(function (r) {
        var tr = el("tr");
        var td = el("td", name(r[0], r[1]));
        if (name(r[0], r[1]) !== r[1]) {
          td.appendChild(document.createElement("br"));
          td.appendChild(el("small", r[1]));
        }
        tr.appendChild(td);
        tr.appendChild(el("td", number.format(r[2]), "n"));
        tr.appendChild(el("td", number.format(r[3]), "n"));
        body.appendChild(tr);
      });
      table.appendChild(body);
    });
    if (table.tBodies.length) went.appendChild(table);
    else went.appendChild(el("p", "Nowhere yet.", "empty"));
  }

  // Called by stats.js whenever the tab is shown; fetched again if it is
  // older than five minutes.
  window.wdtcfShowHoney = function () {
    if (!state.at || Date.now() - state.at >= EVERY) load();
  };
  setInterval(function () {
    if (!document.hidden && !$("panel-honey").hidden && Date.now() - state.at >= EVERY) load();
  }, 30 * 1000);
})();
