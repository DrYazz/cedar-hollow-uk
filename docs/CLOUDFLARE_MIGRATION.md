# Migrating from Railway to Cloudflare

> **History.** This migration was done on 2 September 2026, rolled back to
> Railway on 4 September, and redone in October 2026 with **Workers Builds**,
> so the Worker now deploys on every push to `main` as Railway did, instead of
> by hand. Railway keeps
> building the site as a rollback copy until Phase 5. Day-to-day publishing is
> in [`PAGES_UPLOAD.md`](PAGES_UPLOAD.md).

Moves the site and the contact form onto Cloudflare Workers, at £0/month.
Phase 1 is done. Phases 2 onward are dashboard work.

> **Note on the first attempt.** This migration was initially built against a
> local clone that was 338 commits behind `origin/main` — a 26 July snapshot,
> before the map, the hero video, `about.html`, `sitemap.xml` and `robots.txt`
> existed. Everything below has been redone against `75e83a7` (2 September) and
> re-verified. If you are picking this up on another machine, `git pull` first.

## What is actually true today

Verified against the live site, live DNS and `origin/main` on **2 September
2026**.

| | Current state |
| - | - |
| `cedarhollow.uk` + `www` | **Live**, served by Railway (`Server: railway-hikari`) |
| DNS | **Already on Cloudflare**. Root and `www` are CNAMEs to `llvhd9wu.up.railway.app` and `kcdrw99h.up.railway.app`, both DNS-only |
| Inbound mail | **Google Workspace** — apex MX → `aspmx.l.google.com` and four alternates |
| SPF | `v=spf1 include:_spf.google.com ~all` |
| DKIM / DMARC | Neither exists (`google._domainkey` and `_dmarc` both empty) |
| Contact form | **Live and sending** — `/health` reports `mailConfigured: true` |
| Enquiries go to | `hello@thelabgroup.com`, sent via Gmail SMTP with an app password |
| Security headers | CSP, `Referrer-Policy`, `X-Content-Type-Options`, `X-XSS-Protection` — all set by **Railway's server**, not by the HTML |

Three consequences worth reading twice:

1. **The domain is already on Cloudflare.** No nameserver migration, no
   propagation wait. Cutover is a record change inside an account you control.
2. **Google Workspace owns the apex MX records.** Nothing here may touch them.
   This is what ruled out Cloudflare's own email sending — see Phase 2. Mail is
   sent from a subdomain instead, leaving the apex untouched.
3. **The security headers are Railway's, not the site's.** Moving hosts would
   have silently dropped them. `_headers` now carries them instead.

## Target

| Piece | From | To | Cost |
| - | - | - | - |
| Static site | Railway static service | Worker static assets | £0, free and unmetered |
| `/api/contact` | Railway Node service | Same Worker | £0, 100k req/day free |
| Map overview tiles | Railway static file | R2 bucket | £0, well inside the 10 GB free tier |
| Sending mail | Gmail SMTP + nodemailer | Resend HTTP API | £0 — 3,000/month, 100/day |
| Inbound mail | Google Workspace | **unchanged** | — |
| DNS | Cloudflare | **unchanged** | £0 |
| Analytics | disabled scaffold | Cloudflare Web Analytics | £0 |

## Changes in the repo

- [`wrangler.toml`](../wrangler.toml) — Worker config, asset serving, contact
  addresses. The Resend API key is a secret, not a var, and is not in the repo.
- [`worker/index.js`](../worker/index.js) — serves assets and handles
  `POST /api/contact`. Same request and response contract as the Express
  service, including the honeypot and the `_`-prefixed field convention.
  Sends through Resend's HTTP API. Covered by a 24-case test run: routing,
  submissions, request shape, failure handling, header injection.
- [`.assetsignore`](../public/.assetsignore) — keeps private files private, and keeps
  files over Cloudflare's 25 MiB per-asset limit out of the deploy. One
  oversized file fails the entire upload.
- [`_headers`](../public/_headers) — reproduces the security headers Railway sets.
- [`js/form-submit.js`](../public/js/form-submit.js) — calls `/api/contact`
  same-origin, except on `*.railway.app` where it still calls the old service.
  That is what lets both deployments run side by side during the cutover.
- [`index.html`](../public/index.html) — the map's overview layer now loads from R2.
- [`sitemap.xml`](../public/sitemap.xml) — `.html` URLs rewritten to their canonical
  extensionless form, since Cloudflare redirects to those. Both forms work on
  Railway too, so this is safe either way.
- `.gitignore` — gained `.wrangler/`.

---

## Phase 1 — Deploy the Worker to a temporary URL — DONE

Live at **https://cedar-hollow-uk.dry-sky-b32b.workers.dev**, account
`Hello@thelabgroup.com's Account`. The production site was never touched.

```bash
npx wrangler login
npx wrangler deploy
```

- [x] 571 assets deployed. The homepage is **byte-identical** to what
      `cedarhollow.uk` serves, apart from the one intended map URL change.
