/*
 * Cedar Hollow -- Worker entry point.
 *
 * One Worker serves the whole site:
 *   - every static file, via the ASSETS binding (see wrangler.toml)
 *   - POST /api/contact, the homepage contact form
 *   - GET /api/instagram, the live Instagram grids
 *   - weekly, monthly and yearly emails about the site's visitors (see
 *     "Visitor reports" below)
 *
 * This replaces the Express + nodemailer service in form-handler/. The request
 * and response shapes are identical, so js/form-submit.js only needed its
 * endpoint URL changed.
 *
 * Mail goes out through Resend's HTTP API rather than Cloudflare's send_email
 * binding. Cloudflare's free send path requires Email Routing to own the
 * domain's MX records, and cedarhollow.uk's belong to Google Workspace; the
 * paid Email Sending product would avoid that, but Resend's free tier covers
 * this form many times over. Nothing here touches the apex DNS: the sender is
 * a subdomain Resend verifies on its own.
 */

const CONTACT_PATH = "/api/contact";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_BODY_BYTES = 64 * 1024; // parity with the old express.json({ limit: "64kb" })

/*
 * Instagram.
 *
 * The grids on the two location home pages were curated by hand because the
 * Basic Display API was retired in 2024 and its replacement needs a server to
 * hold a token. There is a server now, so this is that.
 *
 * The two woodlands are two accounts, so two tokens. Each is a secret:
 *
 *   npx wrangler secret put IG_TOKEN_OXFORD
 *   npx wrangler secret put IG_TOKEN_DORSET
 *
 * Never a var in wrangler.toml -- that file is committed.
 *
 * Without a token the endpoint answers 503 and the page keeps the markup it
 * shipped with, so the grid is never empty and nothing breaks while a token
 * is missing or expired.
 *
 * media_url and thumbnail_url are signed and expire within days, which is why
 * these were downloaded in the first place. Handing them straight to the
 * browser is fine as long as they are fresh, hence a cache measured in
 * minutes rather than days.
 *
 * The tokens themselves expire after 60 days. Instagram will swap a token for
 * a fresh 60-day one if it is at least a day old and not yet expired, so a
 * weekly cron (see [triggers] in wrangler.toml, and scheduled() below) does
 * that and keeps the result in KV. A Worker cannot rewrite its own secrets,
 * hence KV.
 *
 * Each KV entry records a hash of the secret it descends from. Setting a new
 * secret -- after a lapse, or for a different account -- changes the hash, and
 * the stale KV entry is ignored from that moment rather than shadowing it.
 */
const IG_PATH = "/api/instagram";
const IG_ENDPOINT = "https://graph.instagram.com/me/media";
const IG_REFRESH_ENDPOINT = "https://graph.instagram.com/refresh_access_token";
const IG_FIELDS = "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp";
const IG_COUNT = 4;
const IG_EDGE_TTL = 1800;   // 30 minutes at the edge
const IG_BROWSER_TTL = 900; // 15 minutes in the browser
const IG_FAIL_TTL = 120;    // back off briefly rather than hammering on failure

const IG_TOKENS = {
  oxford: "IG_TOKEN_OXFORD",
  dorset: "IG_TOKEN_DORSET",
};

/*
 * Visitor reports.
 *
 * Emails of Cloudflare Web Analytics figures for cedarhollow.uk, sent by the
 * cron in wrangler.toml:
 *
 *   - every Monday, the week just ended, Monday to Sunday;
 *   - on the 1st of every month, the month just ended;
 *   - on 1 January, the year just ended, with graphs of it month by month.
 *
 * Each comes in three parts -- the whole website, then Cedar Hollow Oxford,
 * then Cedar Hollow Dorset -- and each part has the same figures: the
 * websites visitors came from, split by computer, phone and tablet; the
 * totals against the period before; the visits on each day of the week and
 * in each hour of the day; and the most-read pages. A woodland's
 * part counts the visits that began on its own pages, the addresses
 * starting /oxford or /dorset, or moved onto them from elsewhere on the site
 * -- from the home page, say -- and every view of those pages. A visit that
 * reaches both woodlands counts in each, and once in the whole website's.
 * Analytics without cookies cannot follow one person from page to page; what
 * Cloudflare does record is the page each page view came from, and a move
 * onto a woodland's pages from outside them is what is counted. The full
 * breakdown, by part of the site, website and device, comes attached as a
 * spreadsheet.
 *
 * The figures come from Cloudflare's GraphQL Analytics API. It keeps them
 * exact for seven days and as a one-in-ten sample after that, and answers any
 * question spanning more than a week from the sample -- which, on a site this
 * size, can turn a website that sent two visitors into none, or ten. So the
 * cron runs every morning and reads the day just ended while it is exact, and
 * keeps it in KV (IG_KV, beside the Instagram tokens) twice over: whole, under
 * visits:3:d:YYYY-MM-DD, for the week's report; and added to its month's
 * running totals, under visits:3:m:YYYY-MM, which the month's and the year's
 * reports read. A year is twelve small reads rather than 365, which matters:
 * on the Workers free plan every KV read counts against fifty requests a run.
 * A day the cron missed is read from the API when a week's report next needs
 * it, as exactly as the API still has it. Kept figures last three years,
 * outliving the dashboard's six months. Bots are left out throughout, as the
 * dashboard leaves them out by default. (Records under visits:day: and
 * visits:d: hold days in earlier shapes -- before the split by woodland, and
 * before moves between parts were counted -- and are left to expire.)
 *
 * The API needs a token with Account Analytics: Read. It is a secret, set once:
 *
 *   npx wrangler secret put ANALYTICS_API_TOKEN
 *
 * The account and the Web Analytics site are vars in wrangler.toml, as is
 * REPORT_TO, the address the reports go to.
 *
 * POST /api/visitor-report sends one on demand, for checking a change or
 * re-sending a period. It must carry that same token as a bearer token, so
 * nobody without it can trigger mail.
 *
 *   ?week=2026-10-05   the week containing that day
 *   ?month=2026-10     that month
 *   ?year=2026         that year
 *                      (none of the three: last week)
 *   ?dry=1             answer with the email as JSON instead of sending it
 */
const REPORT_PATH = "/api/visitor-report";
const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const REPORT_TZ = "Europe/London";
const REPORT_TOP_SOURCES = 15;
const REPORT_TOP_PAGES = 10;
const CHART_SOURCES = 5;                  // websites named in the year's graph
const DAY_KEY = "visits:3:d:";            // + YYYY-MM-DD, in IG_KV; 3 is the shape
const MONTH_KEY = "visits:3:m:";          // + YYYY-MM
const YEAR_KEY = "visits:3:y:";           // + YYYY: the totals, kept by its report
const SITE_HOST = "cedarhollow.uk";       // a page view referred from here moved within the site
const KEEP = 3 * 365 * 86400;             // seconds kept figures last: three years
const API_DAYS = 180;                     // how far back the API has anything
const API_READS = 4;                      // API reads a cron run may add for missed days
const DAY_PAGES = 500;                    // pages kept per day -- all of them, in practice,
const MONTH_PAGES = 500;                  // so each woodland's page views add up

// The parts of every report, in order. The shared pages have no part of
// their own: their visits count in the whole website's.
const PARTS = [
  ["all", "The whole website"],
  ["oxford", "Cedar Hollow Oxford"],
  ["dorset", "Cedar Hollow Dorset"],
];
const BEGAN = [
  ["oxford", "Oxford pages"],
  ["dorset", "Dorset pages"],
  ["main", "Shared pages (home, About, Careers…)"],
];

// Nothing was counted before 1 October 2026, and most visits went uncounted
// until the afternoon of the 2nd, when the beacon went back in (pages served
// from Workers static assets never got the one Cloudflare used to inject). A
// period starting before then is incomplete, and is never compared against.
const COUNTED_FROM = Date.UTC(2026, 8, 30, 23);  // midnight, 1 Oct 2026, London
const COUNTED_FULLY = Date.UTC(2026, 9, 2, 14);  // 2 Oct 2026, mid-afternoon

// Friendlier names for the websites that send most visitors. A host not
// listed here is shown as itself, minus any leading www. A source with no
// dot in it is a link's ?utm_source= tag rather than a host (js/analytics.js
// keeps it as the visit's source): the common ones share their site's name,
// so a tagged visit and an untagged one from the same place add up together,
// and any other is shown as words ("spring-sale" is "Spring Sale").
const SOURCE_NAMES = [
  [/(^|\.)google\.[a-z.]+$|^com\.google\.|^google$/, "Google"],
  [/(^|\.)instagram\.com$|^(instagram|ig)$/, "Instagram"],
  [/(^|\.)facebook\.com$|^fb\.me$|^(facebook|fb)$/, "Facebook"],
  [/(^|\.)tiktok\.com$|^tiktok$/, "TikTok"],
  [/(^|\.)youtube\.com$|^youtu\.be$|^youtube$/, "YouTube"],
  [/(^|\.)coolstays\.com$|^coolstays$/, "Coolstays"],
  [/^t\.co$|(^|\.)(x|twitter)\.com$/, "X (Twitter)"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)yahoo\.com$/, "Yahoo"],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, "ChatGPT"],
  [/(^|\.)tripadvisor\.[a-z.]+$/, "Tripadvisor"],
  [/(^|\.)airbnb\.[a-z.]+$/, "Airbnb"],
  [/(^|\.)theoaks\.uk$/, "theoaks.uk (the old site)"],
];
const DIRECT = "Direct";
const WITHIN = {
  "@home": "Cedar Hollow home page",
  "@search": "Cedar Hollow search results",
  "@oxford": "Oxford pages",
  "@dorset": "Dorset pages",
  "@site": "Other Cedar Hollow pages",
};

const DEVICE_NAMES = { desktop: "Computer", mobile: "Phone", tablet: "Tablet" };
const DEVICE_ORDER = ["Computer", "Phone", "Tablet", "Other"];

/*
 * Clicks to book: a visit that went on to a booking site, sent by
 * js/analytics.js to /api/intent. Each is kept in IG_KV as a key of its own,
 * intent:1:YYYY-MM-DD:<visit>:<retreat>, with what is known about it in the
 * key's metadata -- so a click sent twice is kept once, and a day's clicks
 * are one list call to read -- and is added into its day's figures when the
 * day is kept.
 */
const INTENT_PATH = "/api/intent";
const INTENT_KEY = "intent:1:";
const INTENTS_FROM = "2026-10-04";        // the first day clicks to book were counted
const INTENT_DAYS = 90;                   // how long each click is kept on its own
// Every retreat a click can be for: its woodland and name. Oxford's and
// Dorset's own entries are clicks that named no retreat.
const RETREATS = {
  "cedar-hollow-treehouse": ["oxford", "Cedar Hollow Treehouse"],
  "fauns-hideaway": ["oxford", "Faun’s Hideaway"],
  "beavers-den": ["oxford", "Beaver’s Den"],
  oxford: ["oxford", "Oxford, retreat not chosen"],
  "woodsmans-treehouse": ["dorset", "The Woodsman’s Treehouse"],
  "dazzle-treehouse": ["dorset", "Dazzle Treehouse"],
  "pinwheel-treehouse": ["dorset", "Pinwheel Treehouse"],
  dorset: ["dorset", "Dorset, retreat not chosen"],
};
// Checked.in's names for the retreats, as its addresses spell them and as it
// names them when it reports a booking. Dorset's three moved to Checked.in on
// 5 October 2026, under their own account, from Mallinson's.
const CHECKED_IN = {
  theoaks: "cedar-hollow-treehouse",
  "fauns-hideaway": "fauns-hideaway",
  "beavers-den-1": "beavers-den",
  "the-woodsmans-treehouse": "woodsmans-treehouse",
  "dazzle-treehouse": "dazzle-treehouse",
  "pinwheel-treehouse": "pinwheel-treehouse",
};

/*
 * Bookings, as Checked.in -- Cedar Hollow's own booking system -- reports
 * them: POST /api/booking, with the BOOKING_SECRET secret as a bearer token,
 * for every direct booking once it is confirmed, and again should it be
 * cancelled. One that followed a click from this site carries that visit's
 * id and the website the visit came from (ref and src: the cin_ref and
 * cin_src js/analytics.js adds to every link to Checked.in). Each is kept as
 * booking:1:<id> in IG_KV -- a repeat, or the cancellation, overwrites it --
 * with what the reports need in the key's metadata, so all of them are one
 * list call to read. No guest's name or contact details are sent or kept.
 * Ids beginning "test-" are kept but left out of the reports, so Checked.in
 * can try the link against the live site.
 */
const BOOKING_PATH = "/api/booking";
const BOOKING_KEY = "booking:1:";

/*
 * Where visits come from, for the private map at /wdtcf.
 *
 * POST /api/visit -- { parts: ["all", "oxford" | "dorset"] }, from
 * js/analytics.js: "all" once a visit, and a woodland's name once the visit
 * reaches its pages (as partOf decides). Each is counted in VISITS_DB against
 * the London day and the town Cloudflare places the request in: request.cf's
 * country, region, city and their position. Nothing else is kept -- not the
 * address, not the visit's id, not the time -- and crawlers that run scripts
 * are turned away by their user agent. Answers 204, the counting done after.
 *
 * GET /wdtcf is the map, public/wdtcf/map.html, and /wdtcf/data the counts it
 * draws: one part, over a run of days. /wdtcf/report is the visitor report,
 * live, for the same page's other tab (see liveReport). All of it is behind the WDTCF_PASSWORD
 * secret (HTTP Basic: any user name, that password), and run_worker_first
 * sends every address under /wdtcf here first, so no file in public/wdtcf/ is
 * ever served without it.
 */
const VISIT_PATH = "/api/visit";
const MAP_PATH = "/wdtcf";
const MAP_PARTS = ["all", "oxford", "dorset"];
const NOT_A_VISITOR = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly/i;
const PRIVATE = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

/*
 * Directory-style spellings of the two woodland pages.
 *
 * /oxford/ matched nothing: there is a real public/oxford/ directory holding
 * the sub-pages, and no index.html inside it, so the trailing slash resolved
 * to a directory and 404ed while /oxford served fine. /dorset/ 404ed for the
 * plainer reason that no such directory exists.
 *
 * These live here rather than in public/_redirects because that file is not
 * being processed by this deployment -- it is served as an ordinary asset at
 * /_redirects, and none of its fifteen rules fire. The Worker does run, and
 * anything that matches no asset reaches it, which is exactly these two.
 */
const PAGE_ALIASES = {
  "/oxford/": "/oxford.html",
  "/dorset/": "/dorset.html",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const alias = PAGE_ALIASES[url.pathname];
    if (alias) {
      return Response.redirect(new URL(alias, url).toString(), 301);
    }

    // Sent here first by run_worker_first in wrangler.toml.
    if (url.pathname.endsWith(".mp4")) {
      return serveVideo(request, env);
    }

    if (url.pathname === CONTACT_PATH) {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed" }, 405);
      }
      return handleContact(request, env);
    }

    if (url.pathname === IG_PATH) {
      if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed" }, 405);
      }
      return handleInstagram(url, env, ctx);
    }

    if (url.pathname === REPORT_PATH) {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed" }, 405);
      }
      return handleReportRequest(request, url, env);
    }

    if (url.pathname === BOOKING_PATH) {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed" }, 405);
      }
      return handleBooking(request, env);
    }

    if (url.pathname === INTENT_PATH) {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed" }, 405);
      }
      return handleIntent(request, url, env, ctx);
    }

    if (url.pathname === VISIT_PATH) {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed" }, 405);
      }
      return handleVisit(request, url, env, ctx);
    }

    if (url.pathname === MAP_PATH || url.pathname.startsWith(MAP_PATH + "/")) {
      return visitorMap(request, url, env, ctx);
    }

    // Kept from the old service so the migration can be smoke-tested the same way.
    if (url.pathname === "/health") {
      const sites = Object.keys(IG_TOKENS).filter((s) => Boolean(env[IG_TOKENS[s]]));
      const renewed = {};
      for (const site of sites) {
        const stored = await igStored(env, site);
        if (stored && stored.from === (await sha256(env[IG_TOKENS[site]]))) {
          renewed[site] = stored.renewed;
        }
      }
      return json({
        ok: true,
        mailConfigured: mailReady(env),
        instagram: sites,
        instagramRenewed: renewed,
        visitorReports: analyticsReady(env) && mailReady(env),
        visitorMap: Boolean(env.VISITS_DB && env.WDTCF_PASSWORD),
      });
    }

    // Static assets normally never reach the Worker -- Cloudflare serves them
    // first -- but fall through explicitly so nothing depends on that ordering.
    return env.ASSETS.fetch(request);
  },

  // The cron in wrangler.toml, early every morning: keep yesterday's visitor
  // figures and send whichever visitor reports are due, and on Mondays also
  // renew the Instagram tokens. Each job fails on its own.
  async scheduled(event, env, ctx) {
    const now = event.scheduledTime || Date.now();
    const monday = new Date(londonDate(now)).getUTCDay() === 1;
    if (monday) ctx.waitUntil(refreshInstagramTokens(env));
    ctx.waitUntil(visitorCron(env, now, monday));
  },
};

