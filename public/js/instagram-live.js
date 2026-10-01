/*
 * Live Instagram grid.
 *
 * The four posts in the markup are curated: real posts, with their thumbnails
 * downloaded into images/instagram/, because Instagram retired the Basic
 * Display API in 2024 and its replacement needs a server to hold a token.
 * There is a Worker now, so this asks it for the current four instead.
 *
 * Same contract as js/reviews-live.js, and for the same reason: every failure
 * path leaves the server-rendered markup exactly as it is. A missing token, an
 * expired token, a shape we did not expect, a slow network -- all of them end
 * with the curated grid still on screen. The posts are real, just older. What
 * nobody gets is a row of broken images or an empty section.
 *
 * It replaces the contents of the existing <li>s rather than rebuilding the
 * list, so the grid keeps the classes, the sizing and the lazy loading the
 * stylesheet and the page already agreed on.
 */
(function () {
  "use strict";

  /* The site is served from Railway, so this goes to the same service the
     contact form does, cross-origin. The Cloudflare Worker answers the same
     path same-origin, so if the site moves back there this becomes:
     var ENDPOINT = "/api/instagram";  -- see js/form-submit.js, which carries
     the identical note for identical reasons. */
  var ENDPOINT = "https://form-handler-production-f871.up.railway.app/api/instagram";
  var TIMEOUT_MS = 4000;

  var grid = document.querySelector(".ch-ig__grid[data-ig-site]");
  if (!grid || !window.fetch) return;

  var site = grid.getAttribute("data-ig-site");
  var cells = [].slice.call(grid.querySelectorAll("li"));
  if (!site || !cells.length) return;

  /* AbortController is the only modern thing here; without it, skip rather
     than leave a request that can rewrite the grid long after the page
     settled. */
  var controller = window.AbortController ? new AbortController() : null;
  if (!controller) return;
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  fetch(ENDPOINT + "?site=" + encodeURIComponent(site), {
    signal: controller.signal,
    headers: { accept: "application/json" },
  })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      clearTimeout(timer);
      if (!data || data.ok !== true || !Array.isArray(data.posts)) return;
      // Only a full set: a short answer would leave some cells current and
      // some stale, which reads as broken rather than as out of date.
      if (data.posts.length < cells.length) return;
      paint(data.posts);
    })
    .catch(function () { clearTimeout(timer); });

  function paint(posts) {
    for (var i = 0; i < cells.length; i++) {
      var post = posts[i];
      var link = cells[i].querySelector("a");
      var img = cells[i].querySelector("img");
      if (!link || !img || !post || !post.permalink || !post.image) return;

      link.href = post.permalink;
      img.src = post.image;
      img.removeAttribute("srcset");
      img.alt = typeof post.alt === "string" ? post.alt : "";

      // The glyph marks a reel. Keep whichever cells need it, drop the rest.
      var badge = link.querySelector(".ch-ig__badge");
      if (post.reel && !badge) link.appendChild(reelBadge());
      if (!post.reel && badge) badge.parentNode.removeChild(badge);
    }
  }

  function reelBadge() {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "ch-ig__badge");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    [
      ["M2.5 7h19M8.5 2.5 11 7M15 2.5 17.5 7", "none"],
      ["M3 7h18a1 1 0 0 1 1 1v12a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 20V8a1 1 0 0 1 1-1Z", "none"],
    ].forEach(function (d) {
      var p = document.createElementNS(NS, "path");
      p.setAttribute("d", d[0]);
      p.setAttribute("fill", d[1]);
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", "1.8");
      svg.appendChild(p);
    });
    var play = document.createElementNS(NS, "path");
    play.setAttribute("d", "m10.5 11.5 4.5 2.75-4.5 2.75z");
    svg.appendChild(play);
    return svg;
  }
})();
