/*
 * Cedar Hollow form submission handler.
 *
 * The site is a static Webflow export, so Webflow's own form backend no longer
 * receives submissions. This script intercepts every Webflow form (.w-form) and
 * POSTs it to our own contact endpoint instead, then shows Webflow's
 * existing success (.w-form-done) or error (.w-form-fail) message.
 */
(function () {
  "use strict";

  // The site is served by the Cloudflare Worker, which answers /api/contact
  // same-origin (worker/index.js) and sends through Resend.
  //
  // Railway still builds the site as a rollback copy, but its static server has
  // no /api/contact, so on *.railway.app submissions go cross-origin to the
  // standalone form-handler service instead. ALLOWED_ORIGINS on that service
  // must list the hostname, or the browser blocks the POST.
  var ENDPOINT = /\.railway\.app$/.test(location.hostname)
    ? "https://form-handler-production-f871.up.railway.app/api/contact"
    : "/api/contact";

  // Capture-phase listener on document so this runs before Webflow's jQuery
  // submit handler; stopPropagation then prevents Webflow from also handling it.
  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;
      if (!(form instanceof HTMLFormElement)) return;

      var wrapper = form.closest(".w-form");
      if (!wrapper) return; // only handle Webflow forms

      // Never hijack search forms: those navigate to the results page and are
      // handled by the client-side search, not emailed.
      if (
        form.matches('[role="search"], .search-form, .ch-search__bar') ||
        form.closest(".searchbar-wrapper")
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      var done = wrapper.querySelector(".w-form-done");
      var fail = wrapper.querySelector(".w-form-fail");
      var button = form.querySelector('[type="submit"], button');

      // Gather all named fields.
      var data = {};
      new FormData(form).forEach(function (value, key) {
        data[key] = value;
      });
      data._form = form.getAttribute("name") || form.id || "form";

      // Button "please wait" state.
      var original = null;
      if (button) {
        if (button.tagName === "INPUT") {
          original = button.value;
          button.value = button.getAttribute("data-wait") || "Please wait...";
        } else {
          original = button.innerHTML;
          button.textContent = button.getAttribute("data-wait") || "Please wait...";
        }
        button.disabled = true;
      }

      function restoreButton() {
        if (!button) return;
        button.disabled = false;
        if (button.tagName === "INPUT") button.value = original;
        else button.innerHTML = original;
      }

      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
        .then(function (response) {
          if (!response.ok) throw new Error("Request failed: " + response.status);
          return response.json();
        })
        .then(function () {
          form.style.display = "none";
          if (done) done.style.display = "block";
        })
        .catch(function (error) {
          if (fail) fail.style.display = "block";
          restoreButton();
          if (window.console) console.error("Form submission failed:", error);
        });
    },
    true
  );
})();
