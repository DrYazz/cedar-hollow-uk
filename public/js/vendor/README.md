# Vendored libraries

Third-party code served from this site rather than a public CDN, so that a
filtering proxy between a visitor and jsdelivr cannot take a feature down. It
is also what pins the version: the pages used to ask for `splide@4.1`, a
range, so the CDN served whatever the latest 4.1.x was on the day and an
upstream release could change the site with no deploy from us.

Each file is the CDN's own build, byte for byte, with its MIT banner intact.
Nothing here is edited. To update one, fetch the new build, drop it in under
its version number, and repoint the `<script>` tags.

| file | package | version | fetched |
|---|---|---|---|
| `splide-4.1.4.min.js` | `@splidejs/splide` | 4.1.4 | 2026-09-24 |
| `splide-auto-scroll-0.5.3.min.js` | `@splidejs/splide-extension-auto-scroll` | 0.5.3 | 2026-09-24 |

Both are MIT, Copyright 2022 Naotoshi Fujita.
