/* ---------------------------------------------------------------------------
   Booking panel. "Book a stay" in the nav opens one dropdown carrying the date
   picker and the guest steppers, anchored to the button's top-right corner.
   Figma: Picker: When 281:1111, Picker: Who 282:1315.

   Progressive enhancement. The page ships a working native form -- a search
   bar in the hero with a date input and a guest <select> -- and a nav link
   that goes straight to the property list. This script takes the form over,
   moves it into the panel and hides the bar. With script off both still work.
   --------------------------------------------------------------------------- */
(function () {
  "use strict";

  var form = document.querySelector(".ch-search__bar");
  var navBook = document.querySelector(".ch-nav__book");
  if (!form || !navBook) return;

  var whenInput = form.querySelector("#ch-search-when");
  var whoSelect = form.querySelector("#ch-search-who");
  if (!whenInput || !whoSelect) return;

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

  /* ---- panel shell ------------------------------------------------------- */

  var panel = document.createElement("div");
  panel.className = "ch-book";
  panel.id = "ch-book-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Book a stay");
  panel.hidden = true;
  document.body.appendChild(panel);

  // The form moves in whole, so the submit button still submits it and the
  // destination hidden field rides along untouched.
  panel.appendChild(form);
  form.className = "ch-book__form";
  Array.prototype.slice.call(form.children).forEach(function (child) {
    if (child.tagName !== "INPUT" || child.type !== "hidden") child.remove();
  });

  var fields = {};
  ["from", "to", "guests", "adults", "children", "infants", "pets"].forEach(function (n) {
    var el = document.createElement("input");
    el.type = "hidden";
    el.name = n;
    fields[n] = el;
    form.appendChild(el);
  });

  function heading(text) {
    var h = document.createElement("div");
    h.className = "ch-book__label";
    h.textContent = text;
    return h;
  }

  /* ---- dates ------------------------------------------------------------- */

  form.appendChild(heading("When"));

  var calWrap = document.createElement("div");
  calWrap.className = "ch-book__cal";

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
  calWrap.appendChild(monthList);
  calWrap.appendChild(cal);
  form.appendChild(calWrap);

  var datesFoot = document.createElement("div");
  datesFoot.className = "ch-book__dates-foot";
  var nightsEl = document.createElement("span");
  nightsEl.className = "ch-pick__nights";
  var clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "ch-pick__clear";
  clearBtn.textContent = "Clear dates";
  datesFoot.appendChild(nightsEl);
  datesFoot.appendChild(clearBtn);
  form.appendChild(datesFoot);

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
    syncTrigger();
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

  /* ---- guests ------------------------------------------------------------ */

  var rule = document.createElement("div");
  rule.className = "ch-book__rule";
  form.appendChild(rule);
  form.appendChild(heading("Who"));

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
    form.appendChild(wrap);
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
    syncTrigger();
  }

  /* ---- submit ------------------------------------------------------------ */

  var submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "ch-book__submit";
  submit.innerHTML = '<svg viewBox="0 0 27 27" fill="none" aria-hidden="true">' +
    '<path d="M11.194 22.3881C13.6777 22.3876 16.0897 21.5561 18.0462 20.0261L24.1973 26.1772L26.1758 24.1987L20.0247 18.0476C21.5555 16.0909 22.3875 13.6783 22.3881 11.194C22.3881 5.02192 17.3661 0 11.194 0C5.02192 0 0 5.02192 0 11.194C0 17.3661 5.02192 22.3881 11.194 22.3881ZM11.194 2.79851C15.8242 2.79851 19.5896 6.5639 19.5896 11.194C19.5896 15.8242 15.8242 19.5896 11.194 19.5896C6.5639 19.5896 2.79851 15.8242 2.79851 11.194C2.79851 6.5639 6.5639 2.79851 11.194 2.79851Z" fill="currentColor"/></svg>' +
    '<span>Search</span>';
  form.appendChild(submit);

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

  /* ---- trigger label ----------------------------------------------------- */

  function dateLabel() {
    if (!state.start) return null;
    var a = state.start;
    if (!state.end) return SHORT[a.getMonth()] + " " + a.getDate();
    var b = state.end;
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear())
      return SHORT[a.getMonth()] + " " + a.getDate() + " – " + b.getDate();
    return SHORT[a.getMonth()] + " " + a.getDate() + " – " + SHORT[b.getMonth()] + " " + b.getDate();
  }

  /* The trigger keeps its label; what is chosen shows inside the panel and in
     the dates line under the calendar. */
  function syncTrigger() {
    var dates = dateLabel();
    navBook.setAttribute("aria-label", dates
      ? "Book a stay, " + dates + ", " + (state.adults + state.children) + " guests"
      : "Book a stay");
  }

  /* ---- open / close ------------------------------------------------------ */

  var open = false;
  var GAP = 10;
  var EDGE = 8;

  // Lines the panel up with the right edge of the nav group rather than the
  // button, so it finishes flush with the burger and the page margin instead
  // of stopping short of them.
  var anchor = navBook.closest(".ch-nav__actions") || navBook;

  function place() {
    var a = anchor.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;

    panel.style.maxHeight = (vh - a.bottom - GAP - EDGE) + "px";

    var w = panel.offsetWidth;
    var left = Math.max(EDGE, Math.min(a.right - w, vw - w - EDGE));
    panel.style.left = Math.round(left) + "px";
    panel.style.top = Math.round(a.bottom + GAP) + "px";
  }

  function show() {
    open = true;
    panel.hidden = false;
    navBook.setAttribute("aria-expanded", "true");
    place();
    if (!state.start) scroll.scrollTop = 0;
    syncMark();
  }

  function close() {
    if (!open) return;
    open = false;
    panel.hidden = true;
    navBook.setAttribute("aria-expanded", "false");
  }

  navBook.setAttribute("role", "button");
  navBook.setAttribute("aria-expanded", "false");
  navBook.setAttribute("aria-controls", "ch-book-panel");
  navBook.addEventListener("click", function (e) {
    e.preventDefault();          // it is a real link until script takes over
    e.stopPropagation();
    if (open) close(); else show();
  });

  panel.addEventListener("click", function (e) { e.stopPropagation(); });

  document.addEventListener("click", function (e) {
    if (open && !panel.contains(e.target) && e.target !== navBook) close();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) { close(); navBook.focus(); }
  });

  window.addEventListener("resize", function () { if (open) place(); });
  window.addEventListener("scroll", function () { if (open) place(); }, { passive: true });

  paintDates();
  paintGuests();
  commit();
})();
