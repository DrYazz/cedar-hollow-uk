/*
 * Click-to-load YouTube players on the press pages.
 *
 * The page ships a still and a play button. Nothing is requested from YouTube
 * until someone presses it, at which point the player opens in a lightbox over
 * the page.
 *
 * It opens over the page rather than in place because in place is unwatchable:
 * the stills sit in a grid column about 240px wide, so an inline player was
 * roughly 240x135 -- technically playing, practically useless. The lightbox
 * gives it the width of the window instead.
 *
 * Why not just embed the iframe: a YouTube embed starts talking to Google on
 * page load and sets cookies before a reader has asked for anything, and
 * cookies.html tells them that other companies' cookies apply once they arrive
 * at those companies' sites. Seven embeds on the combined press page would also
 * mean seven players' worth of script on a page most people scroll past.
 *
 * The player uses youtube-nocookie.com, which holds off on the tracking cookie
 * until playback actually starts. It is not a privacy guarantee -- it is the
 * quieter of the two hosts Google offers -- but combined with loading on demand
 * it means a visitor who never presses play is never handed to YouTube at all.
 *
 * Progressive enhancement: with JavaScript off the button does nothing and the
 * "Watch on YouTube" link beneath each still is the way through, so the
 * coverage is reachable either way.
 */
(function () {
  "use strict";

  var ORIGIN = "https://www.youtube-nocookie.com/embed/";
  var box = null;
  var opener = null;

  function build() {
    var el = document.createElement("div");
    el.className = "ch-lightbox";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.hidden = true;
    el.innerHTML =
      '<div class="ch-lightbox__inner">' +
        '<div class="ch-lightbox__stage"></div>' +
        '<p class="ch-lightbox__caption"></p>' +
      "</div>" +
      '<button class="ch-lightbox__close" type="button" aria-label="Close the video">' +
        '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
        '<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" fill="none"></path></svg>' +
      "</button>";
    document.body.appendChild(el);

    el.addEventListener("click", function (e) {
      /* the backdrop and the close button dismiss; the player itself must not */
      if (e.target === el || e.target.closest(".ch-lightbox__close")) close();
    });
    return el;
  }

  function open(button) {
    var id = button.getAttribute("data-video");
    if (!id || !/^[\w-]{11}$/.test(id)) return;

    opener = button;
    box = box || build();

    var frame = document.createElement("iframe");
    frame.className = "ch-lightbox__frame";
    /* autoplay, because the click WAS the request to play. */
    frame.src = ORIGIN + encodeURIComponent(id) +
      "?autoplay=1&rel=0&modestbranding=1&playsinline=1";
    frame.title = button.getAttribute("aria-label") || "YouTube video player";
    frame.setAttribute("allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");

    var card = button.closest(".ch-vid");
    var title = card && card.querySelector(".ch-vid__title");
    var source = card && card.querySelector(".ch-vid__source");
    box.querySelector(".ch-lightbox__caption").textContent =
      (title ? title.textContent : "") + (source ? " — " + source.textContent : "");
    box.setAttribute("aria-label", title ? title.textContent : "Video");

    var stage = box.querySelector(".ch-lightbox__stage");
    stage.innerHTML = "";
    stage.appendChild(frame);

    box.hidden = false;
    document.body.classList.add("ch-nav-open"); /* reuses the nav's scroll lock */
    /* Next frame, so the transition has a painted starting state, and so the
       close button is focusable by the time focus is asked for. */
    requestAnimationFrame(function () {
      box.classList.add("is-open");
      box.querySelector(".ch-lightbox__close").focus();
    });
    document.addEventListener("keydown", onKey, true);
  }

  function close() {
    if (!box || box.hidden) return;
    box.classList.remove("is-open");
    document.body.classList.remove("ch-nav-open");
    document.removeEventListener("keydown", onKey, true);
    /* Emptying the stage is what stops the audio. */
    box.querySelector(".ch-lightbox__stage").innerHTML = "";
    box.hidden = true;
    if (opener && opener.focus) opener.focus();
    opener = null;
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    /* Only two things are focusable in here, so keep Tab between them. */
    if (e.key === "Tab" && box && !box.hidden) {
      var stops = box.querySelectorAll("button, iframe");
      if (!stops.length) return;
      var first = stops[0];
      var last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener("click", function (e) {
    var button = e.target.closest && e.target.closest(".ch-vid__play");
    if (button) {
      e.preventDefault();
      open(button);
    }
  });
})();