/*
 * A video, with a request for part of it answered with that part.
 *
 * Browsers fetch video in pieces, and Safari -- every browser on an iPhone
 * -- asks first for bytes 0-1 and plays only if it gets just those back, as
 * 206 Partial Content. The asset server ignores Range and sends the whole
 * file every time, so a video played on an iPhone only once the browser
 * happened to have it cached: the home page's hero sat on its still until a
 * reload. So the whole file is asked for here, and the part wanted cut out
 * of it as it streams past; the rest is never read. One range only: a
 * request for several gets the whole file, which the standard allows.
 */
async function serveVideo(request, env) {
  const asked = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get("range") || "").trim());
  const ifRange = request.headers.get("if-range");
  const headers = new Headers(request.headers);
  headers.delete("range");
  headers.delete("if-range");
  const res = await env.ASSETS.fetch(new Request(request.url, { method: request.method, headers }));

  const out = new Headers(res.headers);
  out.set("accept-ranges", "bytes");
  // Anything but a plain range -- a HEAD, a 304, or a range of a copy that
  // has since changed (If-Range) -- gets the asset server's own answer.
  if (res.status !== 200 || !res.body || !asked || (!asked[1] && !asked[2]) || (ifRange && ifRange !== res.headers.get("etag"))) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  }

  // The asset binding does not always say how long a file is, and a part
  // must; then the file is read whole and the part cut from that.
  let size = Number(res.headers.get("content-length"));
  const whole = size ? null : new Uint8Array(await res.arrayBuffer());
  if (whole) size = whole.byteLength;

  // "bytes=500-999", "bytes=500-", or the last N, "bytes=-500".
  const start = asked[1] ? Number(asked[1]) : Math.max(0, size - Number(asked[2]));
  const end = asked[1] && asked[2] ? Math.min(Number(asked[2]), size - 1) : size - 1;
  if (start > end) {
    if (!whole) await res.body.cancel();
    out.delete("content-length");
    out.set("content-range", `bytes */${size}`);
    return new Response(null, { status: 416, headers: out });
  }

  out.set("content-range", `bytes ${start}-${end}/${size}`);
  out.set("content-length", String(end - start + 1));
  const part = whole
    ? whole.subarray(start, end + 1)
    : start === 0 && end === size - 1
      ? res.body
      : byteRange(res.body, start, end);
  return new Response(part, { status: 206, headers: out });
}

// Bytes start to end, inclusive, of a stream, which is cancelled after them.
function byteRange(body, start, end) {
  let at = 0;
  const part = body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        const from = Math.max(start - at, 0);
        const to = Math.min(end + 1 - at, chunk.byteLength);
        at += chunk.byteLength;
        if (from < to) controller.enqueue(chunk.subarray(from, to));
        if (at > end) controller.terminate();
      },
    })
  );
  // Of known length, so it goes with its Content-Length rather than chunked.
  return typeof FixedLengthStream === "function" ? part.pipeThrough(new FixedLengthStream(end - start + 1)) : part;
}

/*
 * POST /api/booking -- a booking, from Checked.in (see BOOKING_KEY):
 *
 *   { id, status: "confirmed" | "cancelled", property, created, arrival,
 *     departure, guests, total (in pence), currency, ref, src, channel }
 *
 * channel is where it was booked: "direct" -- on Checked.in itself, and the
 * default -- or the site Checked.in learnt of it from through that site's
 * calendar: "airbnb", "booking.com" and so on. Those calendars carry no
 * price and no visit, and "created" is when Checked.in first saw it.
 *
 * Answers 200 once it is kept, so Checked.in knows to try again otherwise.
 */
async function handleBooking(request, env) {
  if (!env.BOOKING_SECRET || !env.IG_KV) return json({ ok: false, error: "Not configured" }, 503);
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!given || !(await sameSecret(given, env.BOOKING_SECRET))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const text = await request.text().catch(() => "");
  if (text.length > 4000) return json({ ok: false, error: "Too large" }, 413);
  let b = null;
  try {
    b = JSON.parse(text);
  } catch (err) {}
  if (!b || typeof b !== "object") return json({ ok: false, error: "Not JSON" }, 400);

  const id = String(b.id || "");
  const status = String(b.status || "");
  const created = Date.parse(String(b.created || ""));
  if (!/^[\w.:-]{1,100}$/.test(id) || !["confirmed", "cancelled"].includes(status) || !created) {
    return json({ ok: false, error: "Needs an id, a status of confirmed or cancelled, and when it was created" }, 400);
  }
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
  const whole = (v) => (v !== null && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);
  const arrival = day(b.arrival);
  const departure = day(b.departure);
  const src = String(b.src || "").toLowerCase();
  const channel = String(b.channel || "direct").toLowerCase();
  const direct = !/^[a-z0-9.-]{1,30}$/.test(channel) || channel === "direct";
  const booking = {
    id,
    status,
    property: String(b.property || "").slice(0, 60),
    retreat: CHECKED_IN[String(b.property || "")] || "oxford",
    created: new Date(created).toISOString(),
    // The London day it was made on: the day the reports count it in.
    date: isoDate(londonDate(created)),
    arrival,
    departure,
    nights: arrival && departure ? Math.max(0, Math.round((Date.parse(departure) - Date.parse(arrival)) / DAY)) : null,
    guests: whole(b.guests),
    total: whole(b.total),
    currency: /^[A-Z]{3}$/.test(String(b.currency || "")) ? String(b.currency) : "",
    ref: /^[a-z0-9]{8,40}$/.test(String(b.ref || "")) ? String(b.ref) : "",
    src: /^[a-z0-9.-]{1,100}$/.test(src) ? src : "",
    channel: direct ? "direct" : channel,
    received: new Date().toISOString(),
  };
  try {
    await env.IG_KV.put(BOOKING_KEY + id, JSON.stringify(booking), {
      expirationTtl: KEEP,
      metadata: {
        d: booking.date,
        s: status,
        r: booking.retreat,
        f: booking.ref ? 1 : 0,
        h: booking.src,
        t: booking.total,
        c: booking.currency,
        n: booking.nights,
        k: booking.channel,
      },
    });
  } catch (err) {
    console.error("[booking] could not keep:", err && err.message ? err.message : err);
    return json({ ok: false, error: "Could not keep it; try again" }, 500);
  }
  return json({ ok: true });
}

// Every booking kept, from its key's metadata, or null if they could not be
// read.
async function allBookings(env) {
  if (!env.IG_KV) return [];
  try {
    const list = [];
    let cursor;
    do {
      const page = await env.IG_KV.list({ prefix: BOOKING_KEY, cursor });
      // Bookings whose id begins "test-" are Checked.in trying the link out.
      for (const { name, metadata: m } of page.keys) {
        if (m && m.d && !/^test-/i.test(name.slice(BOOKING_KEY.length))) list.push(m);
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return list;
  } catch (err) {
    console.error("[report] could not read bookings:", err && err.message ? err.message : err);
    return null;
  }
}

/*
 * POST /api/intent -- a click to book, from js/analytics.js:
 *
 *   { v: visit id, s: website the visit came from, l: page it landed on,
 *     p: page the click was on, h: booking address, r: retreat, if known }
 *
 * Kept as one key per visit and retreat (see INTENT_KEY), with the website,
 * the device, the retreat and the parts of the site it landed and clicked
 * on. Only this site's own pages send these, and anything not a booking
 * address is turned away. Answers 204, the keeping done after.
 */
async function handleIntent(request, url, env, ctx) {
  const origin = request.headers.get("origin") || (request.headers.get("referer") || "").replace(/^(https?:\/\/[^/]+).*$/, "$1");
  if (origin !== url.origin) return new Response(null, { status: 403 });
  const text = await request.text().catch(() => "");
  if (text.length > 2000) return new Response(null, { status: 413 });
  let b;
  try {
    b = JSON.parse(text);
  } catch (err) {
    return new Response(null, { status: 400 });
  }
  if (!b || typeof b !== "object") return new Response(null, { status: 400 });
  const visit = String(b.v || "");
  const retreat = retreatOf(String(b.h || ""), String(b.r || ""));
  if (!/^[a-z0-9]{8,40}$/.test(visit) || !retreat) return new Response(null, { status: 400 });

  const host = String(b.s || "").toLowerCase();
  const path = (p) => (typeof p === "string" && /^\/\S{0,300}$/.test(p) ? p : "/");
  const metadata = {
    s: /^[a-z0-9.-]{1,100}$/.test(host) ? host : "",
    d: deviceOf(request.headers.get("user-agent") || ""),
    r: retreat,
    l: partOf(path(b.l)),
    p: partOf(path(b.p)),
  };
  const key = `${INTENT_KEY}${isoDate(londonDate(Date.now()))}:${visit}:${retreat}`;
  if (env.IG_KV) {
    ctx.waitUntil(
      env.IG_KV.put(key, "", { metadata, expirationTtl: INTENT_DAYS * 86400 }).catch((err) =>
        console.error("[intent] could not keep:", err && err.message ? err.message : err)
      )
    );
  }
  return new Response(null, { status: 204 });
}

// POST /api/visit: see VISIT_PATH.
async function handleVisit(request, url, env, ctx) {
  const origin = request.headers.get("origin") || (request.headers.get("referer") || "").replace(/^(https?:\/\/[^/]+).*$/, "$1");
  if (origin !== url.origin) return new Response(null, { status: 403 });
  const text = await request.text().catch(() => "");
  if (text.length > 500) return new Response(null, { status: 413 });
  let b;
  try {
    b = JSON.parse(text);
  } catch (err) {
    return new Response(null, { status: 400 });
  }
  const parts = MAP_PARTS.filter((part) => b && Array.isArray(b.parts) && b.parts.includes(part));
  if (!parts.length) return new Response(null, { status: 400 });

  const cf = request.cf || {};
  if (!env.VISITS_DB || !cf.country || NOT_A_VISITOR.test(request.headers.get("user-agent") || "")) {
    return new Response(null, { status: 204 });
  }
  // The town's position to two places, about a kilometre: no finer than
  // Cloudflare's guess at it deserves.
  const at = (v, most) => {
    const n = Number(v);
    return v != null && v !== "" && Number.isFinite(n) && Math.abs(n) <= most ? Math.round(n * 100) / 100 : null;
  };
  const place = [String(cf.country).slice(0, 2), String(cf.region || "").slice(0, 80), String(cf.city || "").slice(0, 80)];
  const day = isoDate(londonDate(Date.now()));
  const add = env.VISITS_DB.prepare(
    "INSERT INTO visits (day, part, country, region, city, lat, lon, visits) VALUES (?, ?, ?, ?, ?, ?, ?, 1) " +
      "ON CONFLICT (day, part, country, region, city) DO UPDATE SET visits = visits + 1, " +
      "lat = COALESCE(lat, excluded.lat), lon = COALESCE(lon, excluded.lon)"
  );
  ctx.waitUntil(
    env.VISITS_DB.batch(parts.map((part) => add.bind(day, part, ...place, at(cf.latitude, 90), at(cf.longitude, 180)))).catch((err) =>
      console.error("[visit] could not count:", err && err.message ? err.message : err)
    )
  );
  return new Response(null, { status: 204 });
}

// /wdtcf and everything under it: see VISIT_PATH.
async function visitorMap(request, url, env, ctx) {
  if (!env.WDTCF_PASSWORD) return new Response("Not set up.", { status: 503, headers: PRIVATE });
  if (!(await signedIn(request, env))) {
    return new Response("This page needs its password.", {
      status: 401,
      headers: { ...PRIVATE, "www-authenticate": 'Basic realm="Cedar Hollow visitor map", charset="UTF-8"' },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  let res;
  if (url.pathname === MAP_PATH + "/data") {
    res = await mapData(url, env);
  } else if (url.pathname === MAP_PATH + "/report") {
    res = await liveReport(url, env, ctx);
  } else {
    // The page itself at /wdtcf; its files at their own addresses.
    const page = url.pathname === MAP_PATH || url.pathname === MAP_PATH + "/";
    res = await env.ASSETS.fetch(new Request(page ? new URL(MAP_PATH + "/map.html", url) : url, request));
  }
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(PRIVATE)) out.headers.set(name, value);
  return out;
}

// HTTP Basic, with any user name and the map's password.
async function signedIn(request, env) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(request.headers.get("authorization") || "");
  if (!m) return false;
  let pair;
  try {
    pair = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch (err) {
    return false;
  }
  const given = pair.slice(pair.indexOf(":") + 1);
  return Boolean(given) && (await sameSecret(given, env.WDTCF_PASSWORD));
}

// GET /wdtcf/data?part=all|oxford|dorset&from=YYYY-MM-DD&to=YYYY-MM-DD: the
// part's visits over those days -- by town, with each town's position, and by
// day -- and the total for as many days again just before, to compare with.
// Thirty days to today unless asked otherwise.
async function mapData(url, env) {
  if (!env.VISITS_DB) return json({ ok: false, error: "No database" }, 503);
  const q = url.searchParams;
  const part = MAP_PARTS.includes(q.get("part")) ? q.get("part") : "all";
  const today = isoDate(londonDate(Date.now()));
  const date = (v, otherwise) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") && Date.parse(v) ? v : otherwise);
  let to = date(q.get("to"), today);
  let from = date(q.get("from"), isoDate(Date.parse(to) - 29 * DAY));
  if (from > to) [from, to] = [to, from];
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  const before = [isoDate(Date.parse(from) - days * DAY), isoDate(Date.parse(from) - DAY)];

  const db = env.VISITS_DB;
  const [towns, byDay, earlier, first] = await db.batch([
    db
      .prepare(
        "SELECT country, region, city, AVG(lat) AS lat, AVG(lon) AS lon, SUM(visits) AS visits FROM visits " +
          "WHERE part = ? AND day BETWEEN ? AND ? GROUP BY country, region, city ORDER BY visits DESC"
      )
      .bind(part, from, to),
    db.prepare("SELECT day, SUM(visits) AS visits FROM visits WHERE part = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day").bind(part, from, to),
    db.prepare("SELECT SUM(visits) AS visits FROM visits WHERE part = ? AND day BETWEEN ? AND ?").bind(part, ...before),
    db.prepare("SELECT MIN(day) AS day FROM visits WHERE part = ?").bind(part),
  ]);
  return json({
    ok: true,
    part,
    from,
    to,
    today,
    first: (first.results[0] && first.results[0].day) || null,
    towns: towns.results.map((r) => [r.country, r.region, r.city, r.lat, r.lon, r.visits]),
    days: byDay.results.map((r) => [r.day, r.visits]),
    before: { from: before[0], to: before[1], visits: (earlier.results[0] && earlier.results[0].visits) || 0 },
  });
}

/*
 * GET /wdtcf/report?view=week|lastweek|month|lastmonth|year|lastyear -- the
 * visitor report, every part and chart of it as the email has it, built on
 * demand for the stats tab of the private map page, with its charts in the
 * page itself. A period still under way -- this week, month or year -- is its
 * days so far, today's as they stand, against as many days of the period
 * before; and the days the morning's cron has not kept yet are read from the
 * API. Nothing is kept and nothing is sent. &format=csv is its spreadsheet.
 * Built at most once in LIVE_CACHE seconds, unless asked &fresh=1.
 */
const LIVE_VIEWS = ["week", "lastweek", "month", "lastmonth", "year", "lastyear"];
const LIVE_CACHE = 300;

async function liveReport(url, env, ctx) {
  if (!analyticsReady(env)) return json({ ok: false, error: "Report not configured" }, 503);
  const q = url.searchParams;
  const view = LIVE_VIEWS.includes(q.get("view")) ? q.get("view") : "week";
  const csv = q.get("format") === "csv";
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const key = new Request(`${url.origin}${MAP_PATH}/report?view=${view}&format=${csv ? "csv" : "html"}&cached=1`);
  if (cache && q.get("fresh") !== "1") {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }

  const now = Date.now();
  const p = livePeriod(view, now);
  let email;
  try {
    email = await renderReport(p, await reportFigures(env, p, { dry: true, store: false, fetches: 3, live: true }), { web: true, now });
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    console.error(`[report] live ${view}: ${reason}`);
    return new Response(`<!doctype html><meta charset="utf-8"><p style="font-family:Arial,sans-serif">The figures could not be read just now: ${esc(reason)}</p>`, {
      status: 502,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  let res;
  if (csv) {
    res = new Response(String.fromCharCode(0xfeff) + email.csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${email.attachments[0].filename}"` },
    });
  } else {
    // The charts go in as data, where the email attaches them; when it was
    // built, for the page to say; and its links open beside the page.
    let html = email.html.replace("</head>", `<meta name="built" content="${new Date(now).toISOString()}"><base target="_blank"></head>`);
    for (const [cid, content] of Object.entries(email.images)) html = html.split(`cid:${cid}`).join(`data:image/png;base64,${content}`);
    res = new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (cache) {
    const kept = new Response(res.clone().body, res);
    kept.headers.set("cache-control", `max-age=${LIVE_CACHE}`);
    ctx.waitUntil(cache.put(key, kept).catch(() => {}));
  }
  return res;
}

// A view's period, as the reports have them. One still under way says so
// with soFar, today's date: its days run to there.
function livePeriod(view, now) {
  const today = londonDate(now);
  const year = new Date(today).getUTCFullYear();
  const month = new Date(today).getUTCMonth();
  const p = {
    week: () => weekPeriod(now, true),
    lastweek: () => weekPeriod(now, false),
    month: () => monthPeriod(year, month),
    lastmonth: () => monthPeriod(year, month - 1),
    year: () => yearPeriod(year),
    lastyear: () => yearPeriod(year - 1),
  }[view]();
  if (today < p.end) p.soFar = today;
  return p;
}

// The last few days of a period that their months' records do not have yet
// -- today, and yesterday until the morning's cron keeps it -- read as they
// stand and added in, for the live report. `monthOf` finds a day's record.
async function addUnkept(env, monthOf, start, end, opts) {
  for (let d = Math.max(start, end - 3 * DAY); d < end; d += DAY) {
    const month = monthOf(d);
    if (!month || month.days[isoDate(d)]) continue;
    const day = await dayFigures(env, d, opts);
    if (day.visits || day.views) addDay(month, day);
  }
}

// The retreat a booking address is for: Checked.in's names each retreat, and
// a Checked.in address it does not name is Dorset's if it is on Dorset's own
// subdomain (cedarhollowdorset.checked.in), else Oxford's. Mallinson's one
// page, which served all of Dorset until it moved to Checked.in, needs the
// button to say which. A gift card is not a stay, and anywhere else is not
// booking at all.
function retreatOf(href, given) {
  let u;
  try {
    u = new URL(href);
  } catch (err) {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const named = (woodland) => (RETREATS[given] && RETREATS[given][0] === woodland ? given : woodland);
  if (/(^|\.)mallinson\.co\.uk$/.test(host)) return named("dorset");
  if (!/(^|\.)checked\.in$/.test(host) || /gift-card/.test(u.pathname)) return null;
  const slug = (/\/(?:book|calendar2|booking-calendar)\/([a-z0-9-]+)\/?$/.exec(u.pathname) || [])[1];
  return CHECKED_IN[slug] || named(/dorset/.test(host) ? "dorset" : "oxford");
}

// A device as Cloudflare's analytics names them: tablet, mobile or desktop.
function deviceOf(agent) {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobi)/i.test(agent)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(agent)) return "mobile";
  return "desktop";
}

/*
 * GET /api/instagram?site=oxford|dorset
 *
 * Answers {ok:true, posts:[...]} or, for every failure, {ok:false} with a
 * status the caller is expected to ignore: js/instagram-live.js leaves the
 * page's own markup alone unless it gets a full set of posts back.
 *
 * The token never appears in a response, a log, or a cache key.
 */
async function handleInstagram(url, env, ctx) {
  const site = String(url.searchParams.get("site") || "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(IG_TOKENS, site)) {
    return igFail("Unknown site", 400);
  }

  const token = await igToken(env, site);
  if (!token) return igFail("Not configured", 503);

  // Keyed on the site alone: same answer for every visitor, and nothing
  // secret in the key.
  const cacheKey = new Request(`${url.origin}${IG_PATH}?site=${site}`, { method: "GET" });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const query = new URL(IG_ENDPOINT);
  query.searchParams.set("fields", IG_FIELDS);
  query.searchParams.set("limit", String(IG_COUNT));
  query.searchParams.set("access_token", token);

  let payload;
  try {
    const res = await fetch(query.toString(), {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 0 },
    });
    if (!res.ok) return igFail("Upstream rejected the request", 502);
    payload = await res.json();
  } catch (e) {
    return igFail("Upstream unreachable", 502);
  }

  const posts = (Array.isArray(payload && payload.data) ? payload.data : [])
    .map(igPost)
    .filter(Boolean)
    .slice(0, IG_COUNT);

  if (posts.length < IG_COUNT) return igFail("Too few posts", 502);

  const body = JSON.stringify({ ok: true, site, posts });
  const response = new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${IG_BROWSER_TTL}, s-maxage=${IG_EDGE_TTL}`,
    },
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

/*
 * The token to use for a site: the renewed one in KV if it descends from the
 * secret currently set, otherwise the secret itself. Null when neither exists.
 */
async function igToken(env, site) {
  const secret = env[IG_TOKENS[site]];
  if (!secret) return null;
  const stored = await igStored(env, site);
  if (stored && stored.from === (await sha256(secret))) return stored.token;
  return secret;
}

async function igStored(env, site) {
  if (!env.IG_KV) return null;
  try {
    const stored = await env.IG_KV.get(`token:${site}`, "json");
    return stored && stored.token ? stored : null;
  } catch {
    return null;
  }
}

/*
 * Weekly: swap each site's token for a fresh 60-day one. A failure leaves the
 * current token in place, and is logged; the next week tries again, and with
 * 60 days of validity there are eight chances before anything lapses.
 */
async function refreshInstagramTokens(env) {
  if (!env.IG_KV) {
    console.error("[instagram] no IG_KV binding; tokens cannot be renewed");
    return;
  }
  for (const site of Object.keys(IG_TOKENS)) {
    const secret = env[IG_TOKENS[site]];
    if (!secret) continue;
    const from = await sha256(secret);
    const current = await igToken(env, site);

    const query = new URL(IG_REFRESH_ENDPOINT);
    query.searchParams.set("grant_type", "ig_refresh_token");
    query.searchParams.set("access_token", current);

    try {
      const res = await fetch(query.toString(), { headers: { accept: "application/json" } });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !body.access_token) {
        // The error object names the reason; it never contains the token.
        const reason = body && body.error ? body.error.message : `HTTP ${res.status}`;
        console.error(`[instagram] ${site}: renewal refused: ${reason}`);
        continue;
      }
      await env.IG_KV.put(
        `token:${site}`,
        JSON.stringify({
          token: body.access_token,
          from,
          renewed: new Date().toISOString(),
          expiresIn: body.expires_in || null,
        })
      );
      console.log(`[instagram] ${site}: token renewed`);
    } catch (err) {
      console.error(`[instagram] ${site}: renewal failed: ${err && err.message ? err.message : err}`);
    }
  }
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* One post, trimmed to what the grid draws. */
function igPost(item) {
  if (!item || !item.permalink) return null;
  const video = item.media_type === "VIDEO";
  const image = video ? item.thumbnail_url : item.media_url;
  if (!image) return null;
  return {
    permalink: item.permalink,
    image,
    // A reel gets the glyph the curated markup gave it.
    reel: video && /\/reel(s)?\//.test(item.permalink),
    alt: igAlt(item.caption),
    timestamp: item.timestamp || "",
  };
}

/*
 * The curated grid had alt text written by hand, which a feed cannot produce.
 * The first sentence of the caption is the closest honest substitute; where
 * there is no caption the image is decorative beside a link that names the
 * destination, so an empty alt is better than a guess.
 */
function igAlt(caption) {
  if (!caption) return "";
  const first = String(caption).split(/(?<=[.!?])\s|\n/)[0].trim();
  if (!first) return "";
  return first.length > 140 ? first.slice(0, 137).trimEnd() + "..." : first;
}

function igFail(error, status) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${IG_FAIL_TTL}`,
    },
  });
}

/*
 * POST /api/visitor-report -- a report on demand. Answers {ok, subject} once
 * sent, or with ?dry=1 the whole email ({subject, text, html, csv}) unsent.
 */
async function handleReportRequest(request, url, env) {
  if (!analyticsReady(env)) return json({ ok: false, error: "Report not configured" }, 503);

  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!given || !(await sameSecret(given, env.ANALYTICS_API_TOKEN))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const q = (name) => url.searchParams.get(name);
  let p;
  if (q("year")) {
    if (!/^\d{4}$/.test(q("year"))) return json({ ok: false, error: "year must be YYYY" }, 400);
    p = yearPeriod(+q("year"));
  } else if (q("month")) {
    const m = /^(\d{4})-(\d{2})$/.exec(q("month"));
    if (!m || +m[2] < 1 || +m[2] > 12) return json({ ok: false, error: "month must be YYYY-MM" }, 400);
    p = monthPeriod(+m[1], +m[2] - 1);
  } else if (q("week")) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q("week"));
    if (!m) return json({ ok: false, error: "week must be YYYY-MM-DD" }, 400);
    p = weekPeriod(Date.UTC(+m[1], +m[2] - 1, +m[3]), true);
  } else {
    p = weekPeriod(Date.now(), false);
  }

  // A request makes one report, so it may read a whole week of missed days.
  const dry = q("dry") === "1";
  const result = await sendReport(env, p, { dry, store: !dry, fetches: 7 });
  return json(result, result.ok ? 200 : 502);
}

