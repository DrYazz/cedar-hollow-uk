/*
 * Click-to-load YouTube players on the press pages.
 *
 * The page ships a still and a play button. Nothing is requested from YouTube
 * until someone presses it, at which point the button is swapped for an iframe
 * that autoplays.
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

  function play(button) {
    var id = button.getAttribute("data-video");
    if (!id || !/^[\w-]{11}$/.test(id)) return;

    var frame = document.createElement("iframe");
    frame.className = "ch-vid__frame";
    /* autoplay, because the click WAS the request to play. */
    frame.src = ORIGIN + encodeURIComponent(id) +
      "?autoplay=1&rel=0&modestbranding=1&playsinline=1";
    frame.title = button.getAttribute("aria-label") || "YouTube video player";
    frame.setAttribute("allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.setAttribute("loading", "lazy");

    button.parentNode.replaceChild(frame, button);
    /* Move the keyboard into the player, since the button it was on is gone. */
    try {
      frame.focus();
    } catch (e) {}
  }

  document.addEventListener("click", function (e) {
    var button = e.target.closest && e.target.closest(".ch-vid__play");
    if (button) play(button);
  });
})();
