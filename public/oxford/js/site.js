/* Cedar Hollow Oxford — shared behaviour (no dependencies) */
(function () {
  "use strict";

  /* ---- Navigation menu ---- */
  var btn = document.querySelector(".ch-nav__toggle");
  var menu = document.getElementById("ch-nav-menu");
  if (btn && menu) {
    var closeNav = function () {
      btn.setAttribute("aria-expanded", "false");
      menu.hidden = true;
      document.body.classList.remove("ch-nav-open");
    };
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      menu.hidden = open;
      document.body.classList.toggle("ch-nav-open", !open);
    });
    menu.addEventListener("click", function (e) {
      if (e.target.tagName === "A") closeNav();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") {
        closeNav();
        btn.focus();
      }
    });
    document.addEventListener("click", function (e) {
      if (menu.hidden) return;
      if (!menu.contains(e.target) && !btn.contains(e.target) && window.innerWidth > 1149) closeNav();
    });
  }

  /* ---- "Book a stay" overlay ---- */
  var overlay = document.getElementById("ch-book");
  if (overlay) {
    var openers = document.querySelectorAll("[data-book-open]");
    var closer = overlay.querySelector(".ch-book__close");
    var lastFocus = null;
    var openBook = function (e) {
      if (e) e.preventDefault();
      lastFocus = document.activeElement;
      overlay.hidden = false;
      document.body.classList.add("ch-book-open");
      var first = overlay.querySelector("a,button");
      if (first) first.focus();
    };
    var closeBook = function () {
      overlay.hidden = true;
      document.body.classList.remove("ch-book-open");
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    };
    Array.prototype.forEach.call(openers, function (el) {
      el.addEventListener("click", openBook);
    });
    if (closer) closer.addEventListener("click", closeBook);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeBook();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) closeBook();
    });
  }

  /* ---- Hero background video (plays once loaded, poster underneath) ---- */
  var video = document.querySelector(".hero_video");
  if (video) {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      var show = function () { video.setAttribute("data-active", "true"); };
      video.addEventListener("playing", show, { once: true });
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* autoplay blocked: poster stays */ });
    }
  }

  /* ---- Audio players: only one plays at a time ---- */
  var audios = document.querySelectorAll("audio");
  if (audios.length > 1) {
    Array.prototype.forEach.call(audios, function (a) {
      a.addEventListener("play", function () {
        Array.prototype.forEach.call(audios, function (o) {
          if (o !== a && !o.paused) o.pause();
        });
      });
    });
  }

  /* ---- Rental photo galleries ---- */
  Array.prototype.forEach.call(document.querySelectorAll("[data-gallery]"), function (g) {
    var track = g.querySelector(".ch-gallery__track");
    var slides = track.children;
    var prev = g.querySelector("[data-prev]");
    var next = g.querySelector("[data-next]");
    var count = g.querySelector("[data-count]");
    if (!track || !slides.length) return;
    var step = function () {
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return slides[0].getBoundingClientRect().width + gap;
    };
    var update = function () {
      var i = Math.round(track.scrollLeft / step());
      if (count) count.textContent = String(Math.min(i + 1, slides.length));
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    };
    prev.addEventListener("click", function () { track.scrollBy({ left: -step(), behavior: "smooth" }); });
    next.addEventListener("click", function () { track.scrollBy({ left: step(), behavior: "smooth" }); });
    track.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); next.click(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); prev.click(); }
    });
    track.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  });

  /* ---- Current-year in footer ---- */
  var y = document.querySelector("[data-year]");
  if (y) y.textContent = String(new Date().getFullYear());
})();
