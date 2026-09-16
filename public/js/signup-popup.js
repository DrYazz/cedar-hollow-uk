/*
 * Mailing-list dialog carrying the monthly prize draw.
 *
 * It waits for a sign of interest before interrupting: a quarter of the page
 * scrolled, or thirty seconds, whichever lands first. Showing it on load would
 * cover the hero before anyone has seen the place, which is the fastest way to
 * be dismissed unread.
 *
 * The form itself is left to js/form-submit.js: the markup is a .w-form with a
 * named form, so that handler intercepts it, POSTs to the form endpoint and
 * swaps in .w-form-done. Nothing about the submission lives here.
 */
(function () {
  "use strict";

  var SCROLL_FRACTION = 0.25;
  var DELAY_MS = 30000;
  var DISMISS_DAYS = 30;

  var dialog = document.querySelector(".ch-join");
  if (!dialog) return;

  var panel = dialog.querySelector(".ch-join__panel");
  var closeBtn = dialog.querySelector(".ch-join__close");
  var form = dialog.querySelector("form");
  var key = "ch-join:" + (dialog.getAttribute("data-list") || "default");
  var lastFocus = null;
  var shown = false;

  /* Storage throws in some privacy modes, so every read and write is guarded
     and a failure simply means the dialog behaves as it would for a new
     visitor rather than breaking the page. */
  function remembered(name) {
    try {
      return window.localStorage.getItem(key + ":" + name);
    } catch (e) {
      return null;
    }
  }

  function remember(name, value) {
    try {
      window.localStorage.setItem(key + ":" + name, value);
    } catch (e) {}
  }

  function suppressed() {
    if (remembered("joined")) return true;
    var at = parseInt(remembered("dismissed"), 10);
    if (!at) return false;
    return Date.now() - at < DISMISS_DAYS * 864e5;
  }

  function focusables() {
    return Array.prototype.filter.call(
      panel.querySelectorAll('a[href], button:not(:disabled), input:not([type="hidden"]):not(.ch-join__pot), [tabindex]:not([tabindex="-1"])'),
      function (el) {
        return el.offsetParent !== null;
      }
    );
  }

  function open() {
    if (shown || suppressed()) return;
    shown = true;
    lastFocus = document.activeElement;
    dialog.hidden = false;
    document.body.classList.add("ch-nav-open"); /* reuses the nav's scroll lock */
    /* Next frame, so the transition has a painted starting state to run from.
       Focus has to wait for it too: until .is-open lands the panel is still
       visibility:hidden, and nothing inside a hidden subtree can take focus --
       calling focus() before this point fails silently and leaves the keyboard
       stranded on <body> behind the dialog. */
    requestAnimationFrame(function () {
      dialog.classList.add("is-open");
      var first = focusables()[0];
      if (first) first.focus();
    });
    document.addEventListener("keydown", onKey, true);
  }

  function close(reason) {
    if (!dialog.classList.contains("is-open")) return;
    dialog.classList.remove("is-open");
    document.body.classList.remove("ch-nav-open");
    document.removeEventListener("keydown", onKey, true);
    if (reason === "dismiss") remember("dismissed", String(Date.now()));
    window.setTimeout(function () {
      dialog.hidden = true;
    }, 320);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close("dismiss");
      return;
    }
    if (e.key !== "Tab") return;
    /* Keep tabbing inside the panel while it is modal. */
    var items = focusables();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      close("dismiss");
    });
  }

  /* Clicking the backdrop dismisses; clicking inside the panel must not. */
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog) close("dismiss");
  });

  /* A successful submission is the one outcome that should stop the dialog
     coming back at all. form-submit.js hides the form and reveals .w-form-done,
     so watch for that rather than duplicating its fetch. */
  if (form) {
    var done = dialog.querySelector(".w-form-done");
    if (done && window.MutationObserver) {
      new MutationObserver(function () {
        if (done.style.display === "block") remember("joined", String(Date.now()));
      }).observe(done, { attributes: true, attributeFilter: ["style"] });
    }
  }

  if (suppressed()) return;

  var timer = window.setTimeout(open, DELAY_MS);

  function onScroll() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if (max > 0 && window.pageYOffset / max >= SCROLL_FRACTION) {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      open();
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
})();
