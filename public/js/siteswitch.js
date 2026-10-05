/* The logo's site switcher.
   A mouse opens it by pointing at it (css/siteswitch.css); a click or tap
   on the caret, or Enter on it, opens it and keeps it open, and the next
   one closes it, as does a click or tap anywhere else, and Escape. Closed with the caret while the pointer
   is still over it, it stays closed until the pointer leaves (is-shut), or
   pointing would hold open what was just closed. Every page loads this one
   copy, the three home pages included. */
(function () {
    var box = document.querySelector('.ch-siteswitch');
    if (!box) return;
    var caret = box.querySelector('.ch-siteswitch__caret');
    var list = box.querySelector('.ch-siteswitch__list');
    // Showing, however it came to: tapped open, pointed at, or a link in it
    // focused -- so Escape closes what the reader can see.
    function shown() {
      return box.classList.contains('is-open') ||
        Boolean(list && getComputedStyle(list).visibility === 'visible');
    }
    function set(open) {
      box.classList.toggle('is-open', open);
      caret.setAttribute('aria-expanded', String(open));
    }
    caret.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      // Pointing at it shows it; a click keeps it open, and the next click
      // closes it, pointer or no.
      var open = !box.classList.contains('is-open');
      set(open);
      box.classList.toggle('is-shut', !open);
    });
    box.addEventListener('mouseleave', function () {
      box.classList.remove('is-shut');
    });
    // pointerdown rather than click: iOS sends no click for a tap on a part
    // of the page that does nothing, so a tap there would leave it open.
    document.addEventListener('pointerdown', function (e) {
      if (!box.contains(e.target)) set(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && shown()) {
        set(false);
        box.classList.add('is-shut');
        caret.focus();
      }
    });
  })();