/*
 * Build a report and, unless this is a dry run, send it.
 *
 * When the figures cannot be fetched -- the token missing, expired or revoked
 * -- a short note saying so goes out in its place. A report that silently
 * stops arriving would look exactly like a quiet week.
 */
async function sendReport(env, p, opts) {
  const label = periodLabel(p);

  if (!analyticsReady(env)) {
    console.error("[report] not configured: needs ANALYTICS_API_TOKEN, ANALYTICS_ACCOUNT and ANALYTICS_SITE");
    return { ok: false, error: "Report not configured" };
  }

  let email;
  try {
    email = await renderReport(p, await reportFigures(env, p, opts));
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    console.error(`[report] ${label}: ${reason}`);
    if (opts.dry || !mailReady(env)) return { ok: false, error: reason };
    email = {
      subject: `Cedar Hollow website: the visitor report for ${label} could not be built`,
      text:
        `The visitor report for ${label} could not be built.\n\n` +
        `Reason: ${reason}\n\n` +
        "The usual cause is the ANALYTICS_API_TOKEN secret on the cedar-hollow-uk " +
        "Worker being missing, expired or revoked.",
    };
  }

  if (opts.dry) {
    const { attachments, ...rest } = email;
    return { ok: true, ...rest };
  }
  if (!mailReady(env)) {
    console.error("[report] mail not configured; report not sent");
    return { ok: false, error: "Mail not configured" };
  }

  try {
    const { csv, images, ...message } = email;
    await sendViaResend(env, { ...message, to: env.REPORT_TO || env.CONTACT_TO });
    console.log(`[report] ${label}: sent`);
    return { ok: true, subject: email.subject };
  } catch (err) {
    console.error("[report] send failed:", err && err.message ? err.message : err);
    return { ok: false, error: "Send failed" };
  }
}

function analyticsReady(env) {
  return Boolean(env.ANALYTICS_API_TOKEN && env.ANALYTICS_ACCOUNT && env.ANALYTICS_SITE);
}

// Equal without leaking, through timing, how much of a guess was right.
async function sameSecret(a, b) {
  const [x, y] = await Promise.all(
    [a, b].map((s) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))
  );
  return crypto.subtle.timingSafeEqual(x, y);
}

/*
 * The daily job: keep yesterday's figures while they are exact, then send
 * whichever reports fall due -- the week's on a Monday, the month's on the
 * 1st, the year's on 1 January -- one after another, so a month is kept
 * before the year reads it.
 */
async function visitorCron(env, now, monday) {
  if (!analyticsReady(env)) {
    console.error("[report] not configured: needs ANALYTICS_API_TOKEN, ANALYTICS_ACCOUNT and ANALYTICS_SITE");
    return;
  }
  // Yesterday's read, and a few more for days an earlier run missed: on the
  // free plan a run may make fifty requests in all, KV reads included.
  const opts = { dry: false, store: true, fetches: 1 + API_READS };
  const today = londonDate(now);
  try {
    await dayFigures(env, today - DAY, opts);
  } catch (err) {
    console.error("[report] could not keep yesterday:", err && err.message ? err.message : err);
  }

  const date = new Date(today);
  if (monday) await sendReport(env, weekPeriod(now, false), opts);
  if (date.getUTCDate() === 1) {
    await sendReport(env, monthPeriod(date.getUTCFullYear(), date.getUTCMonth() - 1), opts);
    if (date.getUTCMonth() === 0) await sendReport(env, yearPeriod(date.getUTCFullYear() - 1), opts);
  }
}

/*
 * A report's figures, part by part: the period's own, and the period
 * before's totals to compare them with -- unless that one started before
 * counting did. A period still under way (p.soFar, the live report's) is
 * compared with as many days of the one before; and with opts.live the days
 * at its end that their month has not kept yet are read as they stand.
 */
async function reportFigures(env, p, opts) {
  const compare = londonMidnight(p.prevStart) >= COUNTED_FULLY;
  let figures;
  let before = null;
  let days; // [date, totals row, hours], for the average day
  const upTo = p.soFar ? p.soFar + DAY : p.end;
  const sameDays = () => dayTotals(env, p.prevStart, Math.min(p.prevStart + (upTo - p.start), p.start));

  if (p.kind === "week") {
    // One day at a time: keeping a day rewrites its month, and two kept at
    // once would each overwrite the other's addition.
    const list = [];
    for (let d = p.start; d < p.end; d += DAY) list.push(await dayFigures(env, d, opts));
    figures = combine(list);
    days = list.map((day) => [day.date, dayRow(day), day.hours]);
    if (compare) before = await sameDays();
  } else if (p.kind === "month") {
    const d = new Date(p.start);
    const prev = new Date(p.prevStart);
    figures = await monthFigures(env, d.getUTCFullYear(), d.getUTCMonth());
    if (opts.live) await addUnkept(env, () => figures, p.start, upTo, opts);
    days = monthDays(figures);
    if (compare) {
      before = p.soFar ? await sameDays() : partTotals(await monthFigures(env, prev.getUTCFullYear(), prev.getUTCMonth()));
    }
  } else {
    const year = new Date(p.start).getUTCFullYear();
    const twelve = (y) => Promise.all(Array.from({ length: 12 }, (_, m) => monthFigures(env, y, m)));
    const months = await twelve(year);
    if (opts.live) await addUnkept(env, (d) => months[new Date(d).getUTCMonth()], p.start, upTo, opts);
    figures = { ...combine(months), months };
    days = months.flatMap(monthDays);
    if (compare && p.soFar) {
      before = await sameDays();
    } else if (compare) {
      const kept = await getKept(env, YEAR_KEY + (year - 1));
      before = kept ? kept.parts : partTotals(combine(await twelve(year - 1)));
    }
    if (opts.store && londonMidnight(p.end) <= Date.now()) {
      await putKept(env, YEAR_KEY + year, { year, parts: partTotals(figures) });
    }
  }

  const totals = partTotals(figures);
  const average = averageDay(days);
  // A month's record holds its clicks day by day; weeks and years are
  // already added up.
  const intents = p.kind === "month" ? combine([figures]).intents : figures.intents;
  const parts = {};
  for (const [part] of PARTS) {
    parts[part] = {
      ...totals[part],
      before: before && before[part],
      average: average[part],
      intents: intents.filter(([, , retreat]) => part === "all" || (RETREATS[retreat] || [])[0] === part),
      rows: toRows(inPart(figures.sources, part)),
      pages: figures.pages
        .filter(([path]) => part === "all" || partOf(path) === part)
        .slice(0, REPORT_TOP_PAGES)
        .map(([path, views]) => ({ path, views })),
    };
  }

  return {
    account: env.ANALYTICS_ACCOUNT,
    site: env.ANALYTICS_SITE,
    parts,
    rows: toRows(figures.sources),
    months: figures.months,
    // Google is asked only up to today.
    search: await searchFigures(env, { ...p, end: upTo }),
    // Whether any of the period had its clicks to book counted, and all of it.
    clicks: p.end > Date.parse(INTENTS_FROM),
    clicksAll: p.start >= Date.parse(INTENTS_FROM),
    bookings: await periodBookings(env, p),
  };
}

/*
 * One London day's figures: kept, or else read from the API -- and then,
 * with opts.store, kept and added to its month. A day before counting began,
 * not yet begun, or older than the API remembers has nothing to read; nor
 * has any day once opts.fetches, the run's allowance of API reads, is spent.
 *
 * A day kept before visits were counted by the hour -- in early October
 * 2026 -- gets its hours read while the API still has them, if it was
 * counted fully; and one kept before its clicks to book were added up gets
 * those. The rest of it stays as kept.
 */
