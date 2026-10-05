/*
 * availability.html: the CheckedIn results page, framed.
 *
 * This page exists because the frame brings its own search bar. On
 * search-results.html that made two of them, one in the header and one inside
 * the frame, asking the same question. Here the widget's is the only one, and
 * the header keeps just the logo and the menu.
 *
 * Dates are optional. Without both of them the frame still goes in and the
 * widget says "Add your dates to see what's free", which is a better empty
 * state than anything this page could write.
 *
 * Three pages share this script, one per set of chrome: availability.html in
 * the core site's, oxford-availability.html in Oxford's, and
 * dorset-availability.html in Dorset's, so a search started in Oxford stays
 * in Oxford.
 *
 * Each page marks its slots with data-cin-account, because the CheckedIn
 * account is the only thing that differs between them: Oxford is 4 and Dorset
 * is 83. The sub-site pages have one slot each. The core page has both, one
 * after the other, and the heading above each is written in its markup rather
 * than here, because naming a place is content and belongs in the HTML.
 */
(function () {
  "use strict";

  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  var slots = document.querySelectorAll("[data-cin-account]");
  if (!slots.length) return;

  var params = new URLSearchParams(window.location.search);

  /* A head count from the address: the named parameter, then the one it falls
     back to, then a default. Anything that is not a whole number is treated as
     absent rather than passed on. */
  function count(value, fallback, dflt) {
    var n = parseInt(value, 10);
    if (isNaN(n) || n < 0) n = parseInt(fallback, 10);
    if (isNaN(n) || n < 0) n = dflt;
    return n;
  }

  var from = (params.get("from") || "").trim();
  var to = (params.get("to") || "").trim();
  var guests = "&adults=" + count(params.get("adults"), params.get("guests"), 2) +
               "&kids=" + count(params.get("children"), null, 0);
  // Half a date, or something that is not one, is no date: let the widget ask.
  var dates = ISO_DATE.test(from) && ISO_DATE.test(to)
    ? "&checkInDate=" + encodeURIComponent(from) +
      "&checkOutDate=" + encodeURIComponent(to)
    : "";

  // Every frame this page made, so a height posted by one of them can be
  // matched to it and to no other.
  var frames = [];

  for (var i = 0; i < slots.length; i++) {
    var slot = slots[i];
    var account = (slot.getAttribute("data-cin-account") || "").trim();
    // A slot with no account renders nothing rather than another place's
    // results under this one's heading.
    if (!/^\d+$/.test(account)) continue;

    // The frame starts tall and then takes the height the widget posts.
    // Eager: there is nothing else on the page to load first.
    var frame = document.createElement("iframe");
    frame.className = "pp-results";
    frame.src = "https://checked.in/widget/results/" + account +
                "?preset=cedarhollow" + dates + guests;
    frame.title = "What’s free for your dates";
    frame.loading = "eager";
    frame.setAttribute("style", "width:100%;border:0;display:block;height:900px");
    slot.appendChild(frame);
    frames.push(frame);
  }

  if (!frames.length) return;

  /*
   * The widget measures itself once it knows how wide its slot is and posts
   * { cinStripHeight: <px> }. Only the frame that sent the message is resized,
   * matched by its window, so neither one can resize the other.
   *
   * The 6000px ceiling is deliberately generous. CheckedIn's own snippet uses
   * 2000, which is right for a calendar and wrong here: at 390px wide the
   * results page stacks every free property and posts over 2100, and a tighter
   * ceiling throws that away and leaves the frame at its starting height with
   * the rest behind an inner scrollbar.
   */
  window.addEventListener("message", function (e) {
    var height = e.data && e.data.cinStripHeight;
    if (typeof height !== "number" || height < 80 || height > 6000) return;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        frames[i].style.height = height + "px";
        return;
      }
    }
  });
})();
