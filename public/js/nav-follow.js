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
  var logo = bar.querySelector(".ch-nav__logo");
  var caret = bar.querySelector(".ch-siteswitch__caret");
  var toggle = bar.querySelector(".ch-nav__toggle");

  // A fixed bar can rise no higher than the layer it is drawn in. On the
  // three home pages that is the hero's (z-index 3), which would leave it
  // under anything further down the page that is raised at all. Lifted to
  // 100: still under the booking panel, the dialogs and the lightbox.
  for (var e = holder; e && e !== document.body; e = e.parentElement) {
    var z = parseInt(getComputedStyle(e).zIndex, 10);
    if (!isNaN(z) && z < 100) e.style.zIndex = "100";
  }
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
    var r = el.getBoundingClientRect();
    var tag = el.tagName;
    if (tag === "IMG") {
      var t = thumbOfImg(el);
      if (t) {
        var f = fit(s.objectFit === "none" || s.objectFit === "scale-down" ? "contain" : s.objectFit, r.width, r.height, t.nw, t.nh, s.objectPosition);
        out.push(at(t, (x - r.left - f.x) / f.w, (y - r.top - f.y) / f.h));
      } else out.push(PHOTO);
    } else if (tag === "VIDEO" || tag === "CANVAS") {
      out.push(PHOTO);
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
    var o = parseFloat(s.opacity);
    return out.filter(function (c) {
      return c && c[3] > 0;
    }).map(function (c) {
      return [c[0], c[1], c[2], c[3] * (isNaN(o) ? 1 : o), c[4]];
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
      if (first) {
        first = false;
        if (home && home.contains(el)) return "home";
      }
      for (var j = 0; j < got.length && left > 0.02; j++) {
        var c = got[j],
          a = Math.min(1, c[3]);
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
  // drawn higher, since cream with its shadow holds up over most pictures.
  // The gap between the two lines stops it flickering at the edge.
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
    var up = photo > 0.5 ? 0.5 : 0.3,
      down = photo > 0.5 ? 0.4 : 0.2;
    if (now === "dark") return lum < down ? "light" : "dark";
    if (now === "light") return lum > up ? "dark" : "light";
    return lum > (up + down) / 2 ? "dark" : "light";
  }
  function across(el, more) {
    if (!el) return [];
    var r = el.getBoundingClientRect();
    if (!r.width) return [];
    var y = r.top + r.height / 2;
    var out = [[r.left + r.width * 0.15, y], [r.left + r.width / 2, y], [r.left + r.width * 0.85, y]];
    if (more) {
      var m = more.getBoundingClientRect();
      if (m.width) out.push([m.left + m.width / 2, m.top + m.height / 2]);
    }
    return out;
  }
  function colourIn() {
    var a = ink(across(logo, caret), bar.getAttribute("data-ink-logo"));
    var b = ink(across(toggle), bar.getAttribute("data-ink-menu"));
    if (a !== (bar.getAttribute("data-ink-logo") || "")) {
      if (a) bar.setAttribute("data-ink-logo", a);
      else bar.removeAttribute("data-ink-logo");
    }
    if (b !== (bar.getAttribute("data-ink-menu") || "")) {
      if (b) bar.setAttribute("data-ink-menu", b);
      else bar.removeAttribute("data-ink-menu");
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
  update();
  // Colours change gently from here on, but not on the way in.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      root.classList.add("ch-nav-follow--ready");
    });
  });
  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue);
  addEventListener("load", queue);
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
})();