async function dayFigures(env, date, opts) {
  const from = londonMidnight(date);
  const to = londonMidnight(date + DAY);
  const now = Date.now();
  if (to <= COUNTED_FROM || from >= now) return emptyDay(date);

  const iso = isoDate(date);
  const kept = await getKept(env, DAY_KEY + iso);
  const readable = to >= now - API_DAYS * DAY && opts.fetches > 0;
  if (kept) {
    let changed = false;
    if (!kept.hours && from >= COUNTED_FULLY && readable) {
      opts.fetches -= 1;
      kept.hours = (await fetchDay(env, date)).hours;
      changed = true;
    }
    if (!kept.intents && iso >= INTENTS_FROM) {
      const intents = await dayIntents(env, iso);
      if (intents) {
        kept.intents = intents;
        changed = true;
      }
    }
    if (changed && opts.store) await keepDay(env, kept);
    return kept;
  }
  if (!readable) return emptyDay(date);

  opts.fetches -= 1;
  const day = await fetchDay(env, date);
  if (iso >= INTENTS_FROM) {
    const intents = await dayIntents(env, iso);
    if (intents) day.intents = intents;
  }
  if (opts.store && to <= now) await keepDay(env, day);
  return day;
}

// A day's clicks to book, from their keys: [website, device, retreat,
// visits]. Null if they could not be read, so the day is tried again.
async function dayIntents(env, iso) {
  if (!env.IG_KV) return null;
  try {
    const rows = [];
    let cursor;
    do {
      const page = await env.IG_KV.list({ prefix: `${INTENT_KEY}${iso}:`, cursor });
      for (const { metadata: m } of page.keys) {
        if (m && RETREATS[m.r]) rows.push([String(m.s || ""), String(m.d || ""), m.r, 1]);
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return addRows(rows, [], 3);
  } catch (err) {
    console.error(`[report] could not read clicks to book for ${iso}:`, err && err.message ? err.message : err);
    return null;
  }
}

// Keep a day, and add it to its month's running totals -- once only, though
// a day kept again with the hours or the clicks it lacked adds those.
async function keepDay(env, day) {
  await putKept(env, DAY_KEY + day.date, day);
  const key = MONTH_KEY + day.date.slice(0, 7);
  const month = (await getKept(env, key)) || (await startMonth(env, day.date));
  month.hours = month.hours || {};
  month.intents = month.intents || {};
  if (month.days[day.date]) {
    const hours = day.hours && !month.hours[day.date];
    const intents = day.intents && !month.intents[day.date];
    if (!hours && !intents) return;
    if (hours) month.hours[day.date] = day.hours;
    if (intents) month.intents[day.date] = day.intents;
  } else {
    addDay(month, day);
  }
  await putKept(env, key, month);
}

/*
 * A month's first record. Any of its days kept before it existed -- which
 * happened only in October 2026, when months began to be kept -- go in first.
 */
async function startMonth(env, date) {
  const month = emptyMonth(date.slice(0, 7));
  for (let d = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, 1); isoDate(d) < date; d += DAY) {
    const kept = await getKept(env, DAY_KEY + isoDate(d));
    if (kept) addDay(month, kept);
  }
  return month;
}

// A day's totals go into its month as [visits, views] for the whole site,
// then Oxford, then Dorset, so a week can be totted up from its months; and
// its hours, for the month's and the year's average day; and its clicks to book.
function addDay(month, day) {
  month.days[day.date] = dayRow(day);
  if (day.hours) (month.hours = month.hours || {})[day.date] = day.hours;
  if (day.intents) (month.intents = month.intents || {})[day.date] = day.intents;
  month.visits += day.visits;
  month.views += day.views;
  month.sources = addRows(month.sources, day.sources, 3);
  month.pages = addRows(month.pages, day.pages, 1).slice(0, MONTH_PAGES);
}

function dayRow(day) {
  const t = partTotals(day);
  return [t.all.visits, t.all.views, t.oxford.visits, t.oxford.views, t.dorset.visits, t.dorset.views];
}

// A month's running totals, or nothing for a month with none kept.
async function monthFigures(env, year, month) {
  const label = isoDate(Date.UTC(year, month, 1)).slice(0, 7);
  const from = londonMidnight(Date.UTC(year, month, 1));
  const to = londonMidnight(Date.UTC(year, month + 1, 1));
  if (to <= COUNTED_FROM || from >= Date.now()) return emptyMonth(label);
  return (await getKept(env, MONTH_KEY + label)) || emptyMonth(label);
}

/*
 * The confirmed bookings made in a period, by the London day they were made
 * on, as { retreat, channel, via, src, total, currency, nights } -- via if it
 * was booked direct after a click from this site -- and whether Checked.in
 * has reported any booking yet: until it has, the reports leave bookings out.
 */
async function periodBookings(env, p) {
  const all = await allBookings(env);
  if (!all || !all.length) return { live: false, list: [] };
  const from = isoDate(p.start);
  const to = isoDate(p.end);
  return {
    live: true,
    list: all
      .filter((m) => m.s === "confirmed" && m.d >= from && m.d < to)
      .map((m) => {
        const channel = m.k || "direct";
        return {
          retreat: RETREATS[m.r] ? m.r : "oxford",
          channel,
          via: Boolean(m.f) && channel === "direct",
          src: m.h || "",
          total: m.t,
          currency: m.c || "",
          nights: m.n || 0,
        };
      }),
  };
}

// A month's days as [date, totals row, hours], for its average day.
function monthDays(month) {
  return Object.entries(month.days).map(([date, row]) => [date, row, (month.hours || {})[date]]);
}

/*
 * Each part's average day over a period's [date, totals row, hours]: its
 * visits on each day of the week, Monday first, and in each hour by London's
 * clocks. Only days over and fully counted are averaged -- in October 2026,
 * from the 3rd -- and the hours only over the days kept with them. A day of
 * the week with no such day is null.
 */
function averageDay(list) {
  const now = Date.now();
  const days = list.filter(([date]) => {
    const d = Date.parse(date);
    return londonMidnight(d) >= COUNTED_FULLY && londonMidnight(d + DAY) <= now;
  });
  const average = {};
  PARTS.forEach(([part], i) => {
    const weekdays = WEEKDAYS.map(() => ({ visits: 0, days: 0 }));
    const hours = new Array(24).fill(0);
    let hourDays = 0;
    for (const [date, row, h] of days) {
      const w = weekdays[(new Date(date).getUTCDay() + 6) % 7];
      w.visits += row[2 * i];
      w.days += 1;
      if (h && h[part]) {
        h[part].forEach((n, k) => (hours[k] += n));
        hourDays += 1;
      }
    }
    average[part] = {
      days: days.length,
      weekdays: weekdays.map((w) => (w.days ? w.visits / w.days : null)),
      hours: hourDays ? hours.map((n) => n / hourDays) : null,
      hourDays,
    };
  });
  return average;
}

// Each part's visits and page views for a run of days, read from their
// months' records.
async function dayTotals(env, start, end) {
  const months = new Map();
  const sums = [0, 0, 0, 0, 0, 0];
  for (let d = start; d < end; d += DAY) {
    const date = isoDate(d);
    const ym = date.slice(0, 7);
    if (!months.has(ym)) months.set(ym, await monthFigures(env, +ym.slice(0, 4), +ym.slice(5) - 1));
    const kept = months.get(ym).days[date];
    if (kept) kept.forEach((n, i) => (sums[i] += n));
  }
  return {
    all: { visits: sums[0], views: sums[1] },
    oxford: { visits: sums[2], views: sums[3] },
    dorset: { visits: sums[4], views: sums[5] },
  };
}

async function getKept(env, key) {
  if (!env.IG_KV) return null;
  return env.IG_KV.get(key, "json").catch(() => null);
}

async function putKept(env, key, value) {
  if (!env.IG_KV) return;
  await env.IG_KV.put(key, JSON.stringify(value), { expirationTtl: KEEP }).catch((err) =>
    console.error(`[report] could not keep ${key}:`, err && err.message ? err.message : err)
  );
}

/*
 * One day from the GraphQL API, in one request: totals; visits by website,
 * device, the page they began on and the hour; moves from page to page
 * within the site; and views of every page. The API scales sampled figures
 * up itself, so they are used as given.
 */
async function fetchDay(env, date) {
  const filter = rumFilter(env, londonMidnight(date), londonMidnight(date + DAY));
  // Clicks from one page of the site to another. Reloads and the back and
  // forward buttons are left out: each would count the same move again.
  const moves = rumFilter(env, londonMidnight(date), londonMidnight(date + DAY), {
    refererHost: SITE_HOST,
    navigationType: "navigate",
  });
  const query = `{
    viewer {
      accounts(filter: { accountTag: ${JSON.stringify(env.ANALYTICS_ACCOUNT)} }) {
        total: rumPageloadEventsAdaptiveGroups(filter: ${filter}, limit: 1) {
          count
          sum { visits }
          avg { sampleInterval }
        }
        sources: rumPageloadEventsAdaptiveGroups(filter: ${filter}, limit: 5000, orderBy: [sum_visits_DESC]) {
          sum { visits }
          dimensions { refererHost deviceType requestPath datetimeHour }
        }
        moves: rumPageloadEventsAdaptiveGroups(filter: ${moves}, limit: 5000, orderBy: [count_DESC]) {
          count
          dimensions { refererPath requestPath deviceType datetimeHour }
        }
        pages: rumPageloadEventsAdaptiveGroups(filter: ${filter}, limit: ${DAY_PAGES}, orderBy: [count_DESC]) {
          count
          dimensions { requestPath }
        }
      }
    }
  }`;

  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ANALYTICS_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`analytics API answered HTTP ${res.status}`);
  if (body.errors && body.errors.length) {
    throw new Error(`analytics API: ${body.errors.map((e) => e.message).join("; ").slice(0, 300)}`);
  }
  const account = body.data && body.data.viewer && body.data.viewer.accounts && body.data.viewer.accounts[0];
  if (!account) {
    throw new Error("analytics API returned no account: check ANALYTICS_ACCOUNT and the token's account access");
  }

  const whole = (n) => Math.round(Number(n) || 0);
  const t = (account.total || [])[0] || {};
  const dim = (g) => g.dimensions || {};
  // The API's hours are UTC's; London's clocks are a whole hour off, if any.
  const hour = (g) => londonParts(Date.parse(dim(g).datetimeHour) || londonMidnight(date)).hour;
  // [website, device, part, visits, hour]. For a visit from outside, the part
  // is the one it began in; a page view from inside the site carries no
  // visit, so those rows go. A move onto a woodland's pages from another part
  // of the site is a visit to that woodland too, from an "@" source: the home
  // page, the search results, the other woodland, or another shared page.
  const visits = [
    ...(account.sources || [])
      .map((g) => [
        String(dim(g).refererHost || "").toLowerCase(),
        String(dim(g).deviceType || ""),
        partOf(String(dim(g).requestPath || "/")),
        whole(g.sum && g.sum.visits),
        hour(g),
      ])
      .filter((row) => row[3] > 0),
    ...(account.moves || [])
      .map((g) => {
        const to = partOf(String(dim(g).requestPath || "/"));
        const fromPath = String(dim(g).refererPath || "/").toLowerCase();
        const from = partOf(fromPath);
        if (to === "main" || from === to) return null;
        const where = from !== "main" ? `@${from}` : /^\/(index\.html)?$/.test(fromPath) ? "@home" : fromPath.startsWith("/search-results") ? "@search" : "@site";
        return [where, String(dim(g).deviceType || ""), to, whole(g.count), hour(g)];
      })
      .filter((row) => row && row[3] > 0),
  ];
  return {
    date: isoDate(date),
    visits: whole(t.sum && t.sum.visits),
    views: whole(t.count),
    // 1 while the day is exact; about 10 once Cloudflare has thinned it.
    sampleInterval: Number((t.avg && t.avg.sampleInterval) || 1),
    // [website, device, part, visits]
    sources: addRows(visits.map((row) => row.slice(0, 4)), [], 3),
    hours: dayHours(visits),
    // [path, page views]
    pages: (account.pages || []).map((g) => [String(dim(g).requestPath || "/"), whole(g.count)]),
  };
}

/*
 * Each part's visits in each hour of the day by London's clocks, from
 * [website, device, part, visits, hour] rows: the whole website's are the
 * visits from outside, a woodland's every visit to it, as in partTotals.
 */
function dayHours(visits) {
  const hours = Object.fromEntries(PARTS.map(([part]) => [part, new Array(24).fill(0)]));
  for (const [host, , part, n, hour] of visits) {
    if (!host.startsWith("@")) hours.all[hour] += n;
    if (part !== "all" && hours[part]) hours[part][hour] += n;
  }
  return hours;
}

// Days or months added together, their clicks to book included.
function combine(list) {
  let visits = 0;
  let views = 0;
  let sources = [];
  let pages = [];
  let intents = [];
  for (const f of list) {
    visits += f.visits;
    views += f.views;
    sources = addRows(sources, f.sources, 3);
    pages = addRows(pages, f.pages, 1);
    // A day holds its clicks as rows; a month, as rows for each of its days.
    const rows = Array.isArray(f.intents) ? [f.intents] : Object.values(f.intents || {});
    for (const r of rows) intents = addRows(intents, r, 3);
  }
  return { visits, views, sources, pages: pages.slice(0, MONTH_PAGES), intents };
}

// Two lists of [...key, count] rows added up by key, largest first.
function addRows(a, b, keyLength) {
  const totals = new Map();
  for (const row of a.concat(b)) {
    const key = JSON.stringify(row.slice(0, keyLength));
    totals.set(key, (totals.get(key) || 0) + row[keyLength]);
  }
  return [...totals]
    .map(([key, n]) => [...JSON.parse(key), n])
    .sort((x, y) => y[keyLength] - x[keyLength] || String(x[0]).localeCompare(String(y[0])));
}

function emptyDay(date) {
  return { date: isoDate(date), visits: 0, views: 0, sampleInterval: 1, sources: [], pages: [] };
}

function emptyMonth(label) {
  return { month: label, days: {}, hours: {}, intents: {}, visits: 0, views: 0, sources: [], pages: [] };
}

// [host, device, part, visits] rows as the report reads them.
function toRows(sources) {
  return sources.map(([host, device, part, visits]) => ({
    host,
    source: sourceName(host),
    device: DEVICE_NAMES[device] || "Other",
    part,
    visits,
  }));
}

// Which part of the site a page is in: a woodland's own, or the shared pages.
function partOf(path) {
  const p = path.toLowerCase();
  if (/^\/oxford([./-]|$)/.test(p)) return "oxford";
  if (/^\/dorset([./-]|$)/.test(p)) return "dorset";
  return "main";
}

// One part's [host, device, part, visits] rows. The whole website's are the
// visits from outside -- every one of them once -- and not the moves within.
function inPart(sources, part) {
  return part === "all" ? sources.filter((row) => !row[0].startsWith("@")) : sources.filter((row) => row[2] === part);
}

// Visits and page views for the whole site and each woodland: a woodland's
// visits are those that began on its pages or moved onto them, its page
// views every view of them.
function partTotals(f) {
  const t = { all: { visits: f.visits, views: f.views }, oxford: { visits: 0, views: 0 }, dorset: { visits: 0, views: 0 } };
  for (const [, , part, visits] of f.sources) if (t[part] && part !== "all") t[part].visits += visits;
  for (const [path, views] of f.pages) {
    const part = partOf(path);
    if (t[part]) t[part].views += views;
  }
  return t;
}

