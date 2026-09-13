/*
 * Properties page renderer: Figma 289:1205 (desktop) / 351:902 (mobile).
 *
 * Reads the same LISTINGS catalogue the homepage and search use, so the page
 * carries all six properties rather than the three the design mocks up, and
 * prices, sleeps and copy stay in one place.
 */
(function () {
  "use strict";

  var CH = window.CedarHollowSearch;
  if (!CH) return;

  var ARROW = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewbox="0 0 17 12" fill="none" class="button_icon">' +
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M13.2443 5.03644L9.48927 1.21321L10.6935 0L16.5 5.91195' +
    'L10.6783 11.55L9.50444 10.3067L13.17 6.75673H0V5.03644H13.2443Z" fill="currentColor"></path></svg>';

  function esc(s) { return CH.escapeHtml(s); }

  // The design sets the first word light-upright and the rest italic on the
  // tiles, and the reverse on the property headings. nameHtml already carries
  // that split for the site's own headings, so reuse it rather than re-parsing.
  function splitName(name) {
    var parts = name.split(" ");
    if (parts.length === 1) return { first: name, rest: "" };
    return { first: parts.slice(0, -1).join(" "), rest: parts[parts.length - 1] };
  }

  // A property's gallery is its `photos` array if it has one, otherwise the
  // single catalogue image. The arrows below are rendered only when there is
  // actually more than one, so they never promise a slideshow that isn't there.
  function photosOf(item) {
    return (item.photos && item.photos.length) ? item.photos : [item.image];
  }

  // Galleries can run to fifty-plus photos per property, so only the first
  // shot loads with the page. The rest carry their sources in data attributes
  // and are promoted to real src by the arrows, one step ahead of the viewer.
  function frame(item, opts) {
    var shots = photosOf(item);
    // A quick-pick tile is a cover shot, not a gallery: rendering all of a
    // property's photos there would put fifty-odd empty <img> in the strip.
    if (opts && opts.single) shots = shots.slice(0, 1);
    var sizes = (opts && opts.sizes) || "(max-width: 991px) 100vw, 762px";
    var imgs = shots.map(function (ph, i) {
      var attrs = i === 0
        ? 'src="' + esc(ph.src) + '" ' + (ph.srcset ? 'srcset="' + esc(ph.srcset) + '" ' : "")
        : 'data-src="' + esc(ph.src) + '" ' + (ph.srcset ? 'data-srcset="' + esc(ph.srcset) + '" ' : "");
      return "<img " + attrs +
        'sizes="' + esc(sizes) + '" loading="lazy" alt="' + esc(item.name) +
        '" class="pp-shot"' + (i === 0 ? ' data-current="true"' : "") + ">";
    }).join("");
    return '<div class="pp-frame"' + (opts && opts.gallery ? ' data-gallery="true"' : "") + ">" + imgs + "</div>";
  }

  function materialise(img) {
    if (!img || !img.dataset.src) return;
    img.src = img.dataset.src;
    if (img.dataset.srcset) img.srcset = img.dataset.srcset;
    delete img.dataset.src;
    delete img.dataset.srcset;
  }

  function tile(item) {
    var n = splitName(item.name);
    return '<li><a class="pp-tile" href="#property-' + esc(item.id) + '">' +
      frame(item, { single: true, sizes: "(max-width: 991px) 132px, 33vw" }) +
      '<p class="pp-tile-name">' + esc(n.first) + ' <em>' + esc(n.rest) + '</em></p>' +
      "</a></li>";
  }

  function meta(item) {
    var beds = item.bedrooms + (item.bedrooms === 1 ? " bed" : " beds");
    var baths = item.bathrooms === 0 ? "Shared bathroom"
      : item.bathrooms + (item.bathrooms === 1 ? " bathroom" : " bathrooms");
    return '<ul class="pp-meta">' +
      '<li><img src="images/icons/icon-guests.svg" alt="" aria-hidden="true">' + item.sleeps + " guests</li>" +
      '<li><img src="images/icons/icon-beds.svg" alt="" aria-hidden="true">' + beds + "</li>" +
      '<li><img src="images/icons/icon-baths.svg" alt="" aria-hidden="true">' + baths + "</li>" +
      "</ul>";
  }

  function arrows(item) {
    if (photosOf(item).length < 2) return "";
    return '<button class="pp-arrow pp-arrow--prev" type="button" data-step="-1" aria-label="Previous photo of ' +
      esc(item.name) + '"><img src="images/icons/arrow-prev.svg?v=20260906a" alt="" aria-hidden="true"></button>' +
      '<button class="pp-arrow pp-arrow--next" type="button" data-step="1" aria-label="Next photo of ' +
      esc(item.name) + '"><img src="images/icons/arrow-next.svg" alt="" aria-hidden="true"></button>';
  }

  // The design reserves a panel here for a Checked.in booking widget we do not
  // have. Rather than leave the space empty, it carries which site the property
  // is on and how to book it, both from the catalogue so nothing is
  // hand-maintained, plus the minimum stay where the booking site publishes one.
  // Mallinson's FAQ gives one policy for all three Dorset treehouses; the Oaks
  // gives none, so Oxford shows the location alone rather than a guess.
  function bookingPanel(item) {
    var site = item.region === "Dorset" ? "Cedar Hollow Dorset" : "Cedar Hollow Oxford";
    return '<div class="pp-book">' +
      '<dl class="pp-book__facts">' +
        "<div><dt>Location</dt><dd>" + esc(site) + "</dd></div>" +
        // The Oaks publishes no minimum, so the Oxford three carry none and the
        // row simply does not render for them.
        (item.minimumStay
          ? "<div><dt>Minimum stay</dt><dd>" + esc(item.minimumStay) + "</dd></div>"
          : "") +
      "</dl>" +
      '<a class="button w-inline-block" href="' + esc(item.bookingUrl) +
        '" target="_blank" rel="noopener"><span>Check availability</span>' + ARROW + "</a>" +
      '<p class="pp-book__note">Booking opens on the ' +
        (item.region === "Dorset" ? "Mallinson" : "Oaks") + " site</p>" +
      "</div>";
  }

  function property(item) {
    var n = splitName(item.name);
    return '<article class="pp-item" id="property-' + esc(item.id) + '">' +
      '<div class="pp-item__row">' +
        '<div class="pp-item__media">' + frame(item, { gallery: true }) + arrows(item) + "</div>" +
        '<div class="pp-info">' +
          '<h2 class="pp-name"><em>' + esc(n.first) + '</em> <span class="pp-name__light">' + esc(n.rest) + "</span></h2>" +
          '<div class="pp-desc">' + meta(item) +
            "<p>" + esc(item.description) + "</p>" +
            '<p class="pp-price">From <strong>&pound;' + item.price + '</strong><span>pn</span></p>' +
          "</div>" +
          bookingPanel(item) +
        "</div>" +
      "</div>" +
      '<div class="pp-notes"><p>' + esc(item.longDescription) + "</p></div>" +
      "</article>";
  }

  document.addEventListener("DOMContentLoaded", function () {
    var tiles = document.getElementById("pp-tiles");
    var list = document.getElementById("pp-list");
    if (!tiles || !list) return;
    // The Oxford page's hero search sends people here as
    // ?destination=Oxford&guests=N. With no such parameters the page is
    // unchanged: all six properties, in catalogue order.
    var params = new URLSearchParams(window.location.search);
    var wantPlace = (params.get("destination") || "").trim().toLowerCase();
    var wantGuests = parseInt(params.get("guests"), 10);
    if (isNaN(wantGuests)) wantGuests = 0;

    var items = CH.listings;
    var narrowed = items.filter(function (it) {
      if (wantPlace && it.destination.toLowerCase() !== wantPlace) return false;
      if (wantGuests && it.sleeps < wantGuests) return false;
      return true;
    });
    // An over-tight search must never leave an empty page; fall back to the
    // whole catalogue and say nothing was narrowed.
    var filtered = (wantPlace || wantGuests) && narrowed.length && narrowed.length < items.length;
    if (filtered) items = narrowed;

    tiles.innerHTML = items.map(tile).join("");
    list.innerHTML = items.map(property).join("");

    // Tell people what they are looking at, and give them the way out. Without
    // this a narrowed list is indistinguishable from a shorter catalogue.
    if (filtered) {
      var said = [];
      if (wantPlace) said.push("Cedar Hollow " + items[0].destination);
      if (wantGuests) said.push(wantGuests + (wantGuests === 1 ? " guest" : " guests"));
      var note = document.createElement("p");
      note.className = "pp-filter";
      note.innerHTML = "Showing " + esc(said.join(" \u00b7 ")) +
        ' <a href="search-results.html">Show all retreats</a>';
      tiles.parentNode.insertBefore(note, tiles);
    }

    // A Featured Properties card links here as ?q=<property name>. Both the
    // tiles and the cards are rendered above, so at the moment the browser
    // reads the URL there is no #property-... in the document for it to jump
    // to -- it lands at the top of the page instead. Resolve the match here,
    // now the list exists, and go to it.
    (function goToRequestedProperty() {
      var target = null;
      var hash = (window.location.hash || "").replace(/^#/, "");
      if (hash) target = document.getElementById(hash);

      if (!target && window.location.search) {
        var q = (new URLSearchParams(window.location.search).get("q") || "")
          .trim().toLowerCase();
        if (q) {
          // Exact name first; fall back to a contains match so a partial or
          // stale query still lands somewhere sensible rather than the top.
          var hit = null;
          items.forEach(function (it) {
            if (!hit && it.name.toLowerCase() === q) hit = it;
          });
          items.forEach(function (it) {
            if (!hit && it.name.toLowerCase().indexOf(q) !== -1) hit = it;
          });
          if (hit) target = document.getElementById("property-" + hit.id);
        }
      }
      if (!target) return;

      function go() {
        target.scrollIntoView({ block: "start" });
        // The cards above carry lazily loaded images. If one settles at a
        // different height after the jump the target drifts, so land it again
        // once everything has loaded.
        window.setTimeout(function () {
          target.scrollIntoView({ block: "start" });
        }, 0);
      }
      go();
      window.addEventListener("load", go);

      // Leave the address bar pointing at the property itself, so a reload or
      // a shared link is precise. replaceState, so this does not add history
      // or move the page.
      if (!hash && window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname +
          window.location.search + "#" + target.id);
      }
    })();

    // One path for both inputs: the arrows and a finger both call step().
    function step(frameEl, dir) {
      var shots = frameEl.querySelectorAll(".pp-shot");
      if (shots.length < 2) return;
      var i = 0;
      shots.forEach(function (s, n) { if (s.dataset.current) i = n; });
      shots[i].removeAttribute("data-current");
      var next = (i + dir + shots.length) % shots.length;
      materialise(shots[next]);
      shots[next].setAttribute("data-current", "true");
      // stay one step ahead in the direction of travel
      materialise(shots[(next + dir + shots.length) % shots.length]);
    }

    list.addEventListener("click", function (e) {
      var btn = e.target.closest(".pp-arrow");
      if (!btn) return;
      var frameEl = btn.parentElement.querySelector('[data-gallery="true"]');
      if (frameEl) step(frameEl, Number(btn.dataset.step));
    });

    // ---- Swipe -----------------------------------------------------------
    // A gallery is only a few hundred pixels tall inside a very long page, so
    // the hard part is not detecting a swipe, it is not stealing vertical
    // scrolling. The gesture stays undecided until the finger has moved far
    // enough to show intent: past that point it is either a swipe or a scroll
    // for the rest of the touch, and never both.
    var TAKE = 12;      // px of travel before a direction is committed
    var TRIGGER = 45;   // px of horizontal travel that counts as a swipe
    var touch = null;

    list.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { touch = null; return; }
      var frameEl = e.target.closest('[data-gallery="true"]');
      if (!frameEl || frameEl.querySelectorAll(".pp-shot").length < 2) { touch = null; return; }
      touch = { frame: frameEl, x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null };
    }, { passive: true });

    list.addEventListener("touchmove", function (e) {
      if (!touch || e.touches.length !== 1) return;
      var dx = e.touches[0].clientX - touch.x;
      var dy = e.touches[0].clientY - touch.y;
      if (!touch.axis) {
        if (Math.abs(dx) < TAKE && Math.abs(dy) < TAKE) return;
        touch.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      // Horizontal is ours; vertical belongs to the page and we let it go.
      if (touch.axis === "x" && e.cancelable) e.preventDefault();
    }, { passive: false });

    list.addEventListener("touchend", function (e) {
      if (!touch) return;
      var t = touch; touch = null;
      if (t.axis !== "x") return;
      var dx = (e.changedTouches[0] || {}).clientX - t.x;
      if (Math.abs(dx) < TRIGGER) return;
      step(t.frame, dx < 0 ? 1 : -1);   // drag left to go forward
    }, { passive: true });

    list.addEventListener("touchcancel", function () { touch = null; }, { passive: true });
  });
})();
