# Making changes to the site

How to edit and publish `cedarhollow.uk`. The site runs on a **Cloudflare
Worker** that serves every static file plus the contact-form endpoint. See
[`docs/CLOUDFLARE_MIGRATION.md`](CLOUDFLARE_MIGRATION.md) for how it got
there and what to do if it needs rolling back.

## The loop

```bash
# 1. edit files, then preview locally
npx wrangler dev            # the real site at localhost:8787, Worker and all

# 2. publish: merge or push to main
git add -A && git commit -m "..." && git push
```

**Pushing to `main` is what changes the live site.** Cloudflare Workers Builds
watches the GitHub repo and runs `npx wrangler deploy` on every push to `main`,
so a merged pull request is live a minute or two later. Progress and logs are
under **Workers & Pages → cedar-hollow-uk → Deployments**, and GitHub shows a
tick or cross against the commit.

Pushes to any other branch build a **preview version** with its own URL and
leave the live site alone, which is a quick way to show someone a change
before merging it.

Don't run `npx wrangler deploy` by hand. It works, but it publishes whatever is
in your folder rather than what is on `main`, and the next push overwrites it
anyway. See "What to do if someone updates the site but not GitHub" below.

Only changed files upload.

`wrangler dev` watches the assets directory, which is `public/` — the site and
nothing else. That boundary is why it works: when the assets directory was the
repo root, wrangler's own scratch files under `.wrangler/` counted as site
changes and put dev into an endless reload loop.

Two things about dev that look like faults and are not:

- `/health` reports `"mailConfigured":false` locally. Secrets live at Cloudflare,
  not on your machine. Use `npx wrangler dev --remote` to test an actual send.
- For plain HTML or CSS edits you do not need dev at all — open the file, or run
  any static server inside `public/`. Dev is for exercising `/api/contact`.

## If something goes wrong

```bash
npx wrangler rollback       # back to the previous version, in seconds
npx wrangler deployments list
```

Rolling back is almost always better than fixing forward under pressure. You
can also pick a specific version from **Workers & Pages → cedar-hollow-uk →
Deployments**.

A rollback only lasts until the next push to `main`, which deploys `main`
again. So roll back to stop the damage, then `git revert` the bad commit and
push, so that `main` and the live site agree.

To see what the live Worker is doing, including every form submission:

```bash
npx wrangler tail
```

## Three things that will bite you

| Situation | What happens | What to do |
| - | - | - |
| A file over **25 MiB** | The entire deploy fails, not just that file | Put it in R2, as `map/southern-england.pmtiles` is. Ask before adding large media |
| A file that should stay private | **It gets published** — if it is inside `public/`. `docs/TODO.md` was publicly readable on Railway for months | Keep it outside `public/` |
| A new page | Nothing links to it and nothing indexes it | Link it from the nav/footer, and add it to [`public/sitemap.xml`](../public/sitemap.xml) using the extensionless URL |

Everything inside `public/` is published; everything outside it is not. That
directory boundary is the whole protection — `public/.assetsignore` now only has
to exclude the one oversized map tileset, rather than guarding a list of private
files by name.

## Common tasks

**Change text or images on a page.** Edit the `.html` file, `wrangler dev` to
check it, deploy, commit.

**Add a page.** Copy an existing one for the header/footer shell, add it to
`sitemap.xml`, and link it from somewhere real.

**Add an image.** Drop it in `images/`, reference it with a relative path.
Prefer `.webp` and keep it well under 25 MiB.

**Change where enquiries go.** Edit `CONTACT_TO` in [`wrangler.toml`](../wrangler.toml)
and deploy. The address does not need verifying anywhere — Resend sends to
whatever you set.

**Rotate the Resend API key.** Create a new key at
[resend.com](https://resend.com) → API Keys (Sending access,
`send.cedarhollow.uk`), then:

```bash
npx wrangler secret put RESEND_API_KEY
```

Delete the old key afterwards. The key is never in the repo — it lives
encrypted at Cloudflare and is only readable by the Worker at runtime.

**The Instagram grids.** The Oxford and Dorset pages show each account's four
latest posts, fetched by the Worker with one token per account:
`IG_TOKEN_OXFORD` (@cedarhollowoxford) and `IG_TOKEN_DORSET`
(@mallinsonswoodlandretreat), set as secrets under **Workers & Pages →
cedar-hollow-uk → Settings → Variables and Secrets**. Without a working token
the page keeps the four posts written into its HTML, so nothing ever looks
broken; it just stops updating.

Tokens last 60 days. Every Monday the Worker renews both and keeps the renewed
copies in the KV namespace `cedar-hollow-instagram`, so nobody needs to touch
them. `https://cedarhollow.uk/health` shows the last renewal date per account
under `instagramRenewed`. If a date there is more than about a fortnight old,
renewal is failing: `npx wrangler tail` during the Monday 04:17 UTC run, or the
Worker's logs, give the reason. If a token has lapsed altogether, generate a new
one in the Meta developer dashboard (the app's **Instagram → API setup with
Instagram login → Generate token**) and set it as the secret again; the Worker
switches to it at once.

**Check whether mail is working.** `https://cedarhollow.uk/health` returns
`{"ok":true,"mailConfigured":true}`. Resend → **Logs** shows delivery status
for every send.

## URLs drop the .html

Workers redirects `/about.html` to `/about` with a 307. Old links keep working;
query strings survive. Use the extensionless form in `sitemap.xml` and in any
new links. Don't change `html_handling` in `wrangler.toml` to "fix" this — it
also governs how `/` finds `index.html`.

## ⚠️ This is a Webflow export with hand-written code in it

`index.html` carries code Webflow does not know about:

