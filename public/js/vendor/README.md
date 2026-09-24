# Vendored libraries

Third-party code served from this site rather than a public CDN, so that a
filtering proxy between a visitor and that CDN cannot take a feature down.
It is also what pins the versions: the pages used to ask for `splide@4.1`, a
range, so the CDN served whatever the latest 4.1.x was on the day and an
upstream release could change the site with no deploy from us.

Each file is the publisher's own build, byte for byte, licence banners
intact. Nothing here is edited, and `.gitattributes` keeps a checkout from
rewriting the line endings. To update one, fetch the new build, drop it in
under its version number, and repoint the tags that load it.

| path | package | version | fetched |
|---|---|---|---|
| `splide-4.1.4.min.js` | `@splidejs/splide` | 4.1.4 | 2026-09-24 |
| `splide-auto-scroll-0.5.3.min.js` | `@splidejs/splide-extension-auto-scroll` | 0.5.3 | 2026-09-24 |
| `leaflet-1.9.4/` | `leaflet` | 1.9.4 | 2026-09-24 |

Splide is MIT, Copyright 2022 Naotoshi Fujita. Leaflet is BSD-2-Clause,
Copyright 2010-2023 Volodymyr Agafonkin and CloudMade.

`leaflet-1.9.4/images/` is there because `leaflet.css` reaches for those
files by relative path. This site draws its own pins with `L.divIcon` and
has no layers control, so nothing currently asks for them, but a copy of a
library that 404s the moment someone uses a default marker is not really a
copy of the library.
