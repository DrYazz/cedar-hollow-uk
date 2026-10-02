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
 * in Oxford. Each names its own CheckedIn account on the slot, because the
 * account is the only thing that differs between them.
 *
 * Dorset has no account id yet, so its page declares none and this renders no
 * frame rather than Oxford's results under a Dorset header. js/search-bar.js
 * still routes Dorset searches to the cards, so nobody reaches it by
 * searching; it is here so that becomes one line when the id arrives.
 */
(function () {
  "use strict";

  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  var slot = document.getElementById("av-frame");
  if (!slot) return;

  var account = (slot.getAttribute("data-cin-account") || "").trim();
  if (!/^\d+$/.test(account)) return;

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

  var src = "https://checked.in/widget/results/" + account + "?preset=cedarhollow";
  // Half a date, or something that is not one, is no date: let the widget ask.
  if (ISO_DATE.test(from) && ISO_DATE.test(to)) {
    src += "&checkInDate=" + encodeURIComponent(from) +
           "&checkOutDate=" + encodeURIComponent(to);
  }
  src += "&adults=" + count(params.get("adults"), params.get("guests"), 2) +
         "&kids=" + count(params.get("children"), null, 0);

  // The frame starts tall and then takes the height the widget posts. Eager,
  // because it is the only thing on the page.
  var frame = document.createElement("iframe");
  frame.className = "pp-results";
  frame.src = src;
  frame.title = "What’s free for your dates";
  frame.loading = "eager";
  frame.setAttribute("style",
    "width:100%;border:0;display:block;height:900px");
  slot.appendChild(frame);

  /*
   * The widget measures itself once it knows how wide its slot is and posts
   * { cinStripHeight: <px> }. Only the frame that sent the message is resized,
   * matched by its window, so nothing else can resize it.
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
    if (frame.contentWindow !== e.source) return;
    frame.style.height = height + "px";
  });
})();
