/* ---------------------------------------------------------------------------
   Availability search bar: date range picker and guest stepper.
   Figma: Search bar 280:293, Picker: When 281:1111, Picker: Who 282:1315.

   Progressive enhancement. The page ships a working native form -- a date
   input and a guest <select> -- and this script swaps them for the designed
   pickers. With script off the form still submits, which is why the markup is
   not written here in the first place.

   Both panels are fixed and parented to <body> rather than to the bar, so no
   ancestor's overflow can clip them.
   --------------------------------------------------------------------------- */
(function () {
  "use strict";

  var form = document.querySelector(".ch-search__bar");
  if (!form) return;

  var whenSeg = form.querySelector("#ch-search-when");
  var whoSeg = form.querySelector("#ch-search-who");
  if (!whenSeg || !whoSeg) return;

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul",
               "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  var MONTHS_AHEAD = 18;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var state = {
    start: null, end: null, hover: null,
    adults: 2, children: 0, infants: 0, pets: 0
  };

  var LIMITS = { adults: [1, 8], children: [0, 6], infants: [0, 4], pets: [0, 3] };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function same(a, b) { return a && b && a.getTime() === b.getTime(); }
  function nights(a, b) { return Math.round((b - a) / 86400000); }
  function col(d) { return (d.getDay() + 6) % 7; }   // Monday-first column
  function parse(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }

  /* ---- hidden fields ------------------------------------------------------ */

  var fields = {};
  ["from", "to", "guests", "adults", "children", "infants", "pets"].forEach(function (n) {
    var el = document.createElement("input");
    el.type = "hidden";
    el.name = n;
    fields[n] = el;
  });

  /* ---- the two triggers --------------------------------------------------- */

  function trigger(labelText, picker) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ch-search__trigger";
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-haspopup", "dialog");
    b.dataset.picker = picker;
    var l = document.createElement("span");
    l.className = "ch-search__label";
    l.textContent = labelText;
    var v = document.createElement("span");
    v.className = "ch-search__value";
    b.appendChild(l);
    b.appendChild(v);
    return { button: b, value: v };
  }

  var whenSegWrap = whenSeg.closest(".ch-search__seg");
  var whoSegWrap = whoSeg.closest(".ch-search__seg");

  var whenUI = trigger("When", "when");
  var whoUI = trigger("Who", "who");

  whenSegWrap.innerHTML = "";
  whenSegWrap.appendChild(whenUI.button);
  whoSegWrap.innerHTML = "";
  whoSegWrap.appendChild(whoUI.button);

  Object.keys(fields).forEach(function (n) { form.appendChild(fields[n]); });

  var search = form.closest(".ch-search") || form;

  /* ---- panels ------------------------------------------------------------- */

  var whenPanel = document.createElement("div");
  whenPanel.className = "ch-pick ch-pick--when";
  whenPanel.setAttribute("role", "dialog");
  whenPanel.setAttribute("aria-label", "Choose your dates");
  whenPanel.hidden = true;

  var whoPanel = document.createElement("div");
  whoPanel.className = "ch-pick ch-pick--who";
  whoPanel.setAttribute("role", "dialog");
  whoPanel.setAttribute("aria-label", "Who is coming");
  whoPanel.hidden = true;

  document.body.appendChild(whenPanel);
  document.body.appendChild(whoPanel);

  /* ---- When: month list + scrolling calendar ------------------------------ */

  var monthList = document.createElement("div");
  monthList.className = "ch-pick__months";
  var mark = document.createElement("span");
  mark.className = "ch-pick__month-mark";
  monthList.appendChild(mark);

  var cal = document.createElement("div");
  cal.className = "ch-pick__cal";

  var weekdays = document.createElement("div");
  weekdays.className = "ch-pick__weekdays";
  WEEKDAYS.forEach(function (w) {
    var s = document.createElement("span");
    s.textContent = w;
    weekdays.appendChild(s);
  });

  var scroll = document.createElement("div");
  scroll.className = "ch-pick__scroll";
  cal.appendChild(weekdays);
  cal.appendChild(scroll);

  var foot = document.createElement("div");
  foot.className = "ch-pick__foot";
  var nightsEl = document.createElement("span");
  nightsEl.className = "ch-pick__nights";
  var clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "ch-pick__clear";
  clearBtn.textContent = "Clear dates";
  foot.appendChild(nightsEl);
  foot.appendChild(clearBtn);

  whenPanel.appendChild(monthList);
  whenPanel.appendChild(cal);
  whenPanel.appendChild(foot);

  var monthBlocks = [];
  var monthButtons = [];

  (function buildMonths() {
    var base = new Date(today.getFullYear(), today.getMonth(), 1);
    for (var i = 0; i < MONTHS_AHEAD; i++) {
      var m = new Date(base.getFullYear(), base.getMonth() + i, 1);

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ch-pick__month-btn";
      // The year is only worth the width once it stops being obvious.
      btn.textContent = m.getFullYear() === today.getFullYear()
        ? MONTHS[m.getMonth()]
        : MONTHS[m.getMonth()] + " " + m.getFullYear();
      btn.addEventListener("click", function (idx) {
        return function () {
          scroll.scrollTo({ top: monthBlocks[idx].offsetTop - 6, behavior: "smooth" });
        };
      }(i));
      monthList.appendChild(btn);
      monthButtons.push(btn);

      var block = document.createElement("div");
      block.className = "ch-pick__block";

      var label = document.createElement("div");
      label.className = "ch-pick__mlabel";
      label.textContent = MONTHS[m.getMonth()].toUpperCase() + " " + m.getFullYear();
      block.appendChild(label);

      var grid = document.createElement("div");
      grid.className = "ch-pick__grid";

      var lead = col(new Date(m.getFullYear(), m.getMonth(), 1));
      for (var b = 0; b < lead; b++) {
        var blank = document.createElement("span");
        blank.className = "ch-pick__cell is-empty";
        grid.appendChild(blank);
      }
      var daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      for (var d = 1; d <= daysIn; d++) {
        var date = new Date(m.getFullYear(), m.getMonth(), d);
        var cell = document.createElement("span");
        cell.className = "ch-pick__cell";
        var day = document.createElement("button");
        day.type = "button";
        day.className = "ch-pick__day";
        day.textContent = d;
        day.dataset.date = ymd(date);
        day.setAttribute("aria-label", d + " " + MONTHS[m.getMonth()] + " " + m.getFullYear());
        if (date < today) day.disabled = true;
        cell.appendChild(day);
        grid.appendChild(cell);
      }
      block.appendChild(grid);
      scroll.appendChild(block);
      monthBlocks.push(block);
    }
  })();

  scroll.addEventListener("click", function (e) {
    var day = e.target.closest(".ch-pick__day");
    if (!day || day.disabled) return;
    var date = parse(day.dataset.date);
    if (!state.start || state.end || date <= state.start) {
      state.start = date;
      state.end = null;
    } else {
      state.end = date;
    }
    state.hover = null;
    paintDates();
    commit();
  });

  scroll.addEventListener("mouseover", function (e) {
    if (!state.start || state.end) return;
    var day = e.target.closest(".ch-pick__day");
    if (!day || day.disabled) return;
    state.hover = parse(day.dataset.date);
    paintDates();
  });

  scroll.addEventListener("mouseleave", function () {
    if (state.hover) { state.hover = null; paintDates(); }
  });

  clearBtn.addEventListener("click", function () {
    state.start = state.end = state.hover = null;
    paintDates();
    commit();
  });

  function paintDates() {
    var end = state.end || state.hover;
    var lo = state.start;
    var hi = end;
    if (lo && hi && hi < lo) { var t = lo; lo = hi; hi = t; }

    // The pill spans the nights, so it stops the day before checkout.
    var lastNight = hi ? new Date(hi.getFullYear(), hi.getMonth(), hi.getDate() - 1) : null;

    Array.prototype.forEach.call(scroll.querySelectorAll(".ch-pick__cell"), function (cell) {
      cell.classList.remove("is-pill", "is-start", "is-end", "is-pill-left", "is-pill-right");
      var day = cell.querySelector(".ch-pick__day");
      if (!day) return;
      var date = parse(day.dataset.date);

      var isStart = same(date, lo);
      var isEnd = same(date, hi);
      var inPill = lo && lastNight && date >= lo && date <= lastNight;

      if (isStart) cell.classList.add("is-start");
      if (isEnd) cell.classList.add("is-end");

      if (inPill) {
        cell.classList.add("is-pill");
        var column = Array.prototype.indexOf.call(cell.parentNode.children, cell) % 7;
        if (isStart || column === 0) cell.classList.add("is-pill-left");
        if (same(date, lastNight) || column === 6) cell.classList.add("is-pill-right");
      }
    });

    if (state.start && state.end) {
      var n = nights(state.start, state.end);
      nightsEl.textContent = n + (n === 1 ? " night" : " nights");
    } else {
      nightsEl.textContent = state.start ? "Pick a checkout date" : "";
    }
    whenUI.value.textContent = dateLabel();
    whenUI.value.classList.toggle("is-empty", !state.start);
  }

  function dateLabel() {
    if (!state.start) return "Add dates";
    var a = state.start;
    if (!state.end) return SHORT[a.getMonth()] + " " + a.getDate();
    var b = state.end;
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear())
      return SHORT[a.getMonth()] + " " + a.getDate() + " – " + b.getDate();
    return SHORT[a.getMonth()] + " " + a.getDate() + " – " +
           SHORT[b.getMonth()] + " " + b.getDate();
  }

  /* The bar in the month list spans every month the calendar is showing, so
     it grows to two rows when a scroll position straddles a boundary. */
  function syncMark() {
    if (!monthBlocks.length) return;
    var top = scroll.scrollTop;
    var bottom = top + scroll.clientHeight;
    var first = -1, last = -1;
    monthBlocks.forEach(function (b, i) {
      if (b.offsetTop + b.offsetHeight > top + 4 && b.offsetTop < bottom - 4) {
        if (first === -1) first = i;
        last = i;
      }
    });
    if (first === -1) return;
    var a = monthButtons[first];
    var z = monthButtons[last];
    mark.style.top = (a.offsetTop - monthList.scrollTop) + "px";
    mark.style.height = (z.offsetTop + z.offsetHeight - a.offsetTop) + "px";
  }

  scroll.addEventListener("scroll", syncMark);
  monthList.addEventListener("scroll", syncMark);

  /* ---- Who: four stepper rows -------------------------------------------- */

  var ROWS = [
    { key: "adults", name: "Adults", note: "Ages 13 or above" },
    { key: "children", name: "Children", note: "Ages 2-12" },
    { key: "infants", name: "Infants", note: "Under 2" },
    { key: "pets", name: "Pets", note: "Bringing a service animal?", link: true }
  ];

  var counts = {};

  ROWS.forEach(function (row) {
    var wrap = document.createElement("div");
    wrap.className = "ch-pick__row";

    var text = document.createElement("div");
    var name = document.createElement("div");
    name.className = "ch-pick__rowname";
    name.textContent = row.name;
    var note = document.createElement("div");
    note.className = "ch-pick__rownote";
    if (row.link) {
      var a = document.createElement("a");
      a.href = "accessibility.html";
      a.textContent = row.note;
      note.appendChild(a);
    } else {
      note.textContent = row.note;
    }
    text.appendChild(name);
    text.appendChild(note);

    var step = document.createElement("div");
    step.className = "ch-pick__step";
    var minus = stepButton("minus", row.name);
    var count = document.createElement("span");
    count.className = "ch-pick__count";
    var plus = stepButton("plus", row.name);
    step.appendChild(minus);
    step.appendChild(count);
    step.appendChild(plus);

    minus.addEventListener("click", function () { bump(row.key, -1); });
    plus.addEventListener("click", function () { bump(row.key, 1); });
    counts[row.key] = { count: count, minus: minus, plus: plus };

    wrap.appendChild(text);
    wrap.appendChild(step);
    whoPanel.appendChild(wrap);
  });

  function stepButton(kind, rowName) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ch-pick__stepbtn";
    b.setAttribute("aria-label", (kind === "plus" ? "Add " : "Remove ") + rowName.toLowerCase());
    b.innerHTML = kind === "plus"
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8h14" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
    return b;
  }

  function bump(key, delta) {
    var range = LIMITS[key];
    var next = state[key] + delta;
    if (next < range[0] || next > range[1]) return;
    state[key] = next;
    paintGuests();
    commit();
  }

  function paintGuests() {
    Object.keys(counts).forEach(function (key) {
      var c = counts[key];
      c.count.textContent = state[key];
      c.minus.disabled = state[key] <= LIMITS[key][0];
      c.plus.disabled = state[key] >= LIMITS[key][1];
    });
    whoUI.value.textContent = whoLabel();
  }

  function whoLabel() {
    var guests = state.adults + state.children;
    var out = state.children === 0
      ? guests + (guests === 1 ? " adult" : " adults")
      : guests + (guests === 1 ? " guest" : " guests");
    if (state.infants) out += ", " + state.infants + (state.infants === 1 ? " infant" : " infants");
    if (state.pets) out += ", " + state.pets + (state.pets === 1 ? " pet" : " pets");
    return out;
  }

  /* ---- writing back to the form ------------------------------------------ */

  function commit() {
    fields.from.value = state.start ? ymd(state.start) : "";
    fields.to.value = state.end ? ymd(state.end) : "";
    fields.guests.value = state.adults + state.children;
    fields.adults.value = state.adults;
    fields.children.value = state.children;
    fields.infants.value = state.infants;
    fields.pets.value = state.pets;
  }

  form.addEventListener("submit", function () {
    // guests carries the headline number; the breakdown only earns its place
    // in the query string when there is something to break down.
    ["from", "to"].forEach(function (n) {
      if (!fields[n].value) fields[n].disabled = true;
    });
    ["children", "infants", "pets"].forEach(function (n) {
      if (fields[n].value === "0") fields[n].disabled = true;
    });
  });

  /* ---- open / close ------------------------------------------------------- */

  var open = null;
  var GAP = 12;
  var EDGE = 8;

  /* Pins a panel to the bar: When to its left edge, Who to its right, as the
     design shows. Opens downward when there is room, flips above when there is
     not, and only as a last resort caps the height and lets the calendar
     scroll inside -- which beats running off the screen. */
  function place(which) {
    var panel = which === "when" ? whenPanel : whoPanel;
    var bar = form.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;

    panel.style.maxHeight = "";
    panel.style.width = "";
    if (vw <= 640) panel.style.width = (vw - EDGE * 2) + "px";

    var w = panel.offsetWidth;
    var h = panel.offsetHeight;

    var left = vw <= 640 ? EDGE : (which === "when" ? bar.left : bar.right - w);
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));

    var below = vh - bar.bottom - GAP - EDGE;
    var above = bar.top - GAP - EDGE;
    var top;
    if (h <= below) {
      top = bar.bottom + GAP;
    } else if (h <= above) {
      top = bar.top - GAP - h;
    } else if (above > below) {
      panel.style.maxHeight = above + "px";
      top = EDGE;
    } else {
      panel.style.maxHeight = below + "px";
      top = bar.bottom + GAP;
    }

    panel.style.left = Math.round(left) + "px";
    panel.style.top = Math.round(top) + "px";
  }

  function show(which) {
    close();
    open = which;
    var panel = which === "when" ? whenPanel : whoPanel;
    var btn = which === "when" ? whenUI.button : whoUI.button;
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    place(which);
    if (which === "when") {
      // Land on the first month rather than wherever it was left.
      if (!state.start) scroll.scrollTop = 0;
      syncMark();
    }
  }

  function close() {
    if (!open) return;
    var panel = open === "when" ? whenPanel : whoPanel;
    var btn = open === "when" ? whenUI.button : whoUI.button;
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    open = null;
  }

  [whenUI.button, whoUI.button].forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var which = btn.dataset.picker;
      if (open === which) close(); else show(which);
    });
  });

  [whenPanel, whoPanel].forEach(function (p) {
    p.addEventListener("click", function (e) { e.stopPropagation(); });
  });

  document.addEventListener("click", function (e) {
    // The panels no longer live inside .ch-search, so they need naming here.
    if (open && !search.contains(e.target) &&
        !whenPanel.contains(e.target) && !whoPanel.contains(e.target)) close();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) {
      var btn = open === "when" ? whenUI.button : whoUI.button;
      close();
      btn.focus();
    }
  });

  window.addEventListener("resize", function () { if (open) place(open); });
  window.addEventListener("scroll", function () { if (open) place(open); }, { passive: true });

  paintDates();
  paintGuests();
  commit();
})();