// Bots left out, as the dashboard leaves them out by default. `extra` adds
// fields that must match exactly.
function rumFilter(env, from, to, extra = {}) {
  const time = (t) => JSON.stringify(new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"));
  const more = Object.entries(extra).map(([k, v]) => `, ${k}: ${JSON.stringify(v)}`).join("");
  return `{ siteTag: ${JSON.stringify(env.ANALYTICS_SITE)}, datetime_geq: ${time(from)}, datetime_lt: ${time(to)}, bot: 0${more} }`;
}

/*
 * Searches on Google: what people searched for when Google listed the site,
 * from the Search Console API. It is read with a service account's key --
 * the GSC_KEY secret, the JSON file Google Cloud downloads -- whose address
 * the Search Console property lists as a Restricted user. GSC_SITE names the
 * property ("sc-domain:cedarhollow.uk" for a domain property), and
 * GSC_OLD_SITE, if set, theoaks.uk's: the old Oxford site, whose searches
 * count with the new address's while Google moves it over.
 *
 * Google keeps sixteen months of these figures, so nothing is kept here:
 * each report asks for its own period as it is sent. Google's days run on
 * US Pacific time; its last two or three days are still filling in; and it
 * holds back searches made by very few people, so the searches listed add up
 * to less than the totals.
 */
const GSC_ENDPOINT = "https://searchconsole.googleapis.com/webmasters/v3/sites/";
const GSC_TOP = 10; // searches listed in each part
let gscAccess; // { token, until }: one sign-in serves every report in a run

function searchReady(env) {
  return Boolean(env.GSC_KEY && env.GSC_SITE);
}

// A Google access token, from a JWT signed with the service account's key.
async function gscToken(env) {
  if (gscAccess && gscAccess.until > Date.now() + 60000) return gscAccess.token;
  const key = JSON.parse(env.GSC_KEY);
  const now = Math.floor(Date.now() / 1000);
  const part = (o) => base64Url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned =
    part({ alg: "RS256", typ: "JWT" }) +
    "." +
    part({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const der = Uint8Array.from(atob(key.private_key.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const signer = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(unsigned)));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(signature)}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) throw new Error(`Google sign-in: ${body.error_description || body.error || `HTTP ${res.status}`}`);
  gscAccess = { token: body.access_token, until: Date.now() + (body.expires_in || 3600) * 1000 };
  return gscAccess.token;
}

function base64Url(bytes) {
  return base64Bytes(bytes).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// One Search Console question about a period: its rows, each with keys in
// the order of `dimensions`, clicks, impressions and average position.
async function gscQuery(env, token, site, p, dimensions, rowLimit) {
  const res = await fetch(`${GSC_ENDPOINT}${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      startDate: isoDate(p.start),
      endDate: isoDate(p.end - DAY),
      dimensions,
      rowLimit,
      type: "web",
      dataState: "all",
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`Search Console: ${(body && body.error && body.error.message) || `HTTP ${res.status}`}`);
  return body.rows || [];
}

/*
 * A period's searches on Google, part by part: how often Google listed the
 * site, how many clicked, the average position, and the top searches. The
 * whole website's come straight from Google; a woodland's are its own pages'
 * added up, so a search that listed two of its pages counts twice. Null when
 * Search Console is not set up; { error } when it could not be read.
 */
async function searchFigures(env, p) {
  if (!searchReady(env)) return null;
  try {
    const token = await gscToken(env);
    const ask = (dimensions, rowLimit, site = env.GSC_SITE) => gscQuery(env, token, site, p, dimensions, rowLimit);
    const [totals, queries, pairs, pages] = await Promise.all([
      ask([], 1),
      ask(["query"], 250),
      ask(["query", "page"], 2000),
      ask(["page"], 1000),
    ]);
    const woodland = (row) => {
      try {
        return partOf(new URL(row.keys[row.keys.length - 1]).pathname);
      } catch (err) {
        return "main";
      }
    };
    const top = (list) =>
      list
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.query.localeCompare(b.query))
        .slice(0, GSC_TOP);
    const searches = (rows) => rows.map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions }));
    const t = totals[0] || { clicks: 0, impressions: 0, position: 0 };
    const out = {
      all: { clicks: t.clicks, impressions: t.impressions, position: t.position, queries: searches(queries) },
      // Google's newest days are still filling in.
      fresh: londonMidnight(p.end) > Date.now() - 3 * DAY,
    };
    for (const part of ["oxford", "dorset"]) {
      let clicks = 0;
      let impressions = 0;
      let weighted = 0;
      for (const r of pages) {
        if (woodland(r) !== part) continue;
        clicks += r.clicks;
        impressions += r.impressions;
        weighted += r.position * r.impressions;
      }
      const byQuery = new Map();
      for (const r of pairs) {
        if (woodland(r) !== part) continue;
        const q = byQuery.get(r.keys[0]) || { query: r.keys[0], clicks: 0, impressions: 0 };
        q.clicks += r.clicks;
        q.impressions += r.impressions;
        byQuery.set(r.keys[0], q);
      }
      out[part] = { clicks, impressions, position: impressions ? weighted / impressions : 0, queries: [...byQuery.values()] };
    }
    // theoaks.uk was the Oxford site, and while Google moves it over most
    // searches still find it there. Its figures count in the whole website's
    // and in Oxford's -- a search that showed both addresses, twice -- and
    // what it had on its own is kept to say so.
    if (env.GSC_OLD_SITE) {
      try {
        const [oldTotals, oldQueries] = await Promise.all([ask([], 1, env.GSC_OLD_SITE), ask(["query"], 250, env.GSC_OLD_SITE)]);
        const o = oldTotals[0] || { clicks: 0, impressions: 0, position: 0 };
        out.old = { clicks: o.clicks, impressions: o.impressions };
        for (const part of ["all", "oxford"]) {
          const f = out[part];
          const impressions = f.impressions + o.impressions;
          f.position = impressions ? (f.position * f.impressions + o.position * o.impressions) / impressions : 0;
          f.impressions = impressions;
          f.clicks += o.clicks;
          f.withOld = true;
          const byQuery = new Map(f.queries.map((q) => [q.query, { ...q }]));
          for (const q of searches(oldQueries)) {
            const was = byQuery.get(q.query) || { query: q.query, clicks: 0, impressions: 0 };
            was.clicks += q.clicks;
            was.impressions += q.impressions;
            byQuery.set(q.query, was);
          }
          f.queries = [...byQuery.values()];
        }
      } catch (err) {
        console.error("[report] theoaks.uk searches:", err && err.message ? err.message : err);
      }
    }
    for (const part of ["all", "oxford", "dorset"]) out[part].queries = top(out[part].queries);
    return out;
  } catch (err) {
    console.error("[report] searches on Google:", err && err.message ? err.message : err);
    return { error: err && err.message ? err.message : String(err) };
  }
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function sourceName(host) {
  if (!host) return DIRECT;
  if (WITHIN[host]) return WITHIN[host];
  for (const [pattern, name] of SOURCE_NAMES) {
    if (pattern.test(host)) return name;
  }
  if (!host.includes(".")) {
    return host.split("-").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  return host.replace(/^www\./, "");
}

/*
 * Periods run on London's clocks: weeks Monday to Sunday, months and years
 * as the calendar has them. Dates are held as UTC-midnight timestamps --
 * plain calendar dates, safe to step a day at a time -- and turned into
 * instants only at the edges. A period is [start, end), with prevStart the
 * start of the one before.
 */
const DAY = 86400000;

// The week before the one containing `day`; or, with `containing`, that week.
function weekPeriod(day, containing) {
  const date = londonDate(day);
  let monday = date - ((new Date(date).getUTCDay() + 6) % 7) * DAY;
  if (!containing) monday -= 7 * DAY;
  return { kind: "week", start: monday, end: monday + 7 * DAY, prevStart: monday - 7 * DAY };
}

// `month` counts from 0, and may run over: monthPeriod(2027, -1) is December 2026.
function monthPeriod(year, month) {
  return {
    kind: "month",
    start: Date.UTC(year, month, 1),
    end: Date.UTC(year, month + 1, 1),
    prevStart: Date.UTC(year, month - 1, 1),
  };
}

function yearPeriod(year) {
  return { kind: "year", start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1), prevStart: Date.UTC(year - 1, 0, 1) };
}

// "28 September – 4 October 2026", "October 2026" or "2026"; or with
// `short`, "28 Sept – 4 Oct" or "Oct 2026", for a subject line.
function periodLabel(p, short = false) {
  const fmt = (d, opts) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(d));
  if (p.kind === "year") return String(new Date(p.start).getUTCFullYear());
  if (p.kind === "month") return fmt(p.start, { month: short ? "short" : "long", year: "numeric" });

  const first = new Date(p.start);
  const last = new Date(p.start + 6 * DAY);
  const month = short ? "short" : "long";
  const sameYear = first.getUTCFullYear() === last.getUTCFullYear();
  const sameMonth = sameYear && first.getUTCMonth() === last.getUTCMonth();
  const start = sameMonth
    ? fmt(first, { day: "numeric" })
    : fmt(first, { day: "numeric", month, ...(sameYear || short ? {} : { year: "numeric" }) });
  const end = fmt(last, { day: "numeric", month, ...(short ? {} : { year: "numeric" }) });
  return `${start} – ${end}`;
}

// What the period before is called: "week before", "September", "2025"; or,
// for a period still under way, its days so far: "same days the week before",
// "1–5 September", "same days of 2025".
function beforeLabel(p) {
  if (p.soFar) {
    const days = Math.round((p.soFar - p.start) / DAY) + 1;
    if (p.kind === "week") return days === 1 ? "same day the week before" : "same days the week before";
    if (p.kind === "month") {
      const last = Math.min(p.prevStart + (days - 1) * DAY, p.start - DAY);
      const fmt = (d, opts) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(d));
      return `${last === p.prevStart ? "" : `${fmt(p.prevStart, { day: "numeric" })}–`}${fmt(last, { day: "numeric", month: "long" })}`;
    }
    return `same days of ${new Date(p.prevStart).getUTCFullYear()}`;
  }
  if (p.kind === "week") return "week before";
  if (p.kind === "month") return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long" }).format(new Date(p.prevStart));
  return String(new Date(p.prevStart).getUTCFullYear());
}

// A warning for a period whose figures are incomplete, or null.
function periodNote(p) {
  const from = londonMidnight(p.start);
  if (from < COUNTED_FROM) {
    return (
      "Visits have only been counted since 1 October 2026 (most not until the afternoon of the 2nd), so " +
      (p.kind === "year" ? "this year’s figures start then." : `this ${p.kind}’s figures are incomplete.`)
    );
  }
  if (from < COUNTED_FULLY) {
    return `Most visits went uncounted from 1 October until the afternoon of 2 October, so this ${p.kind}’s figures are incomplete.`;
  }
  return null;
}

// The calendar date London's clocks show at an instant.
function londonDate(ts) {
  const p = londonParts(ts);
  return Date.UTC(p.year, p.month - 1, p.day);
}

// The instant London's clocks read midnight on a date. Its clocks change at
// 01:00 UTC, so midnight is never skipped or repeated, and the offset at UTC
// midnight is the one in force at London's.
function londonMidnight(date) {
  const p = londonParts(date);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - date;
  return date - offset;
}

// One formatter for every call: making one is far dearer than using it, and
// a year's report asks the time in London hundreds of times.
let londonFormat;

function londonParts(ts) {
  londonFormat =
    londonFormat ||
    new Intl.DateTimeFormat("en-GB", {
      timeZone: REPORT_TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  const p = {};
  for (const { type, value } of londonFormat.formatToParts(new Date(ts))) p[type] = Number(value);
  return p;
}

// A part's months of the year, from the first one anything was counted in:
// each month's visits, page views and rows, grouped by source and device.
function partMonths(r, part, year) {
  return (r.months || [])
    .map((m, index) => {
      const rows = toRows(inPart(m.sources, part));
      const visits = part === "all" ? m.visits : rows.reduce((n, x) => n + x.visits, 0);
      const views = part === "all" ? m.views : m.pages.reduce((n, [path, v]) => n + (partOf(path) === part ? v : 0), 0);
      return { index, visits, views, rows, ...groupRows(rows) };
    })
    .filter((m) => londonMidnight(Date.UTC(year, m.index + 1, 1)) > COUNTED_FROM);
}

// The websites a part's year-graph names: its biggest, by visits.
function topNames(S) {
  return groupRows(S.rows).list.slice(0, CHART_SOURCES).map((s) => s.name);
}

/*
 * Twelve slots, one per month (empty before counting began), and for each
 * the two charts' stacks: visits by device, and by the named websites with
 * everything else last.
 */
function monthStacks(months, named) {
  const byIndex = new Map(months.map((m) => [m.index, m]));
  const slots = MONTHS.map((_, i) => byIndex.get(i));
  return {
    slots,
    devices: slots.map((m) => DEVICE_ORDER.map((d) => (m ? m.devices[d] || 0 : 0))),
    sources: slots.map((m) => {
      if (!m) return [...named.map(() => 0), 0];
      const pieces = named.map((name) => (m.bySource.get(name) || { visits: 0 }).visits);
      const rest = Math.max(0, m.list.reduce((n, x) => n + x.visits, 0) - pieces.reduce((a, b) => a + b, 0));
      return [...pieces, rest];
    }),
  };
}

/*
 * Visits by source, largest first, each split by device; the visits by
 * device overall; and the sources by name, for looking one up.
 */
function groupRows(rows) {
  const bySource = new Map();
  const devices = {};
  for (const row of rows) {
    let s = bySource.get(row.source);
    if (!s) bySource.set(row.source, (s = { name: row.source, visits: 0, devices: {} }));
    s.visits += row.visits;
    s.devices[row.device] = (s.devices[row.device] || 0) + row.visits;
    devices[row.device] = (devices[row.device] || 0) + row.visits;
  }
  const list = [...bySource.values()].sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
  return { list, devices, bySource };
}

// `total` shared out in proportion to `parts`, in whole numbers adding up to it.
function splitParts(total, parts) {
  const sum = parts.reduce((a, b) => a + b, 0);
  if (!sum || !total) return parts.map(() => 0);
  const exact = parts.map((n) => (total * n) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  exact
    .map((x, i) => [x - out[i], i])
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left > 0) {
        out[i] += 1;
        left -= 1;
      }
    });
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEVICE_COLOURS = { Computer: "#8aa37c", Phone: "#2f4a33", Tablet: "#c9a227", Other: "#c9c4ab" };
const SOURCE_COLOURS = ["#2f4a33", "#b5552b", "#c9a227", "#4f6d8a", "#8a5a83"];
const OTHER_COLOUR = "#c9c4ab";
const DAY_COLOUR = "#2f4a33";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PART_LABELS = { oxford: "Oxford pages", dorset: "Dorset pages", main: "Shared pages" };

// The email's look, in one place, so three parts of tables stay well under
// the size at which Gmail clips a message. A client that drops <style> still
// shows the same tables, plainer.
const REPORT_CSS = [
  "body{margin:0;padding:0;background:#f7f5e1}",
  ".w{max-width:640px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#2b2b22}",
  ".k{margin:0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b6a5c}",
  ".h1{font-family:Georgia,serif;font-weight:normal;font-size:26px;color:#2f4a33;margin:4px 0 8px}",
  ".part{font-family:Georgia,serif;font-weight:normal;font-size:24px;color:#2f4a33;margin:44px 0 2px;padding-top:14px;border-top:3px solid #2f4a33}",
  ".h2{font-family:Georgia,serif;font-weight:normal;font-size:19px;color:#2f4a33;margin:28px 0 8px}",
  ".big{font-family:Georgia,serif;font-size:32px;line-height:1.25;color:#2b2b22}",
  ".s{font-size:13px;color:#6b6a5c}",
  ".t{border-collapse:collapse;width:100%;font-size:14px}",
  ".hl,.hn,.hl2,.hn2{border-bottom:2px solid #e4e0c8;font-weight:600;font-size:13px;color:#6b6a5c}",
  ".l,.n,.l2,.n2{border-bottom:1px solid #e4e0c8}",
  ".hl,.hn{padding:6px 8px}.l,.n{padding:7px 8px}.hl2,.hn2,.l2,.n2{padding:5px 3px}.hl2,.hn2{font-size:11px}",
  ".hl,.hl2,.l,.l2{text-align:left}.hn,.hn2,.n,.n2{text-align:right;white-space:nowrap}",
  ".note{margin:16px 0 0;padding:10px 12px;background:#fff8e1;border-left:3px solid #c9a227;font-size:14px}",
  "a{color:#2f4a33}",
].join("");

function fmtNum(n) {
  return Number(n || 0).toLocaleString("en-GB");
}

function compactNum(n) {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

// An average: to a tenth below ten, else whole. 4.3, 3, 12.
function fmtAvg(n) {
  return fmtNum(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
}

// An hour of the clock as a span: "8–9pm", "11am–12pm", "12–1am".
function hourSpan(h) {
  const name = (x) => `${x % 12 || 12}${x % 24 < 12 ? "am" : "pm"}`;
  const end = name(h + 1);
  return name(h).slice(-2) === end.slice(-2) ? `${h % 12 || 12}–${end}` : `${name(h)}–${end}`;
}

/*
 * The email itself: subject, plain text, HTML, the spreadsheet, a pie chart
 * of each part's visits by device, and bar charts of its average day. Its
 * three parts, in PARTS order, each come from renderPart.
 *
 * Every value from the analytics -- a referring website above all, which any
 * visitor's browser can set to anything -- is escaped for HTML, and guarded
 * in the spreadsheet against being read as a formula.
 */
async function renderReport(p, r, web = null) {
  const label = periodLabel(p) + (p.soFar ? ", so far" : "");
  const year = new Date(p.start).getUTCFullYear();
  const note = periodNote(p);
  // The live report, on the private map page, says when it was built.
  const time = web ? new Intl.DateTimeFormat("en-GB", { timeZone: REPORT_TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(web.now)) : "";
  const live = p.soFar ? `Live: up to ${time} today. Today’s figures are still coming in, and today is left out of the day-of-the-week and time-of-day averages until it is over.` : "";
  const dashboard = `https://dash.cloudflare.com/${r.account}/web-analytics/overview?siteTag~in=${r.site}`;
  const visits = fmtNum(r.parts.all.visits);

  const subject = {
    week: `Cedar Hollow website: ${visits} visits, ${periodLabel(p, true)}`,
    month: `Cedar Hollow website: ${visits} visits in ${label}`,
    year: `Cedar Hollow website: ${visits} visits in ${label}, month by month`,
  }[p.kind];
  const kicker = { week: "weekly visitors", month: "monthly visitors", year: "the year in visitors" }[p.kind] + (web ? " · live" : "");
  const directNote =
    "“Direct” means the visitor’s browser didn’t say where they came from: " +
    "the address typed in, a bookmark, or a link in WhatsApp, an email or another app.";
  const attached = web
    ? "The full breakdown by part of the site, website and device is in the spreadsheet you can download above."
    : "The full breakdown by part of the site, website and device is attached as a spreadsheet.";

  // The pies go in as pictures attached to the email and shown in its body
  // ("cid:" images): mail clients strip SVG and drawn charts, and many block
  // pictures fetched from the web, but show the ones an email carries.
  const pies = {};
  for (const [part] of PARTS) {
    const devices = groupRows(r.parts[part].rows).devices;
    const values = DEVICE_ORDER.map((d) => devices[d] || 0);
    if (!values.some((v) => v > 0)) continue;
    try {
      const png = await piePng(values, DEVICE_ORDER.map((d) => DEVICE_COLOURS[d]));
      pies[part] = { cid: `devices-${part}`, content: base64Bytes(png) };
    } catch (err) {
      // The key beside it carries the same figures, so the email goes without.
      console.error(`[report] no pie for ${part}:`, err && err.message ? err.message : err);
    }
  }

  // The year's two month-by-month charts, the same way: visits by device,
  // and by where they came from, each a column per month.
  const charts = {};
  if (p.kind === "year") {
    for (const [part] of PARTS) {
      const months = partMonths(r, part, year);
      if (!months.length) continue;
      const named = topNames(r.parts[part]);
      const stacks = monthStacks(months, named);
      try {
        const devices = await columnsPng(stacks.devices, DEVICE_ORDER.map((d) => DEVICE_COLOURS[d]));
        const sources = await columnsPng(stacks.sources, [...SOURCE_COLOURS.slice(0, named.length), OTHER_COLOUR]);
        charts[part] = {
          devices: { cid: `months-${part}`, content: base64Bytes(devices) },
          sources: { cid: `sources-${part}`, content: base64Bytes(sources) },
        };
      } catch (err) {
        console.error(`[report] no month charts for ${part}:`, err && err.message ? err.message : err);
      }
    }
  }
  // Each part's average day, the same way: a column for each day of the
  // week, and one for each hour.
  const days = {};
  for (const [part] of PARTS) {
    const average = r.parts[part].average;
    if (!average.weekdays.some((v) => v > 0)) continue;
    try {
      days[part] = { weekdays: { cid: `weekdays-${part}`, content: base64Bytes(await columnsPng(average.weekdays.map((v) => [v || 0]), [DAY_COLOUR])) } };
      if (average.hours && average.hours.some((v) => v > 0)) {
        days[part].hours = { cid: `hours-${part}`, content: base64Bytes(await columnsPng(average.hours.map((v) => [v]), [DAY_COLOUR])) };
      }
    } catch (err) {
      console.error(`[report] no average-day charts for ${part}:`, err && err.message ? err.message : err);
    }
  }
  const pictures = [
    ...Object.values(pies),
    ...Object.values(charts).flatMap((c) => [c.devices, c.sources]),
    ...Object.values(days).flatMap((d) => [d.weekdays, d.hours].filter(Boolean)),
  ];

  const text = [`Cedar Hollow website: visitors, ${label}`, ...(note ? ["", note] : [])];
  let parts = "";
  for (const [part, title] of PARTS) {
    const section = renderPart(p, r, part, title, pies[part], charts[part], days[part]);
    text.push("", "", `== ${title.toUpperCase()} ==`, ...section.text);
    parts += section.html;
  }
  text.push("", directNote, attached, `Cloudflare dashboard: ${dashboard}`);

  const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title><style>${REPORT_CSS}</style></head>
<body style="margin:0;padding:0;background:#f7f5e1;">
<div class="w" style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;">
<p class="k">Cedar Hollow website &middot; ${kicker}</p>
<h1 class="h1">${esc(label)}</h1>
${note ? `<p class="note">${esc(note)}</p>` : ""}
${live ? `<p class="note">${esc(live)}</p>` : ""}
${parts}
<p class="s" style="margin-top:36px;">${esc(directNote)} ${esc(attached)} More detail is on the <a href="${esc(dashboard)}">Cloudflare dashboard</a>.</p>
</div></body></html>`;

  // ---- spreadsheet --------------------------------------------------------
  // Oxford, Dorset, then the shared pages; within each, largest source first,
  // then by device; for a year, month by month.
  const order = { oxford: 0, dorset: 1, main: 2 };
  const ordered = (rows) => {
    const totals = new Map();
    for (const x of rows) totals.set(`${x.part} ${x.source}`, (totals.get(`${x.part} ${x.source}`) || 0) + x.visits);
    return [...rows].sort(
      (a, b) =>
        order[a.part] - order[b.part] ||
        totals.get(`${b.part} ${b.source}`) - totals.get(`${a.part} ${a.source}`) ||
        a.source.localeCompare(b.source) ||
        b.visits - a.visits
    );
  };
  const site = (host) => (host.startsWith("@") ? "(within this site)" : host || "(none)");
  const line = (key, x) => [key, PART_LABELS[x.part] || x.part, x.source, site(x.host), x.device, x.visits];
  const stamp = p.kind === "week" ? isoDate(p.start) : p.kind === "month" ? isoDate(p.start).slice(0, 7) : String(year);
  const body =
    p.kind === "year"
      ? (r.months || []).flatMap((m, i) => ordered(toRows(m.sources)).map((x) => line(`${year}-${String(i + 1).padStart(2, "0")}`, x)))
      : ordered(r.rows).map((x) => line(stamp, x));
  const csv =
    [[p.kind === "week" ? "Week starting" : "Month", "Part of site", "Source", "Website", "Device", "Visits"], ...body]
      .map((cells) => cells.map(csvCell).join(","))
      .join("\r\n") + "\r\n";

  return {
    subject,
    text: text.join("\n"),
    html,
    csv,
    // For a dry run, which shows the email without its attachments.
    images: Object.fromEntries(pictures.map((picture) => [picture.cid, picture.content])),
    attachments: [
      // A byte-order mark first, so Excel reads the file as UTF-8.
      { filename: `cedar-hollow-visitors-${stamp}.csv`, content: base64(String.fromCharCode(0xfeff) + csv) },
      ...pictures.map((picture) => ({
        filename: `${picture.cid}.png`,
        content: picture.content,
        content_type: "image/png",
        content_id: picture.cid,
      })),
    ],
  };
}

/*
 * One part of a report -- the whole website, or one woodland -- as plain
 * text lines and HTML, with `pie` the picture of its visits by device, and
 * `day` the bar charts of its average day. The year's report adds its
 * month-by-month bar charts, `chart`; every figure in them is in a table
 * beside them too.
 */
function renderPart(p, r, part, title, pie, chart, day) {
  const S = r.parts[part];
  const year = new Date(p.start).getUTCFullYear();
  const num = fmtNum;

  const grouped = groupRows(S.rows);
  const devices = grouped.devices;
  let sources = grouped.list;
  if (sources.length > REPORT_TOP_SOURCES) {
    const rest = sources.slice(REPORT_TOP_SOURCES - 1);
    const other = { name: `${rest.length} other websites`, visits: 0, devices: {}, other: true };
    for (const s of rest) {
      other.visits += s.visits;
      for (const [d, n] of Object.entries(s.devices)) other.devices[d] = (other.devices[d] || 0) + n;
    }
    sources = [...sources.slice(0, REPORT_TOP_SOURCES - 1), other];
  }
  const counted = sources.reduce((n, s) => n + s.visits, 0);
  const deviceRows = DEVICE_ORDER.filter((d) => devices[d]).map((d) => ({ name: d, visits: devices[d] }));
  const withinNote = S.rows.some((x) => x.host.startsWith("@"))
    ? `“Cedar Hollow home page” and the like are visitors who came here from another page of this website.`
    : "";

  const share = (n, of = counted) => {
    if (!of || !n) return "0%";
    const pct = (100 * n) / of;
    return pct < 0.5 ? "<1%" : `${Math.round(pct)}%`;
  };
  const split = (byDevice, joiner, lower) =>
    DEVICE_ORDER.filter((d) => byDevice[d])
      .map((d) => `${lower ? d.toLowerCase() : d} ${num(byDevice[d])}`)
      .join(joiner);
  const before = S.before && S.before.visits > 0 ? `${beforeLabel(p)}: ${num(S.before.visits)}` : "";
  const pageUrl = (path) => `https://cedarhollow.uk${path}`;
  const sourcesTitle = p.kind === "year" ? `Where visitors came from in ${periodLabel(p)}` : "Where visitors came from";
  const woodland = part === "oxford" ? "Oxford" : "Dorset";
  const scope =
    part === "all"
      ? ""
      : `Visits that began on ${woodland} pages or moved onto them from elsewhere on the site, and every view of ${woodland} pages. A visit that reaches both woodlands counts in each.`;

  // The whole website's part says where its visits began.
  const began =
    part === "all"
      ? BEGAN.map(([key, name]) => ({ name, visits: S.rows.reduce((n, x) => n + (x.part === key ? x.visits : 0), 0) }))
      : [];
  const beganTotal = began.reduce((n, b) => n + b.visits, 0);

  const months = partMonths(r, part, year);

  // Its average day: the visits on each day of the week, and in each hour.
  const A = S.average;
  const anyDays = A.weekdays.some((v) => v > 0);
  const anyHours = Boolean(A.hours) && A.hours.some((v) => v > 0);
  const overDays = (n) => `over ${num(n)} day${n === 1 ? "" : "s"}`;
  const weekdaysNote =
    p.kind === "week"
      ? `Visits each day.${A.weekdays.includes(null) ? " Days not fully counted are left blank." : ""}`
      : `Average visits on each day of the week, ${overDays(A.days)}.`;
  const busiest = anyHours
    ? A.hours
        .map((v, h) => [v, h])
        .filter(([v]) => v > 0)
        .sort((a, b) => b[0] - a[0] || a[1] - b[1])
        .slice(0, 3)
        .map(([v, h], i) => `${hourSpan(h)} (${fmtAvg(v)}${i ? "" : " visits"})`)
    : [];
  const hoursNote = anyHours
    ? `Average visits in each hour of the day, UK time, ${overDays(A.hourDays)}. ` +
      `Busiest: ${busiest.length > 1 ? `${busiest.slice(0, -1).join(", ")} and ${busiest[busiest.length - 1]}` : busiest[0]}.`
    : "";
  const weekdayValue = (i) => (A.weekdays[i] === null ? "–" : fmtAvg(A.weekdays[i]));

  // Its clicks to book: for the whole website, by where the visits came from,
  // against how many visits each sent; for a woodland, by retreat. Once
  // Checked.in reports bookings, the bookings that followed a click go
  // beside them ("booked"), and how many it took in all.
  const clicks = S.intents.reduce((n, row) => n + row[3], 0);
  const rate = (n, of) => (of ? `${((100 * n) / of).toFixed(1).replace(/\.0$/, "")}%` : "–");
  const bookings =
    r.bookings && r.bookings.live ? r.bookings.list.filter((b) => part === "all" || RETREATS[b.retreat][0] === part) : null;
  const showBookings = Boolean(bookings) && (part !== "dorset" || bookings.length > 0);
  const booked = showBookings ? bookings.filter((b) => b.via) : [];
  const bySource = new Map();
  if (r.clicks && part === "all") {
    const visitsFrom = groupRows(S.rows).bySource;
    const entry = (name) => {
      let c = bySource.get(name);
      if (!c) bySource.set(name, (c = { name, clicks: 0, booked: 0, oxford: 0, dorset: 0, visits: (visitsFrom.get(name) || { visits: 0 }).visits }));
      return c;
    };
    for (const [host, , retreat, n] of S.intents) {
      const c = entry(sourceName(host));
      c.clicks += n;
      c[RETREATS[retreat][0]] += n;
    }
    for (const b of booked) entry(sourceName(b.src)).booked += 1;
  }
  const clickSources = [...bySource.values()].sort(
    (a, b) => b.booked - a.booked || b.clicks - a.clicks || b.visits - a.visits || a.name.localeCompare(b.name)
  );
  const clickRetreats =
    r.clicks && part !== "all"
      ? Object.keys(RETREATS)
          .filter((key) => RETREATS[key][0] === part)
          .map((key) => ({
            name: RETREATS[key][1],
            clicks: S.intents.reduce((n, row) => n + (row[2] === key ? row[3] : 0), 0),
            booked: booked.filter((b) => b.retreat === key).length,
          }))
          .filter((x) => x.clicks > 0 || x.booked > 0)
          .sort((a, b) => b.booked - a.booked || b.clicks - a.clicks)
      : [];
  const gbp = (list) => list.reduce((n, b) => n + (b.currency === "GBP" && b.total ? b.total : 0), 0);
  const money = (pence) => `£${Math.round(pence / 100).toLocaleString("en-GB")}`;
  const plural = (n, word) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;
  const listed = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] || "");
  // Every booking Checked.in knows of, by where it was made: direct, on
  // Checked.in -- some after a click from this site -- or through a channel
  // whose calendar it reads.
  // As Checked.in names them; it learns of these through Hospitable, and sends
  // Hospitable's own bookings -- its site, or keyed in by hand -- as "hospitable".
  const CHANNEL_NAMES = {
    airbnb: "Airbnb",
    "booking.com": "Booking.com",
    vrbo: "Vrbo",
    expedia: "Expedia",
    agoda: "Agoda",
    hospitable: "Hospitable",
  };
  const channelName = (c) => CHANNEL_NAMES[c] || c;
  const madeDirect = showBookings ? bookings.filter((b) => b.channel === "direct") : [];
  const byChannel = new Map();
  for (const b of showBookings ? bookings : []) if (b.channel !== "direct") byChannel.set(b.channel, (byChannel.get(b.channel) || 0) + 1);
  const bookingsLine = showBookings
    ? `${plural(bookings.length, "booking")} ${bookings.length === 1 ? "was" : "were"} made this ${p.kind}` +
      (bookings.length
        ? `: ${listed([
            ...(madeDirect.length ? [`${num(madeDirect.length)} direct on Checked.in`] : []),
            ...[...byChannel].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${num(n)} through ${channelName(c)}`),
          ])}.` +
          (madeDirect.length
            ? ` ${num(booked.length)} of the direct ${madeDirect.length === 1 ? "one" : "ones"} followed a click from this website` +
              (gbp(booked) ? `, worth ${money(gbp(booked))}` : "") +
              "."
            : "")
        : ".")
    : "";
  // A woodland's bookings retreat by retreat: how many, the nights, what the
  // direct ones were worth, and where they came from -- the website and the
  // site that sent the visit, direct on Checked.in some other way, or a channel.
  const retreatBookings =
    showBookings && part !== "all"
      ? Object.keys(RETREATS)
          .filter((key) => RETREATS[key][0] === part)
          .map((key) => {
            const list = bookings.filter((b) => b.retreat === key);
            const fromSite = new Map();
            for (const b of list) if (b.via) fromSite.set(sourceName(b.src), (fromSite.get(sourceName(b.src)) || 0) + 1);
            const other = list.filter((b) => b.channel === "direct" && !b.via).length;
            const channels = new Map();
            for (const b of list) if (b.channel !== "direct") channels.set(b.channel, (channels.get(b.channel) || 0) + 1);
            const site = [...fromSite].sort((a, b) => b[1] - a[1]);
            const siteTotal = site.reduce((n, [, c]) => n + c, 0);
            // A number never wraps away from what it counts.
            const nb = "\u00a0";
            const from = [
              ...(siteTotal ? [`Website${nb}${num(siteTotal)} (${site.map(([name, c]) => `${name}${nb}${num(c)}`).join(", ")})`] : []),
              ...(other ? [`Checked.in direct${nb}${num(other)}`] : []),
              ...[...channels].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${channelName(c)}${nb}${num(n)}`),
            ];
            return { name: RETREATS[key][1], count: list.length, nights: list.reduce((n, b) => n + b.nights, 0), pence: gbp(list), from };
          })
          .filter((x) => x.count > 0)
          .sort((a, b) => b.count - a.count)
      : [];
  const retreatNote =
    "Website means booked on Checked.in after a click from this site, with the site the visit came from; " +
    "Checked.in direct, booked there some other way." +
    (byChannel.size ? " Value counts direct bookings only, and a channel’s bookings count from when Checked.in first saw them: their calendars carry no price." : "");
  const woodlands = (c) =>
    [c.oxford ? `Oxford ${num(c.oxford)}` : "", c.dorset ? `Dorset ${num(c.dorset)}` : ""].filter(Boolean);
  const clicksNote =
    "A click to book is a visit that went on to Checked.in to book (or, for Dorset before 5 October 2026, " +
    "Mallinson’s), counted once for each retreat. Booking straight from the calendars on the stay pages " +
    "counts too." +
    (r.clicksAll ? "" : " Clicks have only been counted since 4 October 2026.");

  // Its searches on Google, when Search Console is set up: how often Google
  // listed its pages, how many clicked, and the searches that did it.
  const G = r.search && !r.search.error ? r.search[part] : null;
  const times = (n) => (n === 1 ? "once" : `${num(n)} times`);
  const what = (part === "all" ? "the site" : `${woodland} pages`) + (G && G.withOld ? ", at either address," : "");
  const searchLine = !G
    ? ""
    : G.impressions
      ? `Google showed ${what} in its search results ${times(G.impressions)}, ` +
        (G.clicks
          ? `and people clicked through ${times(G.clicks)} (${rate(G.clicks, G.impressions)}). `
          : "but nobody clicked through. ") +
        `On average ${part === "all" ? "it" : "they"} appeared at ` +
        `position ${G.position.toFixed(1).replace(/\.0$/, "")}, where 1 is the top of the page.`
      : `Google did not show ${what} in its search results.`;
  const old = part === "all" && r.search && r.search.old;
  const oldLine =
    old && old.impressions
      ? `Of those, the old theoaks.uk address was shown ${times(old.impressions)} and clicked ${times(old.clicks)}; ` +
        "it sends people on here, and its share falls as Google finishes moving it over to cedarhollow.uk."
      : "";
  const searchNote =
    "Google keeps searches made by very few people private, so those listed are the commoner ones." +
    (G && G.withOld ? " They include searches that found the old theoaks.uk address." : "") +
    (r.search && r.search.fresh ? " Its figures for the last two or three days are still coming in." : "");
  const searchFailed = part === "all" && r.search && r.search.error ? "Google’s search figures could not be read this time." : "";

  // ---- plain text ---------------------------------------------------------
  const pad = (s, n) => String(s).padEnd(n);
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const lpad = (s, n) => String(s).padStart(n);
  const text = [
    ...(scope ? [scope] : []),
    `Visits: ${num(S.visits)}${before ? ` (${before})` : ""}`,
    `Page views: ${num(S.views)}`,
    ...(r.clicks ? [`Clicks to book: ${num(clicks)}`] : []),
    ...(showBookings ? [`Bookings: ${num(bookings.length)}`] : []),
    ...(began.length
      ? ["", "WHERE VISITS BEGAN", ...began.map((b) => `${pad(b.name, 38)} ${lpad(num(b.visits), 6)}  ${lpad(share(b.visits, beganTotal), 4)}`)]
      : []),
    ...(months.length
      ? [
          "",
          "MONTH BY MONTH",
          ...months.map(
            (m) =>
              `${pad(MONTHS[m.index], 4)} ${lpad(num(m.visits), 7)} visits ${lpad(num(m.views), 8)} page views   ${split(m.devices, ", ", true)}`
          ),
        ]
      : []),
    "",
    sourcesTitle.toUpperCase(),
    ...(sources.length
      ? sources.map(
          (s) => `${pad(clip(s.name, 34), 34)} ${lpad(num(s.visits), 6)}  ${lpad(share(s.visits), 4)}   ${split(s.devices, ", ", true)}`
        )
      : ["No visits recorded."]),
    ...(withinNote ? [withinNote] : []),
    ...(r.clicks && part === "all"
      ? [
          "",
          "CLICKS TO BOOK",
          clicksNote,
          ...(bookingsLine ? [bookingsLine] : []),
          ...(clickSources.length
            ? [
                ...clickSources.map(
                  (c) =>
                    `${pad(clip(c.name, 34), 34)} ${lpad(num(c.clicks), 4)} of ${lpad(num(c.visits), 6)} visits  ${lpad(rate(c.clicks, c.visits), 6)}` +
                    `${showBookings ? `  booked ${lpad(num(c.booked), 3)}` : ""}   ${woodlands(c).join(", ")}`
                ),
                `${pad("All visits", 34)} ${lpad(num(clicks), 4)} of ${lpad(num(S.visits), 6)} visits  ${lpad(rate(clicks, S.visits), 6)}` +
                  (showBookings ? `  booked ${lpad(num(booked.length), 3)}` : ""),
              ]
            : ["No clicks to book recorded."]),
        ]
      : []),
    ...(r.clicks && part !== "all"
      ? [
          "",
          "CLICKS TO BOOK, BY RETREAT",
          ...(bookingsLine ? [bookingsLine] : []),
          ...(clickRetreats.length
            ? clickRetreats.map((x) => `${pad(x.name, 34)} ${lpad(plural(x.clicks, "click"), 10)}${showBookings ? `  booked ${lpad(num(x.booked), 3)}` : ""}`)
            : ["No clicks to book recorded."]),
        ]
      : []),
    ...(retreatBookings.length
      ? [
          "",
          "BOOKINGS BY RETREAT",
          ...retreatBookings.flatMap((x) => [
            `${pad(x.name, 34)} ${lpad(plural(x.count, "booking"), 12)} ${lpad(plural(x.nights, "night"), 10)} ${lpad(x.pence ? money(x.pence) : "", 8)}`,
            `   ${x.from.join("; ")}`,
          ]),
          retreatNote,
        ]
      : []),
    ...(G
      ? [
          "",
          "SEARCHES ON GOOGLE",
          searchLine,
          ...(oldLine ? [oldLine] : []),
          ...(G.queries.length
            ? [
                `${pad("Search", 40)} ${lpad("Shown", 7)} ${lpad("Clicks", 7)}`,
                ...G.queries.map((q) => `${pad(clip(q.query, 40), 40)} ${lpad(num(q.impressions), 7)} ${lpad(num(q.clicks), 7)}`),
              ]
            : []),
          ...(G.queries.length ? [searchNote] : []),
        ]
      : []),
    ...(searchFailed ? ["", searchFailed] : []),
    "",
    "COMPUTER, PHONE OR TABLET",
    ...deviceRows.map((d) => `${pad(d.name, 10)} ${lpad(num(d.visits), 6)}  ${lpad(share(d.visits), 4)}`),
    ...(anyDays ? ["", "DAY OF THE WEEK", weekdaysNote, WEEKDAYS.map((d, i) => `${d} ${weekdayValue(i)}`).join("   ")] : []),
    ...(anyHours
      ? [
          "",
          "TIME OF DAY",
          hoursNote,
          ...[0, 4, 8, 12, 16, 20].map((h0) =>
            A.hours
              .slice(h0, h0 + 4)
              .map((v, k) => `${pad(hourSpan(h0 + k), 9)} ${lpad(fmtAvg(v), 4)}`)
              .join("     ")
          ),
        ]
      : []),
    "",
    "MOST-READ PAGES (page views)",
    ...S.pages.map((pg) => `${pad(pageUrl(pg.path), 52)} ${lpad(num(pg.views), 6)}`),
  ];

  // ---- HTML ---------------------------------------------------------------
  const bar = (n, of) => {
    const pct = of ? Math.max(1, Math.round((100 * n) / of)) : 0;
    return `<div style="background:#e4e0c8;width:110px;height:8px;border-radius:4px;"><div style="background:#2f4a33;width:${pct}%;height:8px;border-radius:4px;"></div></div>`;
  };
  const legend = (items) =>
    `<p style="margin:10px 0 0;">` +
    items
      .map(
        ([name, colour]) =>
          `<span class="s" style="display:inline-block;margin:0 14px 6px 0;white-space:nowrap;">` +
          `<span style="display:inline-block;width:10px;height:10px;background:${colour};margin-right:5px;"></span>${esc(name)}</span>`
      )
      .join("") +
    "</p>";
  // A bar chart is a picture of equal columns, with any figures above it and
  // the names below as the email's own text, in equal cells that line up
  // with the columns at any width.
  const strip = (cells, style) =>
    `<table role="presentation" style="border-collapse:collapse;width:100%;table-layout:fixed;"><tr>` +
    cells.map((cell) => `<td class="s" style="text-align:center;${style}">${cell}</td>`).join("") +
    "</tr></table>";
  const picture = (img, alt) =>
    `<img src="cid:${img.cid}" width="600" height="180" alt="${esc(alt)}" style="display:block;width:100%;height:auto;border:0;">`;

  // The headline figures sit side by side, and wrap on a phone rather than
  // run off its edge.
  const stat = (value, label) =>
    `<div style="display:inline-block;vertical-align:top;margin:0 30px 8px 0;"><div class="big">${value}</div><div class="s">${label}</div></div>`;
  let html =
    `<p class="part">${esc(title)}</p>` +
    (scope ? `<p class="s" style="margin:0;">${esc(scope)}</p>` : "") +
    `<div style="margin-top:14px;">` +
    stat(num(S.visits), `visits${before ? ` <span style="white-space:nowrap;">(${esc(before)})</span>` : ""}`) +
    stat(num(S.views), "page views") +
    (r.clicks ? stat(num(clicks), "clicks to book") : "") +
    (showBookings ? stat(num(bookings.length), bookings.length === 1 ? "booking" : "bookings") : "") +
    `</div>`;

  if (began.length) {
    html +=
      `<h2 class="h2">Where visits began</h2><table class="t"><tr><th class="hl">Pages</th><th class="hn">Visits</th><th class="hn">Share</th><th class="hn"></th></tr>` +
      began
        .map(
          (b) =>
            `<tr><td class="l">${esc(b.name)}</td><td class="n"><strong>${num(b.visits)}</strong></td><td class="n">${esc(share(b.visits, beganTotal))}</td><td class="n">${bar(b.visits, beganTotal)}</td></tr>`
        )
        .join("") +
      "</table>";
  }

  if (months.length) {
    // Twelve columns, with the month totals above and the month names below.
    const named = topNames(S);
    const stacks = monthStacks(months, named);
    const totals = strip(
      stacks.slots.map((m) => (m && m.visits ? compactNum(m.visits) : "")),
      "font-size:10px;padding:0 0 2px;white-space:nowrap;"
    );
    const labels = strip(MONTHS, "font-size:11px;padding:4px 0 0;");
    const byMonth = months.map((m) => `${MONTHS[m.index]} ${num(m.visits)}`).join(", ");
    const anyOther = stacks.sources.some((stack) => stack[stack.length - 1] > 0);

    const columnsShown = ["Computer", "Phone", "Tablet", ...(months.some((m) => m.devices.Other) ? ["Other"] : [])];
    const monthTable =
      `<table class="t" style="font-size:12px;margin-top:20px;"><tr><th class="hl2">Month</th><th class="hn2">Visits</th><th class="hn2">Page views</th>` +
      columnsShown.map((c) => `<th class="hn2">${c}</th>`).join("") +
      "</tr>" +
      months
        .map(
          (m) =>
            `<tr><td class="l2">${MONTHS[m.index]}</td><td class="n2"><strong>${num(m.visits)}</strong></td><td class="n2">${num(m.views)}</td>` +
            columnsShown.map((c) => `<td class="n2">${m.devices[c] ? num(m.devices[c]) : "&ndash;"}</td>`).join("") +
            "</tr>"
        )
        .join("") +
      `<tr><td class="l2"><strong>Total</strong></td><td class="n2"><strong>${num(S.visits)}</strong></td><td class="n2"><strong>${num(S.views)}</strong></td>` +
      columnsShown.map((c) => `<td class="n2"><strong>${devices[c] ? num(devices[c]) : "&ndash;"}</strong></td>`).join("") +
      "</tr></table>";

    html +=
      `<h2 class="h2">Month by month</h2>` +
      (chart
        ? totals +
          picture(chart.devices, `Bar chart of visits each month, by computer, phone and tablet: ${byMonth}`) +
          labels +
          legend(DEVICE_ORDER.filter((d) => devices[d]).map((d) => [d, DEVICE_COLOURS[d]]))
        : "") +
      monthTable +
      (chart
        ? `<h2 class="h2">Where visitors came from, month by month</h2>` +
          legend([...named.map((name, i) => [name, SOURCE_COLOURS[i]]), ...(anyOther ? [["Other websites", OTHER_COLOUR]] : [])]) +
          totals +
          picture(
            chart.sources,
            `Bar chart of visits each month, split between ${[...named, ...(anyOther ? ["other websites"] : [])].join(", ")}: ${byMonth}`
          ) +
          labels
        : "");
  }

  // The average day: a column a day of the week, with its figure above it
  // and its name below, so the figures show even with the picture hidden;
  // then a column an hour, too many to label each, with every third hour
  // named below and the busiest hours in the line above.
  let averageHtml = "";
  if (anyDays) {
    averageHtml +=
      `<h2 class="h2">Day of the week</h2><p class="s" style="margin:0 0 10px;">${esc(weekdaysNote)}</p>` +
      strip(WEEKDAYS.map((_, i) => esc(weekdayValue(i))), "font-size:11px;padding:0 0 2px;white-space:nowrap;") +
      (day && day.weekdays
        ? picture(
            day.weekdays,
            `Bar chart of ${p.kind === "week" ? "visits each day" : "average visits on each day of the week"}: ${WEEKDAYS.map((d, i) => `${d} ${weekdayValue(i)}`).join(", ")}`
          )
        : "") +
      strip(WEEKDAYS, "font-size:11px;padding:4px 0 0;");
  }
  if (anyHours) {
    averageHtml +=
      `<h2 class="h2">Time of day</h2><p class="s" style="margin:0 0 10px;">${esc(hoursNote).replace(
        /\d+(am|pm)?–\d+(am|pm)( \(\d[\d.,]*( visits)?\))?/g,
        '<span style="white-space:nowrap;">$&</span>'
      )}</p>` +
      (day && day.hours
        ? picture(
            day.hours,
            `Bar chart of average visits in each hour of the day, UK time: ${A.hours.map((v, h) => `${hourSpan(h)} ${fmtAvg(v)}`).join(", ")}`
          ) +
          strip(
            A.hours.map((_, h) => (h % 3 ? "" : String(h % 12 || 12))),
            "font-size:10px;padding:4px 0 0;white-space:nowrap;"
          ) +
          strip(
            ["am", "pm"].map((half) => `<div style="border-top:1px solid #c9c4ab;margin:3px 3px 0;padding-top:1px;">${half}</div>`),
            "font-size:11px;padding:0;"
          )
        : "");
  }

  // Clicks to book: for the whole website, each website's clicks against
  // the visits it sent, with the woodlands they were for under its name; for
  // a woodland, its clicks by retreat.
  let clicksHtml = "";
  if (r.clicks && part === "all") {
    clicksHtml =
      `<h2 class="h2">Clicks to book</h2><p class="s" style="margin:0 0 8px;">${esc(clicksNote)}</p>` +
      (bookingsLine ? `<p style="margin:0 0 8px;">${esc(bookingsLine)}</p>` : "") +
      (clickSources.length
        ? `<table class="t"><tr><th class="hl">Website</th><th class="hn">Visits</th><th class="hn">Clicks</th><th class="hn">Rate</th>` +
          (showBookings ? `<th class="hn">Booked</th>` : "") +
          "</tr>" +
          clickSources
            .map(
              (c) =>
                `<tr><td class="l">${esc(c.name).replace(/\./g, ".<wbr>")}<br><span class="s">${esc(woodlands(c).join(" · "))}</span></td>` +
                `<td class="n">${num(c.visits)}</td><td class="n"><strong>${num(c.clicks)}</strong></td><td class="n">${esc(rate(c.clicks, c.visits))}</td>` +
                (showBookings ? `<td class="n"><strong>${num(c.booked)}</strong></td>` : "") +
                "</tr>"
            )
            .join("") +
          `<tr><td class="l"><strong>All visits</strong></td><td class="n">${num(S.visits)}</td><td class="n"><strong>${num(clicks)}</strong></td><td class="n">${esc(rate(clicks, S.visits))}</td>` +
          (showBookings ? `<td class="n"><strong>${num(booked.length)}</strong></td>` : "") +
          "</tr></table>"
        : `<p class="s">No clicks to book recorded.</p>`);
  } else if (r.clicks) {
    clicksHtml =
      `<h2 class="h2">Clicks to book, by retreat</h2>` +
      (bookingsLine ? `<p style="margin:0 0 8px;">${esc(bookingsLine)}</p>` : "") +
      (clickRetreats.length
        ? `<table class="t"><tr><th class="hl">Retreat</th><th class="hn">Clicks</th>${showBookings ? `<th class="hn">Booked</th>` : ""}</tr>` +
          clickRetreats
            .map(
              (x) =>
                `<tr><td class="l">${esc(x.name)}</td><td class="n"><strong>${num(x.clicks)}</strong></td>` +
                (showBookings ? `<td class="n"><strong>${num(x.booked)}</strong></td>` : "") +
                "</tr>"
            )
            .join("") +
          "</table>"
        : `<p class="s">No clicks to book recorded.</p>`);
  }

  // Bookings by retreat, each with where its bookings came from beneath it.
  let bookingsHtml = "";
  if (retreatBookings.length) {
    const sum = (key) => retreatBookings.reduce((n, x) => n + x[key], 0);
    bookingsHtml =
      `<h2 class="h2">Bookings by retreat</h2>` +
      `<table class="t"><tr><th class="hl">Retreat</th><th class="hn">Bookings</th><th class="hn">Nights</th><th class="hn">Value</th></tr>` +
      retreatBookings
        .map(
          (x) =>
            `<tr><td class="l">${esc(x.name)}<br><span class="s">${esc(x.from.join(" · "))}</span></td>` +
            `<td class="n"><strong>${num(x.count)}</strong></td><td class="n">${num(x.nights)}</td><td class="n">${x.pence ? esc(money(x.pence)) : "&ndash;"}</td></tr>`
        )
        .join("") +
      (retreatBookings.length > 1
        ? `<tr><td class="l"><strong>All</strong></td><td class="n"><strong>${num(sum("count"))}</strong></td><td class="n">${num(sum("nights"))}</td>` +
          `<td class="n">${sum("pence") ? esc(money(sum("pence"))) : "&ndash;"}</td></tr>`
        : "") +
      "</table>" +
      `<p class="s" style="margin:8px 0 0;">${esc(retreatNote)}</p>`;
  }

  // Searches on Google: the totals in a sentence, then the searches.
  let searchHtml = "";
  if (G) {
    searchHtml =
      `<h2 class="h2">Searches on Google</h2><p style="margin:0 0 8px;">${esc(searchLine)}</p>` +
      (oldLine ? `<p class="s" style="margin:0 0 8px;">${esc(oldLine)}</p>` : "") +
      (G.queries.length
        ? `<table class="t"><tr><th class="hl">Search</th><th class="hn">Shown</th><th class="hn">Clicks</th></tr>` +
          G.queries
            .map(
              (q) =>
                `<tr><td class="l">${esc(q.query)}</td><td class="n">${num(q.impressions)}</td><td class="n"><strong>${num(q.clicks)}</strong></td></tr>`
            )
            .join("") +
          "</table>" +
          `<p class="s" style="margin:8px 0 0;">${esc(searchNote)}</p>`
        : "");
  } else if (searchFailed) {
    searchHtml = `<h2 class="h2">Searches on Google</h2><p class="s">${esc(searchFailed)}</p>`;
  }

  // Each website's device split sits under its name rather than in columns
  // of its own: seven columns do not fit a phone, and the full grid is in the
  // spreadsheet. A long host may break after any dot, and nowhere else.
  html +=
    `<h2 class="h2">${esc(sourcesTitle)}</h2><table class="t"><tr><th class="hl">Website</th><th class="hn">Visits</th><th class="hn">Share</th></tr>` +
    (sources
      .map(
        (s) =>
          `<tr><td class="l">${esc(s.name).replace(/\./g, ".<wbr>")}<br><span class="s">${split(s.devices, " &middot; ")}</span></td>` +
          `<td class="n"><strong>${num(s.visits)}</strong></td><td class="n">${esc(share(s.visits))}</td></tr>`
      )
      .join("") || `<tr><td class="l" colspan="3">No visits recorded.</td></tr>`) +
    "</table>" +
    (withinNote ? `<p class="s" style="margin:8px 0 0;">${esc(withinNote)}</p>` : "") +
    clicksHtml +
    bookingsHtml +
    searchHtml +
    // The pie, and beside it the key: each slice's colour, visits and share,
    // which is also everything the pie says for a reader whose mail app
    // hides pictures.
    `<h2 class="h2">Computer, phone or tablet</h2>` +
    (deviceRows.length
      ? `<table role="presentation" style="border-collapse:collapse;"><tr>` +
        (pie
          ? `<td style="vertical-align:middle;padding:0 12px 0 0;"><img src="cid:${pie.cid}" width="110" height="110" alt="${esc(
              `Pie chart of visits by device: ${deviceRows.map((d) => `${d.name} ${share(d.visits)}`).join(", ")}`
            )}" style="display:block;width:110px;height:110px;border:0;"></td>`
          : "") +
        `<td style="vertical-align:middle;"><table class="t" style="width:auto;"><tr><th class="hl">Device</th><th class="hn">Visits</th><th class="hn">Share</th></tr>` +
        deviceRows
          .map(
            (d) =>
              `<tr><td class="l" style="white-space:nowrap;"><span style="display:inline-block;width:10px;height:10px;background:${DEVICE_COLOURS[d.name]};margin-right:6px;"></span>${esc(d.name)}</td>` +
              `<td class="n"><strong>${num(d.visits)}</strong></td><td class="n">${esc(share(d.visits))}</td></tr>`
          )
          .join("") +
        "</table></td></tr></table>"
      : `<p class="s">No visits recorded.</p>`) +
    averageHtml +
    `<h2 class="h2">Most-read pages</h2><table class="t"><tr><th class="hl">Page</th><th class="hn">Page views</th></tr>` +
    (S.pages
      .map(
        (pg) =>
          `<tr><td class="l"><a href="${esc(pageUrl(pg.path))}">${esc(pg.path)}</a></td><td class="n">${num(pg.views)}</td></tr>`
      )
      .join("") || `<tr><td class="l" colspan="2">No page views recorded.</td></tr>`) +
    "</table>";

  return { text, html };
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function csvCell(value) {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function base64(text) {
  return base64Bytes(new TextEncoder().encode(text));
}

function base64Bytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/*
 * A pie chart as a PNG, drawn here: no canvas in a Worker, and no chart
 * service to hand the figures to. `values` go clockwise from twelve o'clock
 * in `colours`, on a clear ground that suits any background, each slice
 * parted from the next by a thin gap. A pixel on the rim or by a gap is
 * sampled 3 x 3 times, and takes its slice's colour as many ninths opaque
 * as samples fell inside, so the edges come out smooth; the rest are
 * sampled once. That makes ten shades of each colour at most, so the pie
 * goes as a palette PNG, a quarter the bytes of full colour. Drawn at
 * 180px to show at 110, so sharp on a high-density screen.
 *
 * Kept quick, since a report draws three and a run can send three reports.
 * No trigonometry per pixel: a gap is found by a point's distance from the
 * line of a cut, and a slice by its "diamond angle" -- a cheap stand-in for
 * the true angle that rises and falls with it, compared against the cuts'
 * own.
 */
async function piePng(values, colours, size = 180) {
  const total = values.reduce((a, b) => a + b, 0);
  const rgb = colours.map(hexRgb);
  const SUB = 3; // samples a side for an edge pixel
  const SHADES = SUB * SUB;
  // Palette: 0 is the clear ground; then each colour at 1..9 ninths opaque.
  const palette = [[255, 255, 255]];
  const opacity = [0];
  for (const colour of rgb) {
    for (let k = 1; k <= SHADES; k++) {
      palette.push(colour);
      opacity.push(Math.round((255 * k) / SHADES));
    }
  }
  const shade = (slice, covered) => 1 + slice * SHADES + covered - 1;
  const c = size / 2;
  const R = c - 1;
  const TURN = 2 * Math.PI;
  const GAP = 1; // half the gap between slices, in pixels

  // Clockwise from twelve o'clock, 0 to 4: the diamond angle of east-north
  // coordinates (dx, -dy).
  const diamond = (dx, dy) => {
    const e = dx;
    const n = -dy;
    if (e >= 0) return n >= 0 ? e / (n + e) : 1 + -n / (e - n);
    return n < 0 ? 2 + -e / (-n - e) : 3 + n / (n - e);
  };

  const angles = [];
  let run = 0;
  for (const v of values) angles.push(((run += v) / total) * TURN);
  // Where each slice ends, as a diamond angle; a slice ending at the full
  // turn ends at 4, not back at 0.
  const ends = angles.map((a) => (a >= TURN - 1e-9 ? 4 : diamond(Math.sin(a), -Math.cos(a))));
  // Where one slice meets the next, as unit vectors from the centre; a
  // single slice is a whole circle, with no cuts.
  const cutAngles = values.filter((v) => v > 0).length > 1 ? [0, ...angles.filter((a, i) => values[i] > 0 && a < TURN - 1e-9)] : [];
  const cx = cutAngles.map((a) => Math.sin(a));
  const cy = cutAngles.map((a) => -Math.cos(a));
  const cuts = cutAngles.length;

  // How close (dx, dy) comes to any cut: its distance from the cut's line,
  // counted only on the cut's own side of the centre.
  const cutDistance = (dx, dy) => {
    let best = Infinity;
    for (let k = 0; k < cuts; k++) {
      if (dx * cx[k] + dy * cy[k] <= 0) continue;
      const d = Math.abs(dx * cy[k] - dy * cx[k]);
      if (d < best) best = d;
    }
    return best;
  };
  const sliceAt = (dx, dy) => {
    const a = diamond(dx, dy);
    let i = 0;
    while (i < ends.length - 1 && a >= ends[i]) i++;
    return i;
  };

  const px = new Uint8Array(size * size);
  if (total > 0) {
    const outer = (R + 1) * (R + 1);
    const inner = (R - 1) * (R - 1);
    const rim = R * R;
    for (let y = 0; y < size; y++) {
      const dy = y + 0.5 - c;
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - c;
        const r2 = dx * dx + dy * dy;
        if (r2 > outer) continue;
        if (r2 < inner && cutDistance(dx, dy) > GAP + 1) {
          px[y * size + x] = shade(sliceAt(dx, dy), SHADES);
          continue;
        }
        // An edge pixel: count the samples inside each slice, and take the
        // slice most of them fell in. Two slices never share a pixel except
        // at the very centre, where the gaps meet.
        const hits = [0, 0, 0, 0, 0, 0, 0, 0];
        let covered = 0;
        for (let sy = 0; sy < SUB; sy++) {
          const ey = y + (sy + 0.5) / SUB - c;
          for (let sx = 0; sx < SUB; sx++) {
            const ex = x + (sx + 0.5) / SUB - c;
            if (ex * ex + ey * ey > rim || cutDistance(ex, ey) < GAP) continue;
            hits[sliceAt(ex, ey)] += 1;
            covered += 1;
          }
        }
        if (!covered) continue;
        let slice = 0;
        for (let i = 1; i < rgb.length; i++) if (hits[i] > hits[slice]) slice = i;
        px[y * size + x] = shade(slice, covered);
      }
    }
  }
  return encodePng(size, size, px, { palette, opacity });
}