- [x] `about`, `robots.txt`, `sitemap.xml`, `site.webmanifest`,
      `map/detail.pmtiles` and `images/hero-loop.mp4` all serve.
- [x] `/health` returns `{"ok":true,"mailConfigured":true}`.
- [x] `docs/`, `form-handler/`, `.claude/`, `.wrangler/`, `_headers` and the
      oversized files all return **404**. `docs/TODO.md` returns 200 on Railway
      today, so this closes a live exposure.
- [x] CSP and the other three security headers are present on every response.
- [x] `POST /api/contact` reaches the Worker. It returns 503 until the Resend
      key is set in Phase 2, which is expected.

**Two things the first deploy taught us.**

1. Wrangler creates a `.wrangler/` directory *during* deploy, and the first run
   published it — account ID and the Worker's source map included.
   `.assetsignore` and `.gitignore` now exclude it. If you ever see `.wrangler`
   in the upload list, stop and check those lines are still there.
2. **URLs lose the `.html` extension.** Workers 307s `/about.html` to `/about`;
   Railway serves both directly. Nothing breaks — query strings survive, so the
   homepage search still reaches `/search-results?location=...` — and old URLs
   keep working. The sitemap now lists the canonical form. To remove the
   redirect hop entirely, update the links in the HTML; don't change
   `html_handling`, which also governs how `/` finds `index.html`.

## Phase 1b — Map tiles on R2 — DONE

`map/southern-england.pmtiles` is **26.50 MiB**, over Cloudflare's 25 MiB
per-asset cap on both Free and Paid. It is excluded from the deploy and served
from R2 instead. `map/detail.pmtiles` is 6 MiB and still ships with the site.

Done: bucket `cedar-hollow-map` created, tileset uploaded, public access
enabled, CORS configured for the three site origins with `range` allowed and
`etag`/`content-range` exposed — PMTiles reads the file by byte range, so both
matter. Verified: preflight 204, ranged GET 206.

- [x] **Custom domain attached.** `tiles.cedarhollow.uk` connected to the
      bucket and serving; `index.html` points at it and the `pub-*.r2.dev` URL
      is no longer referenced. Verified: preflight 204, ranged GET 206 with the
      right `Access-Control-Allow-Origin`. The CORS rules needed no change —
      allowed *origins* are the site hosts, which did not change.

## Phase 2 — Turn on sending, via Resend — DONE

**Why not Cloudflare's own sender.** Email Sending is gated behind the Workers
Paid plan in full — the dashboard offers only "Purchase Workers Paid". Its
documented free path, sending to a verified destination address, requires Email
Routing to be configured on the domain, and that wizard demands the apex MX
records: it reports the five Google `aspmx` entries as "conflicting records"
and offers to remove them. Those records are the business's email. Resend's free
tier costs nothing and needs no apex DNS change at all.

