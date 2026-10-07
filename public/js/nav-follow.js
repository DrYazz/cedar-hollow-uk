/*
 * The logo and the menu button follow the page down as it scrolls, and take
 * the colour that reads against whatever is behind them: dark green over a
 * light background, cream over a dark one or over a photo. Over the page's
 * own header, where they start, they keep the colours that page gives them.
 *
 * To go back to how it was -- the bar scrolling away with the top of the
 * page -- set ENABLED below to false. Nothing in css/nav-follow.css applies
 * until this script adds ch-nav-follow to <html>, so that one line puts
 * every page back exactly as it was.
 *
 * To compare the two on any page, add ?nav=classic to its address for the
 * old way, or ?nav=follow for this one. Either holds for the rest of that
 * tab's visit, so the pages after it stay the same way.
 */
(function () {
  "use strict";

  var ENABLED = true;

  var bar = document.querySelector(".ch-nav__bar");
  var root = document.documentElement;
  if (!bar || !bar.parentElement || !window.requestAnimationFrame || !document.elementsFromPoint) return;

  var mode = /[?&]nav=(classic|follow)(?:&|$)/.exec(location.search);
  mode = mode && mode[1];
  try {
    if (mode) sessionStorage.setItem("ch-nav", mode);
    else mode = sessionStorage.getItem("ch-nav");
  } catch (e) {}
  if (!ENABLED || mode === "classic") return;

  // .ch-nav: the bar's place in the page, held open once the bar has left it.
  var holder = bar.parentElement;
  // The header the bar sits in, where it keeps its own colours. The booking
  // pages have none: their bar sits straight on the page.
  var home = holder.closest("header, section");
  var owl = bar.querySelector(".ch-nav__logo .ch-nav__owl");
  var word = bar.querySelector(".ch-nav__logo .ch-nav__wordmark");
  var caret = bar.querySelector(".ch-siteswitch__caret");
  var list = bar.querySelector(".ch-siteswitch__list");
  var toggle = bar.querySelector(".ch-nav__toggle");

  // The bar and its menu leave the page's header for the top of <body>.
  // Left inside it, the header could cut them off: the headers hide what
  // spills outside them (overflow: hidden), and Safari on an iPhone applied
  // that to the fixed bar too -- on the Oxford home page the logo was sliced
  // off at the bottom of the photo and gone below it. The header's layer
  // (z-index 3 on the home pages) would also have kept the bar under anything
  // raised further down. Up here nothing contains them; the bar's z-index of
  // 100 keeps it under the booking panel, the dialogs and the lightbox.
  //
  // The place they leave (.ch-nav) stays, held open at the bar's height, so
  // nothing on the page moves. Their new home is a .ch-nav as well, for the
  // styles that look for the menu inside one; the page's scripts find them
  // by name and are not affected.
  holder.style.minHeight = bar.offsetHeight + "px";
  var menu = document.getElementById("ch-nav-menu");
  var lifted = document.createElement("div");
  lifted.className = "ch-nav ch-nav--lifted";
  lifted.appendChild(bar);
  if (menu && holder.contains(menu)) lifted.appendChild(menu);
  document.body.insertBefore(lifted, document.body.firstChild);
  root.classList.add("ch-nav-follow");

  // ---- where the bar goes -----------------------------------------------
  var was = {};
  function set(name, value) {
    if (was[name] === value) return;
    was[name] = value;
    root.style.setProperty(name, value);
  }
  var floating = null;
  function place() {
    var r = holder.getBoundingClientRect();
    var h = bar.offsetHeight;
    var top = Math.max(0, Math.round(r.top));
    var height = h + "px";
    if (holder.style.minHeight !== height) holder.style.minHeight = height;
    set("--ch-nav-top", top + "px");
    set("--ch-nav-bottom", top + h + "px");
    set("--ch-nav-left", Math.round(r.left) + "px");
    set("--ch-nav-right", Math.max(0, Math.round(root.clientWidth - r.right)) + "px");
    var now = r.top < -2;
    if (now !== floating) {
      floating = now;
      bar.classList.toggle("is-floating", now);
    }
  }

  // ---- what is behind it --------------------------------------------------
  // A picture whose pixels cannot be read -- a video, another site's image,
  // one still loading -- counts as a mid-dark photo. A frame from another
  // site (the booking calendar) counts as see-through: its content cannot
  // be read either, and the one the site uses sits on the page's own cream.
  var PHOTO = [70, 66, 52, 1, true];
  var thumbs = {};
  var SIZE = 48;

  function draw(source, w, h) {
    if (!w || !h) return null;
    var k = Math.min(1, SIZE / Math.max(w, h));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext("2d");
    try {
      x.drawImage(source, 0, 0, c.width, c.height);
      return { w: c.width, h: c.height, nw: w, nh: h, px: x.getImageData(0, 0, c.width, c.height).data };
    } catch (err) {
      return null; // another site's picture: the browser will not show its pixels
    }
  }
  function thumbOfImg(img) {
    var url = img.currentSrc || img.src;
    if (!url) return null;
    if (url in thumbs) return thumbs[url];
    if (!img.complete) return null;
    return (thumbs[url] = draw(img, img.naturalWidth || img.width, img.naturalHeight || img.height));
  }
  function thumbOfUrl(url) {
    if (url in thumbs) return thumbs[url] === "wait" ? null : thumbs[url];
    thumbs[url] = "wait";
    var img = new Image();
    img.onload = function () {
      thumbs[url] = draw(img, img.naturalWidth, img.naturalHeight);
      queue();
    };
    img.onerror = function () {
      thumbs[url] = null;
    };
    img.src = url;
    return null;
  }
  // The colour at a point of a thumbnail, u and v from 0 to 1; null where
  // the point is off the picture.
  function at(t, u, v) {
    if (!t) return PHOTO;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    var i = (Math.min(t.h - 1, Math.floor(v * t.h)) * t.w + Math.min(t.w - 1, Math.floor(u * t.w))) * 4;
    return [t.px[i], t.px[i + 1], t.px[i + 2], t.px[i + 3] / 255, true];
  }
  // How far along a box a picture is placed: "50%" or "12px".
  function offset(token, spare) {
    if (!token) return spare / 2;
    if (/%$/.test(token)) return (parseFloat(token) / 100) * spare;
    return parseFloat(token) || 0;
  }
  // Where a picture of natural size nw x nh is drawn in a box of w x h.
  function fit(how, w, h, nw, nh, position) {
    var dw = w,
      dh = h;
    if (how === "cover" || how === "contain") {
      var k = how === "cover" ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh);
      dw = nw * k;
      dh = nh * k;
    } else if (how !== "fill") {
      var size = how.split(" ");
      dw = size[0] === "auto" ? nw : offset(size[0], w);
      dh = !size[1] || size[1] === "auto" ? (size[0] === "auto" ? nh : (dw * nh) / nw) : offset(size[1], h);
    }
    var p = (position || "50% 50%").split(" ");
    return { x: offset(p[0], w - dw), y: offset(p[1], h - dh), w: dw, h: dh };
  }
  function colour(text) {
    var m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+%?))?\)/.exec(text);
    if (!m) return null;
    var a = m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a, false];
  }
  // A gradient counts as the average of its colours.
  function gradient(text) {
    var all = text.match(/rgba?\([^)]*\)/g) || [];
    var sum = [0, 0, 0, 0];
    all.forEach(function (c) {
      c = colour(c);
      for (var i = 0; i < 4; i++) sum[i] += c[i];
    });
    return all.length ? [sum[0] / all.length, sum[1] / all.length, sum[2] / all.length, sum[3] / all.length, false] : null;
  }
  function layers(el, s, x, y) {
    var out = [];
    // A layer blended into what is under it (color-burn and the like)
    // changes it rather than covering it; left out.
    if (s.mixBlendMode && s.mixBlendMode !== "normal") return out;
    var r = el.getBoundingClientRect();
    var tag = el.tagName;
    // A wash laid over the whole box by ::before or ::after -- the dark layer
    // a photo often has to keep its words legible -- is part of it too.
    ["::after", "::before"].forEach(function (which) {
      var p = getComputedStyle(el, which);
      if (p.content === "none" || p.content === "normal" || (p.position !== "absolute" && p.position !== "fixed")) return;
      if (p.mixBlendMode && p.mixBlendMode !== "normal") return;
      if (!(parseFloat(p.top) <= 0 && parseFloat(p.left) <= 0 && parseFloat(p.right) <= 0 && parseFloat(p.bottom) <= 0)) return;
      var po = parseFloat(p.opacity);
      if (isNaN(po)) po = 1;
      [/gradient/.test(p.backgroundImage) ? gradient(p.backgroundImage) : null, colour(p.backgroundColor)].forEach(function (c) {
        if (c && c[3] > 0) out.push([c[0], c[1], c[2], c[3] * po, false]);
      });
    });
    if (tag === "IMG") {
      var t = thumbOfImg(el);
      if (t) {
        var f = fit(s.objectFit === "none" || s.objectFit === "scale-down" ? "contain" : s.objectFit, r.width, r.height, t.nw, t.nh, s.objectPosition);
        out.push(at(t, (x - r.left - f.x) / f.w, (y - r.top - f.y) / f.h));
      } else out.push(PHOTO);
    } else if (tag === "VIDEO" || tag === "CANVAS") {
      // The map on the home pages is drawn on canvases, on its own pale
      // ground: see-through, so that ground decides. Any other canvas or
      // video counts as a photo.
      if (!(tag === "CANVAS" && el.closest(".leaflet-container"))) out.push(PHOTO);
    }
    if (s.backgroundImage && s.backgroundImage !== "none") {
      var images = s.backgroundImage.split(/,(?![^(]*\))/);
      var sizes = s.backgroundSize.split(/,\s*/);
      var spots = s.backgroundPosition.split(/,\s*/);
      images.forEach(function (image, i) {
        var url = /url\(["']?([^"')]+)["']?\)/.exec(image);
        if (url) {
          var t = thumbOfUrl(url[1]);
          if (!t) return out.push(PHOTO);
          var f = fit(sizes[i % sizes.length] || "auto", r.width, r.height, t.nw, t.nh, spots[i % spots.length]);
          out.push(at(t, (x - r.left - f.x) / f.w, (y - r.top - f.y) / f.h));
        } else if (/gradient/.test(image)) out.push(gradient(image));
      });
    }
    out.push(colour(s.backgroundColor));
    return out.filter(function (c) {
      return c && c[3] > 0;
    });
  }
  // How much of an element shows, its parents' fading included: a closed
  // dialog at opacity 0 covers nothing.
  function shown(el) {
    var o = 1;
    for (var e = el; e && e !== root && o > 0; e = e.parentElement) {
      var v = parseFloat(getComputedStyle(e).opacity);
      if (!isNaN(v)) o *= v;
    }
    return o;
  }
  // Pictures laid behind the words often let the pointer through them
  // (pointer-events: none), and pointing at a place does not find what the
  // pointer passes through -- the Dorset retreat cards' photos, for one.
  // While the bar looks they are made findable, and then put straight back.
  var ghosts = [];
  function findGhosts() {
    ghosts = [];
    var all = document.body.getElementsByTagName("*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (getComputedStyle(el).pointerEvents !== "none" || bar.contains(el)) continue;
      // one whose parent lets the pointer through comes back with it
      if (el.parentElement && getComputedStyle(el.parentElement).pointerEvents === "none") continue;
      ghosts.push(el);
    }
  }
  function solid(on) {
    ghosts.forEach(function (g) {
      if (on) g.style.setProperty("pointer-events", "auto", "important");
      else g.style.removeProperty("pointer-events");
    });
  }
  // What is behind the bar at one point: its lightness from 0 to 1 and how
  // much of it is photo, or "home" while the bar's own header is behind it.
  function behind(x, y) {
    // By its box, since a header's picture may not be found by pointing at
    // it: the Dorset pages' blurred photo lets the pointer through.
    if (home) {
      var h = home.getBoundingClientRect();
      if (y >= h.top && y < h.bottom && x >= h.left && x < h.right) return "home";
    }
    var stack = document.elementsFromPoint(x, y);
    var left = 1,
      rgb = [0, 0, 0],
      photo = 0,
      first = true;
    for (var i = 0; i < stack.length && left > 0.02; i++) {
      var el = stack[i];
      if (bar.contains(el)) continue;
      var got = layers(el, getComputedStyle(el), x, y);
      if (!got.length) continue;
      var o = shown(el);
      if (!(o > 0)) continue;
      if (first) {
        first = false;
        if (home && home.contains(el)) return "home";
      }
      for (var j = 0; j < got.length && left > 0.02; j++) {
        var c = got[j],
          a = Math.min(1, c[3] * o);
        for (var k = 0; k < 3; k++) rgb[k] += c[k] * a * left;
        if (c[4]) photo += a * left;
        left *= 1 - a;
      }
    }
    for (var n = 0; n < 3; n++) rgb[n] += 255 * left;
    var lin = rgb.map(function (v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return { lum: 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2], photo: photo };
  }
  // The ink for one part of the bar, from a few points across it. Dark
  // green reads better than cream once the background is lighter than about
  // a quarter (the two contrasts cross at 0.24); over a photo the line is
  // drawn a little higher, since cream has its shadow to stand on there --
  // but not much, or cream is left on bright sky. The gap between the two
  // lines stops it flickering at the edge.
  function ink(points, now) {
    var lum = 0,
      photo = 0,
      seen = 0,
      homes = 0;
    points.forEach(function (p) {
      var b = behind(p[0], p[1]);
      if (b === "home") return homes++;
      lum += b.lum;
      photo += b.photo;
      seen++;
    });
    if (!seen || homes > seen) return "";
    lum /= seen;
    photo /= seen;
    var up = photo > 0.5 ? 0.36 : 0.3,
      down = photo > 0.5 ? 0.28 : 0.2;
    if (now === "dark") return lum < down ? "light" : "dark";
    if (now === "light") return lum > up ? "dark" : "light";
    return lum > (up + down) / 2 ? "dark" : "light";
  }
  // Points to look behind: across an element's middle, or down it.
  function across(el) {
    if (!el) return [];
    var r = el.getBoundingClientRect();
    if (!r.width) return [];
    var y = r.top + r.height / 2;
    return [[r.left + r.width * 0.15, y], [r.left + r.width / 2, y], [r.left + r.width * 0.85, y]];
  }
  function down(el) {
    if (!el) return [];
    var r = el.getBoundingClientRect();
    if (!r.width) return [];
    var x = r.left + r.width / 2;
    return [[x, r.top + r.height * 0.25], [x, r.top + r.height / 2], [x, r.top + r.height * 0.75]];
  }
  // Each piece takes its own ink. On a phone the photos stop short of the
  // screen's edge, so the owl can sit on the cream margin while the word
  // beside it is over the photo: one ink for both left one of them unread.
  var PARTS = [
    ["owl", function () { return down(owl); }],
    ["word", function () { return across(word); }],
    ["caret", function () { return down(caret); }],
    ["menu", function () { return across(toggle); }],
    // the Oxford and Dorset links under the logo, while they are showing
    ["list", function () {
      if (!list || getComputedStyle(list).visibility !== "visible") return [];
      var out = [];
      Array.prototype.forEach.call(list.querySelectorAll("a"), function (a) {
        out = out.concat(across(a));
      });
      return out;
    }],
  ];
  function colourIn() {
    solid(true);
    try {
      PARTS.forEach(function (part) {
        var name = "data-ink-" + part[0];
        var now = bar.getAttribute(name) || "";
        var next = ink(part[1](), now);
        if (next === now) return;
        if (next) bar.setAttribute(name, next);
        else bar.removeAttribute(name);
      });
    } finally {
      solid(false);
    }
  }

  // ---- when ---------------------------------------------------------------
  var queued = false;
  function update() {
    queued = false;
    place();
    colourIn();
  }
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }
  findGhosts();
  update();
  // Colours change gently from here on, but not on the way in.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      root.classList.add("ch-nav-follow--ready");
    });
  });
  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue);
  addEventListener("load", function () {
    findGhosts();
    queue();
  });
  // Pointing at the logo opens the Oxford and Dorset links.
  bar.addEventListener("mouseover", queue);
  bar.addEventListener("focusin", queue);
  // Opening the menu puts green behind the bar on a phone.
  document.addEventListener("click", function () {
    setTimeout(queue, 30);
  }, true);
  document.addEventListener("keyup", function () {
    setTimeout(queue, 30);
  }, true);
  // And now and then for anything that moves by itself: a slideshow, a
  // picture arriving.
  setInterval(function () {
    if (!document.hidden) queue();
  }, 800);
  // Pages that build part of themselves after loading (the listings, the
  // reviews) may add pictures that let the pointer through.
  setInterval(function () {
    if (!document.hidden) findGhosts();
  }, 4000);
})();