/*
 * A stacked column chart as a PNG: a column for each of `stacks` (twelve,
 * one a month; or one a day of the week, or an hour), its values stacked
 * from the bottom in `colours`, on a clear
 * ground with faint guide lines at quarters of the tallest. Only shapes: the
 * totals and month names are the email's own text, which stays readable
 * when a phone shrinks the picture. Drawn at 800 x 240 to show at up to
 * 600 x 180. Every edge falls on a whole pixel, so the picture is a handful
 * of flat colours, and goes as an 8-bit palette PNG: a quarter of the bytes
 * of full colour, and quicker to pack.
 */
async function columnsPng(stacks, colours, width = 800, height = 240) {
  const palette = [[255, 255, 255], hexRgb("#e4e0c8"), ...colours.map(hexRgb)];
  const opacity = [0, 255, ...colours.map(() => 255)]; // 0: the clear ground
  const px = new Uint8Array(width * height);
  const floor = height - 2; // the baseline is the bottom two rows
  const room = floor - 6; // headroom above the tallest column
  // Averages may all be below one, so the tallest sets the scale, whatever it is.
  const tallest = Math.max(0, ...stacks.map((s) => s.reduce((a, b) => a + b, 0))) || 1;
  for (let g = 1; g <= 4; g++) {
    const y = Math.round(floor - (room * g) / 4);
    px.fill(1, y * width, (y + 1) * width);
  }
  px.fill(1, floor * width, height * width);

  const slot = width / stacks.length;
  const bar = Math.round(slot * 0.62);
  stacks.forEach((values, i) => {
    const sum = values.reduce((a, b) => a + b, 0);
    if (!sum) return;
    const x0 = Math.round(i * slot + (slot - bar) / 2);
    let y = floor;
    splitParts(Math.max(2, Math.round((room * sum) / tallest)), values).forEach((h, k) => {
      for (let row = y - h; row < y; row++) px.fill(2 + k, row * width + x0, row * width + x0 + bar);
      y -= h;
    });
  });
  return encodePng(width, height, px, { palette, opacity });
}

function hexRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/*
 * Pixels as a PNG file: RGBA, four bytes a pixel; or, given a palette (and
 * each entry's opacity), one palette index a pixel. The "deflate"
 * CompressionStream writes zlib, which is what a PNG's IDAT holds.
 */
async function encodePng(width, height, data, indexed) {
  const stride = width * (indexed ? 1 : 4);
  const raw = new Uint8Array((stride + 1) * height); // each row: filter 0, then its pixels
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const idat = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer()
  );
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  // 8 bits a channel (or index), palette or RGBA, deflate, standard filters, no interlace
  ihdr.set([8, indexed ? 3 : 6, 0, 0, 0], 8);
  const chunks = [PNG_SIGNATURE, pngChunk("IHDR", ihdr)];
  if (indexed) {
    chunks.push(pngChunk("PLTE", Uint8Array.from(indexed.palette.flat())));
    chunks.push(pngChunk("tRNS", Uint8Array.from(indexed.opacity)));
  }
  chunks.push(pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0)));
  const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function pngChunk(type, data) {
  const out = new Uint8Array(data.length + 12);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}

let crcTable;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let k = n;
      for (let bit = 0; bit < 8; bit++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
      crcTable[n] = k >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function mailReady(env) {
  return Boolean(env.RESEND_API_KEY && env.CONTACT_TO && env.CONTACT_FROM);
}

async function handleContact(request, env) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Payload too large" }, 413);
  }

  let data;
  try {
    data = await readBody(request);
  } catch {
    return json({ ok: false, error: "Malformed submission" }, 400);
  }

  // Honeypot: silently accept obvious bots without emailing.
  if (data._gotcha) return json({ ok: true });

  const label = String(data._form || "form").slice(0, 80);
  const lines = Object.entries(data)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

  if (lines.length === 0) {
    return json({ ok: false, error: "Empty submission" }, 400);
  }

  const body = lines.join("\n");

  // Always log, so a submission is never lost even if the send fails.
  console.log(`[contact] "${label}" submission:\n${body}`);

  if (!mailReady(env)) {
    return json({ ok: false, error: "Mail not configured" }, 503);
  }

  try {
    await sendViaResend(env, {
      subject: `Cedar Hollow website: new "${label}" submission`,
      text: body,
      replyTo: isEmail(data.email) ? String(data.email).trim() : null,
    });
    return json({ ok: true });
  } catch (err) {
    // 403 with "domain is not verified" → the sending subdomain's DNS records
    // are missing or still propagating.
    // 401 → RESEND_API_KEY is wrong or was never set as a secret.
    console.error("[contact] send failed:", err && err.message ? err.message : err);
    return json({ ok: false, error: "Send failed" }, 502);
  }
}

async function sendViaResend(env, { subject, text, html, attachments, replyTo, to }) {
  const payload = {
    from: `${sanitizeHeader(env.CONTACT_FROM_NAME || "Cedar Hollow website")} <${env.CONTACT_FROM}>`,
    to: [to || env.CONTACT_TO],
    subject: sanitizeHeader(subject),
    text,
  };
  if (html) payload.html = html;
  if (attachments) payload.attachments = attachments;
  if (replyTo) payload.reply_to = replyTo;

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend ${response.status}: ${detail.slice(0, 300)}`);
  }

  return response.json();
}

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object") throw new Error("Not an object");
    return parsed;
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

// Strip CR/LF so nothing submitted through the form can smuggle in a header.
function sanitizeHeader(value) {
  return String(value).replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}

function isEmail(value) {
  return typeof value === "string" && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value.trim());
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