**a. Create the account and add the sending subdomain.** [resend.com](https://resend.com)
→ sign up (no card needed) → **Domains** → **Add Domain** → `send.cedarhollow.uk`.
Pick an EU region if offered.

> Use the **subdomain**, not `cedarhollow.uk`. Resend recommends it for
> deliverability, and it keeps every record away from the apex SPF and the
> Google MX records.

**b. Add the DNS records Resend gives you** in Cloudflare DNS — a DKIM TXT, an
SPF TXT and an MX, all on `send.cedarhollow.uk`. Set them to **DNS only** (grey
cloud). Verification is usually minutes.

- [x] Resend shows `send.cedarhollow.uk` as **Verified** (2026-09-02, eu-west-1,
      auto-configured through the Cloudflare integration).
- [x] `cedarhollow.uk`'s own MX records verified untouched — still the five
      Google `aspmx` entries, and the apex SPF is unchanged.
- [ ] The SPF TXT and feedback MX on `send.cedarhollow.uk` were not resolving
      after verification; only DKIM was. Not blocking — DKIM alone is what
      Resend and Gmail check — but add them for bounce handling when convenient.

**c. Create an API key** — Resend → **API Keys** → **Create**, sending
permission is enough — and store it as a Worker secret. It must never go in the
repo:

```bash
npx wrangler secret put RESEND_API_KEY
```

**d. Deploy and test.**

```bash
npx wrangler deploy
npx wrangler tail          # optional, to watch the submission
```

- [x] Live submission returned `{"ok":true}`.
- [x] Mail arrived **in the inbox, not spam**, at `hello@thelabgroup.com` from
      `Cedar Hollow website <website@send.cedarhollow.uk>`.
- [x] Reply goes to the enquirer.

## Phase 3 — Cut the domain over — DONE 2026-09-02

**Record the current DNS first**, so a rollback is mechanical:

| Host | Type | Current value | Proxy |
| - | - | - | - |
| `cedarhollow.uk` | CNAME | `llvhd9wu.up.railway.app` | DNS only |
| `www.cedarhollow.uk` | CNAME | `kcdrw99h.up.railway.app` | DNS only |

**Cloudflare will not replace the record for you.** Adding a custom domain
fails with *"Hostname already has externally managed DNS records"* — you must
delete the existing CNAME in DNS → Records first, then add the custom domain.
That leaves a gap of a few seconds where the hostname does not resolve.

Done `www` first as a rehearsal, with the apex still on Railway, then the root.
Worth repeating that order for any similar cutover: it puts the risk on the
hostname nobody notices.

- [x] Both hostnames serve `Server: cloudflare`; identical page bytes to what
      Railway served.
- [x] All pages, `robots.txt`, `sitemap.xml`, `map/detail.pmtiles` and the hero
      video serve. Old `.html` URLs 307 to their canonical form; the search
      query string survives.
- [x] `docs/`, `form-handler/`, `.wrangler/`, `_headers` and the oversized
      files all 404 — the public exposure on Railway is closed.
- [x] All four security headers present.
- [x] Live form submission from `cedarhollow.uk` returned `{"ok":true}`.
- [x] **Apex MX and SPF verified unchanged** — five Google `aspmx` records
      intact, Google Workspace undisturbed.
- [x] Map tiles serve from `tiles.cedarhollow.uk` with the apex as an allowed
      CORS origin.
- [ ] **Open the site in a browser and confirm the map visually renders** — both
      the overview and the two property insets. HTTP checks cannot prove this.

**Pick a canonical host** — still open from the audit. **Rules** → **Redirect
Rules** → redirect `www.cedarhollow.uk/*` to `https://cedarhollow.uk/$1`, 301.

## Phase 4 — Analytics, optional

**Web Analytics** → add `cedarhollow.uk`. It is cookieless, so
[`cookies.html`](../public/cookies.html) stays accurate and no consent banner is needed
— the same reasoning that made Plausible the recommendation in
[`js/analytics.js`](../public/js/analytics.js), without the subscription. Leave
`PROVIDER = "none"` in that file; Cloudflare's beacon is separate from it.

## Phase 5 — Decommission Railway

Leave Railway running for a few days, and only start this once real enquiries
have arrived through the new endpoint.

- [ ] Remove the custom domains from the Railway `cedar-hollow-uk` service.
- [ ] Delete the `cedar-hollow-uk` and `form-handler` services, or the project.
- [ ] **Revoke the Gmail app password** in the Google account that owns
      `hello@thelabgroup.com`. It sits in plain text in the Railway service
      variables and nothing needs it any more.
- [ ] Delete `form-handler/` from the repo.
- [ ] Remove the `railway.app` branch in [`js/form-submit.js`](../public/js/form-submit.js).
- [ ] Delete [`DNS_SETUP.md`](DNS_SETUP.md) — it documents a Railway setup
      that no longer exists.

Optional tidy-up afterwards: move the site files into a `public/` directory and
point `[assets] directory` at it, which makes most of `.assetsignore`
unnecessary.

---

## Rollback

| Phase | To undo |
| - | - |
| 1, 1b, 2 | Nothing to undo. Production is untouched throughout. |
| 3 | Delete the custom domains from the Worker and restore the two CNAMEs in the table above. Back on Railway in seconds. |
| 5 | Not reversible once the services are deleted, which is why it is last. |

## Troubleshooting

| Symptom | Cause |
| - | - |
| `Resend 403: The domain is not verified` | `send.cedarhollow.uk`'s DNS records are missing or still propagating |
| `Resend 401` | `RESEND_API_KEY` is wrong, or was never set with `wrangler secret put` |
| `Resend 422` | `CONTACT_FROM` is not on the verified subdomain |
| Form returns 503 | No API key on the Worker — set the secret |
| Form returns 200 but no email | Check spam, then `npx wrangler tail`. Submissions are always logged, so nothing is lost |
| Deploy fails on file size | Something over 25 MiB is not excluded in `.assetsignore` |
| Map loads but the zoomed-out layer is blank | R2: check the bucket's CORS origins include the host you are on, and that `range` is in the allowed headers |
| Map tiles 404 | The `r2.dev` URL changed, or the custom domain was attached without updating `index.html` |
| `docs/TODO.md` still loads | `.assetsignore` did not apply — confirm it sits at the repo root |
| Mail to `hello@cedarhollow.uk` stops | The apex MX records were changed. Restore the five Google `aspmx` records immediately |

## What still costs money

Nothing. R2 storage is 26.5 MiB against a 10 GB free tier and R2 egress is free;
Resend's free tier is 3,000 emails a month with a **100/day cap**. An enquiry
form will not approach either.

The daily cap is the one to watch: if the form is ever hit by a burst — a
campaign, or a bot that defeats the honeypot — sends beyond 100 in a day fail
with a 502 and the submission is only preserved in the Worker logs. Worth a
glance at Resend's dashboard after any spike in traffic.