- the Protomaps/Leaflet map and its two property insets
- `js/form-submit.js`, which intercepts the contact form
- `js/analytics.js`
- `js/listings.js` and the client-side search

**Re-exporting from Webflow and overwriting `index.html` destroys all of it,
silently.** If a design change has to come from Webflow, merge it deliberately
rather than replacing the file, and check the map and the contact form
afterwards.

## Where things live

| | |
| - | - |
| Site pages, `css/`, `js/`, `images/`, `fonts/`, `map/` | **`public/`** — everything in there is published, nothing outside it is |
| Contact endpoint | [`worker/index.js`](../worker/index.js) → `POST /api/contact` |
| Worker config, contact addresses | [`wrangler.toml`](../wrangler.toml) |
| What must never be published | [`public/.assetsignore`](../public/.assetsignore) |
| Security headers (CSP etc.) | [`public/_headers`](../public/_headers) — not in the HTML |
| Map overview tileset, 26.5 MiB | R2 bucket `cedar-hollow-map`, served at `tiles.cedarhollow.uk` |
| Outbound mail | Resend, from `website@send.cedarhollow.uk` |
| Inbound mail for `@cedarhollow.uk` | **Google Workspace — do not touch the apex MX records** |

## Deploy failures

| Symptom | Cause |
| - | - |
| Upload fails on file size | Something over 25 MiB is not in `.assetsignore` |
| `.wrangler` appears in the upload list | The `.wrangler` line was removed from `.assetsignore`; it publishes your account ID and the Worker source map |
| Deploy succeeds, site unchanged | Browser cache, or you edited a file that is excluded |
| Form returns 503 | `RESEND_API_KEY` is not set on the Worker |
| Form returns 502 | Resend rejected it — `npx wrangler tail` shows the reason |

## What to do if someone updates the site but not GitHub

**A deploy replaces the whole site, not just the files that changed.** The asset
manifest is rebuilt from whatever folder you deploy from, so a file that is not
in your folder is removed from the live site.

That makes the danger the opposite of what people expect:

> Their page goes live and looks fine. Then **you** deploy from a checkout that
> does not have it, and it silently disappears. No conflict, no warning, no
> error. Deploys are last-write-wins across the entire site.

Git would have called that a conflict. A deploy just overwrites.

Note that nobody can add a page through the Cloudflare dashboard — the editor
there only edits the Worker script, not static files. So "someone changed the
site directly" always means someone ran `wrangler deploy` from another folder.

### 1. Don't deploy yet, and don't push to main

Your deploy is the thing that would destroy their work, and **any push to
`main` is a deploy**, including merging someone else's pull request. Sort out
the drift first.

### 2. Confirm it happened

```bash
npx wrangler deployments list
```

Each entry shows the author, the timestamp, and `Source: Upload`. Anything you
did not do yourself is worth investigating before you overwrite it.

### 3. Find what differs

Compares every page in the repo against what is actually live:

```bash
cd public
for f in *.html; do
  url="https://cedarhollow.uk/${f%.html}"
  [ "$f" = "index.html" ] && url="https://cedarhollow.uk/"
  if curl -s --max-time 25 "$url" | diff -q --strip-trailing-cr - "$f" >/dev/null 2>&1
  then echo "same      $f"
  else echo "DIFFERS   $f"
  fi
done
```

`--strip-trailing-cr` matters: the repo is checked out with CRLF line
endings on Windows, so without it every page reports as different. This will
not spot a page that exists live but not in the repo at all — for that, check
`https://cedarhollow.uk/sitemap.xml` and the deployment they made.

### 4. Harvest it while it is still live

There is no command to download the assets from a deployment, so take them over
HTTP before anything overwrites them:

```bash
curl -s https://cedarhollow.uk/thatpage -o thatpage.html
```

**If it has already been clobbered:** `npx wrangler rollback`, or deploy the
older version from the Deployments tab, pull the file down, then redeploy the
current version. That reverts the whole site for a moment, so do it deliberately
and quickly.

### 5. Put it back in the repo properly

Treat it as a normal change: add the file, add it to `sitemap.xml` with an
extensionless URL, link it from somewhere real, then:

```bash
git add -A && git commit -m "..." && git push
```

The push deploys it, and from then on `main` and production agree again.

### Avoiding it

- **Publish through GitHub, never `wrangler deploy` from a laptop.** Every
  deployment made by Workers Builds is tied to a commit; a `Source: Upload`
  entry in `wrangler deployments list` means someone deployed by hand, and is
  worth asking about.
- **If you must deploy by hand**, do it from a clean, up-to-date checkout:
  `git pull` first. A clone once five weeks behind produced a deploy of a
  five-week-old site.

## How push-to-deploy is set up

**Workers & Pages → cedar-hollow-uk → Settings → Build** connects the Worker to
`thelabgroup/cedar-hollow-uk` through Cloudflare's GitHub app:

| Setting | Value |
| - | - |
| Production branch | `main` |
| Build command | *(empty: there is nothing to build)* |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler preview` (needs the `[previews]` block in `wrangler.toml`) |
| Root directory | `/` |

There is no token in the repo or in GitHub's secrets; Cloudflare manages the
build's credentials itself. `wrangler.toml` is still the config: change the
Worker's name there and builds start failing, because the name must match the
Worker the repo is connected to.

The custom domains (`cedarhollow.uk`, `www.cedarhollow.uk`) are attached under
**Settings → Domains & Routes**, not in `wrangler.toml`, and deploys leave them
alone.

Secrets (`RESEND_API_KEY`, `IG_TOKEN_OXFORD`, `IG_TOKEN_DORSET`) live on the
Worker, not in the build settings, and survive every deploy.
