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
    // A property that spells out what is in the room says it; the rest fall
    // back to counting rooms, which is all the catalogue knows about them.
    var beds = item.beds || item.bedrooms + (item.bedrooms === 1 ? " bed" : " beds");
    // "En-suite" rather than "1", so the Beaver's Den reads as a different
    // arrangement rather than as one bathroom short of the others.
    var baths = item.bathrooms === 0 ? "Shared bathroom"
      : item.bathrooms === 1 ? "En-suite bathroom"
      : item.bathrooms + " bathrooms";
    // Which woodland it is sits on this line rather than in the booking panel
    // below: it is a fact about the property like the other three, and down
    // there it was costing a heading and a line of its own. The pin says
    // what it is, so the name does not need repeating beside it.
    var site = item.destination;

    return '<ul class="pp-meta">' +
      '<li><img src="images/icons/icon-guests.svg" alt="" aria-hidden="true">' + item.sleeps + " guests</li>" +
      '<li><img src="images/icons/icon-beds.svg" alt="" aria-hidden="true">' + beds + "</li>" +
      '<li><img src="images/icons/icon-baths.svg" alt="" aria-hidden="true">' + baths + "</li>" +
      '<li><img src="images/icons/icon-location.svg" alt="" aria-hidden="true">' + esc(site) + "</li>" +
      "</ul>";
  }

  function arrows(item) {
    if (photosOf(item).length < 2) return "";
    return '<button class="pp-arrow pp-arrow--prev" type="button" data-step="-1" aria-label="Previous photo of ' +
      esc(item.name) + '"><img src="images/icons/arrow-prev.svg?v=20260906a" alt="" aria-hidden="true"></button>' +
      '<button class="pp-arrow pp-arrow--next" type="button" data-step="1" aria-label="Next photo of ' +
      esc(item.name) + '"><img src="images/icons/arrow-next.svg" alt="" aria-hidden="true"></button>';
  }

  // The design reserved this panel for a Checked.in booking widget, and the
  // Oxford three now carry it: the address their button already pointed at is
  // a self-contained responsive calendar that sets neither X-Frame-Options nor
  // a frame-ancestors policy, so it runs here instead of sending anyone to
  // another site to find out whether a date is free.
  //
  // Dorset has no calendar of its own yet and keeps its button out to
  // Mallinson's. Adding a calendarUrl to those three is all it will take.
  //
  // The minimum stay shows where the booking site publishes one: Mallinson's
  // FAQ gives one policy for all three Dorset treehouses; the Oaks gives none,
  // so the Oxford three have no facts left to show here at all and the list
  // does not render for them.
  function bookingPanel(item) {
    var hasCal = !!item.calendarUrl;

    // The frame is lazy, so six calendars do not all load at once on a page
    // most people read part of, and its title names the property, because a
    // screen reader announces a frame by its title and nothing else.
    //
    // Landscape on desktop, square on phones, chosen once at load. The widget
    // reports its own height by postMessage, so the frame starts at the layout's
    // tallest month and then follows the widget.
    var layout = window.matchMedia("(max-width: 640px)").matches ? "portrait" : "landscape";
    var startHeight = layout === "portrait" ? 690 : 520;
    var calendar = hasCal
      ? '<iframe class="pp-book__cal" src="' + esc(item.calendarUrl) + "&layout=" + layout +
        '" height="' + startHeight + '" allowtransparency="true" scrolling="no"' +
        ' title="Availability calendar for ' + esc(item.name) + '" loading="lazy"></iframe>'
      : "";

    // With the calendar in the panel there is nothing left for the button to
    // do. Without one it is still the only way to see a date.
    var book = hasCal
      ? ""
      : '<a class="button w-inline-block" href="' + esc(item.bookingUrl) +
        '" target="_blank" rel="noopener"><span>Check availability</span>' + ARROW + "</a>";


    // A calendar in the panel needs no explaining; a button out of it does.
    var note = hasCal
      ? ""
      : '<p class="pp-book__note">Booking opens on the ' +
        (item.region === "Dorset" ? "Mallinson" : "Oaks") + " site</p>";

    var facts = item.minimumStay
      ? '<dl class="pp-book__facts">' +
        "<div><dt>Minimum stay</dt><dd>" + esc(item.minimumStay) + "</dd></div>" +
        "</dl>"
      : "";

    return '<div class="pp-book' + (hasCal ? " pp-book--cal" : "") + '">' +
      facts +
      calendar +
      (book ? '<div class="pp-book__actions">' + book + "</div>" : "") +
      note +
      "</div>";
  }

  // The Oxford three each open the one krpano tour at their own scene, set by
  // the ?ss= on the URL. An unknown scene name falls back to the aerial
  // without complaining, so these are checked rather than guessed. The Dorset
  // three have no tour at all and get nothing here.
  //
  // It sits on the photograph rather than under the booking panel. The panel
  // sets how tall the row is and the picture stretches to match, so a button
  // there made the Oxford pictures taller than the Dorset ones. On the
  // photograph it costs no height at all.
  function tourLink(item) {
    if (!item.tourUrl) return "";
    return '<a class="pp-tour" href="' + esc(item.tourUrl) +
      '" target="_blank" rel="noopener">3D Tour</a>';
  }

  function property(item) {
    var n = splitName(item.name);
    return '<article class="pp-item" id="property-' + esc(item.id) + '">' +
      '<div class="pp-item__row">' +
        '<div class="pp-item__media">' + frame(item, { gallery: true }) + arrows(item) + tourLink(item) + "</div>" +
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
    // data-destination on <html> marks a destination page: oxford-stays.html
    // and dorset-stays.html. It is a hard scope, not a default. The URL
    // promises one place, so a property from the other never appears on it,
    // whatever the query string asks for and even when a filter empties the
    // list. Without that the pages would be a query parameter with extra
    // steps, and an Oxford URL could end up showing Dorset.
    var scope = (document.documentElement.getAttribute("data-destination") || "")
      .trim().toLowerCase();
    var wantPlace = scope || (params.get("destination") || "").trim().toLowerCase();
    var wantGuests = parseInt(params.get("guests"), 10);
    if (isNaN(wantGuests)) wantGuests = 0;

    var all = CH.listings;
    // Everything this page is allowed to show, before any search narrows it.
    var inScope = scope
      ? all.filter(function (it) { return it.destination.toLowerCase() === scope; })
      : all;

    var narrowed = inScope.filter(function (it) {
      if (!scope && wantPlace && it.destination.toLowerCase() !== wantPlace) return false;
      if (wantGuests && it.sleeps < wantGuests) return false;
      return true;
    });

    var items, filtered, dropped = false;
    if (scope) {
      // An over-tight search must never leave an empty page. On the combined
      // page that means widening to the whole catalogue; here the widest this
      // page may go is its own destination, so the guest filter is what gives.
      dropped = !narrowed.length;
      items = dropped ? inScope : narrowed;
      filtered = true;
    } else {
      filtered = (wantPlace || wantGuests) && narrowed.length && narrowed.length < all.length;
      items = filtered ? narrowed : all;
    }

    tiles.innerHTML = items.map(tile).join("");
    list.innerHTML = items.map(property).join("");

    // Tell people what they are looking at, and give them the way out. Without
    // this a narrowed list is indistinguishable from a shorter catalogue.
    var note = document.createElement("p");
    note.className = "pp-filter";

    if (filtered) {
      var place = items[0].destination;
      if (dropped) {
        note.innerHTML = "No " + esc(place) + " retreat sleeps " + wantGuests +
          ". Showing all " + esc(place) + " retreats" +
          ' <a href="search-results.html?guests=' + wantGuests +
          '">Try both destinations</a>';
      } else {
        var said = [];
        // On a destination page the place is the page, so saying it here only
        // repeats the heading, and there is no way out to offer: the whole
        // point of the page is that it stays in one place.
        if (wantPlace && !scope) said.push("Cedar Hollow " + place);
        if (wantGuests) said.push(wantGuests + (wantGuests === 1 ? " guest" : " guests"));
        if (!said.length) {
          note = null;
        } else {
          note.innerHTML = "Showing " + esc(said.join(" \u00b7 ")) +
            (scope ? "" : ' <a href="search-results.html">Show all retreats</a>');
        }
      }
    } else {
      // Unfiltered, the line does the opposite job: it says so, and offers the
      // places as the way in. Read off the catalogue rather than typed, so a
      // third location would appear here without anyone remembering to.
      var places = [];
      items.forEach(function (it) {
        if (places.indexOf(it.destination) < 0) places.push(it.destination);
      });
      note.innerHTML = "Showing all retreats" + places.map(function (place) {
        return ' <a href="search-results.html?destination=' +
          encodeURIComponent(place) + '">' + esc(place) + "</a>";
      }).join("");
    }

    if (note) tiles.parentNode.insertBefore(note, tiles);

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

  // The Checked.in widget measures itself once it knows how wide its slot is and
  // posts { cinStripHeight: <px> }. Only the frame that sent the message is
  // resized, matched by its window, so nothing else on the page can resize them.
  window.addEventListener("message", function (e) {
    var height = e.data && e.data.cinStripHeight;
    if (typeof height !== "number" || height < 80 || height > 2000) return;
    var frames = document.querySelectorAll("iframe.pp-book__cal");
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        frames[i].style.height = height + "px";
        return;
      }
    }
  });
})();
