/* The logo's site switcher.
   Pointer devices get :hover from the stylesheet; this is for touch and
   keyboards, and for closing. Lifted from the home pages' nav embed so the
   subpages share it rather than each carrying a copy. */
(function () {
    var box = document.querySelector('.ch-siteswitch');
    if (!box) return;
    var caret = box.querySelector('.ch-siteswitch__caret');
    function set(open) {
      box.classList.toggle('is-open', open);
      caret.setAttribute('aria-expanded', String(open));
    }
    caret.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      set(caret.getAttribute('aria-expanded') !== 'true');
    });
    document.addEventListener('click', function (e) {
      if (!box.contains(e.target)) set(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && box.classList.contains('is-open')) { set(false); caret.focus(); }
    });
  })();
