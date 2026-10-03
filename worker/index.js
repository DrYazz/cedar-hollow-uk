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
 * totals against the period before; and the most-read pages. A woodland's
 * part counts the visits that began on its own pages, the addresses
 * starting /oxford or /dorset, and every view of them. Visits that began on
 * the shared pages -- the home page, About, Careers and the like -- count in
 * the whole website alone. The full breakdown, by part of the site, website
 * and device, comes attached as a spreadsheet.
 *
 * The figures come from Cloudflare's GraphQL Analytics API. It keeps them
 * exact for seven days and as a one-in-ten sample after that, and answers any
 * question spanning more than a week from the sample -- which, on a site this
 * size, can turn a website that sent two visitors into none, or ten. So the
 * cron runs every morning and reads the day just ended while it is exact, and
 * keeps it in KV (IG_KV, beside the Instagram tokens) twice over: whole, under
 * visits:d:YYYY-MM-DD, for the week's report; and added to its month's
 * running totals, under visits:m:YYYY-MM, which the month's and the year's
 * reports read. A year is twelve small reads rather than 365, which matters:
 * on the Workers free plan every KV read counts against fifty requests a run.
 * A day the cron missed is read from the API when a week's report next needs
 * it, as exactly as the API still has it. Kept figures last three years,
 * outliving the dashboard's six months. Bots are left out throughout, as the
 * dashboard leaves them out by default. (The records under visits:day: are
 * from before the reports were split by woodland, and are left to expire.)
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
const DAY_KEY = "visits:d:";              // + YYYY-MM-DD, in IG_KV
const MONTH_KEY = "visits:m:";            // + YYYY-MM
const YEAR_KEY = "visits:y:";             // + YYYY: the totals, kept by its report
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
// listed here is shown as itself, minus any leading www.
const SOURCE_NAMES = [
  [/(^|\.)google\.[a-z.]+$|^com\.google\./, "Google"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)facebook\.com$|^fb\.me$/, "Facebook"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
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

const DEVICE_NAMES = { desktop: "Computer", mobile: "Phone", tablet: "Tablet" };
const DEVICE_ORDER = ["Computer", "Phone", "Tablet", "Other"];

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
    email = renderReport(p, await reportFigures(env, p, opts));
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
    const { csv, ...message } = email;
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
 * counting did.
 */
async function reportFigures(env, p, opts) {
  const compare = londonMidnight(p.prevStart) >= COUNTED_FULLY;
  let figures;
  let before = null;

  if (p.kind === "week") {
    // One day at a time: keeping a day rewrites its month, and two kept at
    // once would each overwrite the other's addition.
    const days = [];
    for (let d = p.start; d < p.end; d += DAY) days.push(await dayFigures(env, d, opts));
    figures = combine(days);
    if (compare) before = await dayTotals(env, p.prevStart, p.start);
  } else if (p.kind === "month") {
    const d = new Date(p.start);
    const prev = new Date(p.prevStart);
    figures = await monthFigures(env, d.getUTCFullYear(), d.getUTCMonth());
    if (compare) before = partTotals(await monthFigures(env, prev.getUTCFullYear(), prev.getUTCMonth()));
  } else {
    const year = new Date(p.start).getUTCFullYear();
    const twelve = (y) => Promise.all(Array.from({ length: 12 }, (_, m) => monthFigures(env, y, m)));
    const months = await twelve(year);
    figures = { ...combine(months), months };
    if (compare) {
      const kept = await getKept(env, YEAR_KEY + (year - 1));
      before = kept ? kept.parts : partTotals(combine(await twelve(year - 1)));
    }
    if (opts.store && londonMidnight(p.end) <= Date.now()) {
      await putKept(env, YEAR_KEY + year, { year, parts: partTotals(figures) });
    }
  }

  const totals = partTotals(figures);
  const parts = {};
  for (const [part] of PARTS) {
    parts[part] = {
      ...totals[part],
      before: before && before[part],
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
  };
}

/*
 * One London day's figures: kept, or else read from the API -- and then,
 * with opts.store, kept and added to its month. A day before counting began,
 * not yet begun, or older than the API remembers has nothing to read; nor
 * has any day once opts.fetches, the run's allowance of API reads, is spent.
 */
async function dayFigures(env, date, opts) {
  const from = londonMidnight(date);
  const to = londonMidnight(date + DAY);
  const now = Date.now();
  if (to <= COUNTED_FROM || from >= now) return emptyDay(date);

  const kept = await getKept(env, DAY_KEY + isoDate(date));
  if (kept) return kept;
  if (to < now - API_DAYS * DAY || opts.fetches <= 0) return emptyDay(date);

  opts.fetches -= 1;
  const day = await fetchDay(env, date);
  if (opts.store && to <= now) await keepDay(env, day);
  return day;
}

// Keep a day, and add it to its month's running totals -- once only.
async function keepDay(env, day) {
  await putKept(env, DAY_KEY + day.date, day);
  const key = MONTH_KEY + day.date.slice(0, 7);
  const month = (await getKept(env, key)) || (await startMonth(env, day.date));
  if (month.days[day.date]) return;
  addDay(month, day);
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
// then Oxford, then Dorset, so a week can be totted up from its months.
function addDay(month, day) {
  const t = partTotals(day);
  month.days[day.date] = [t.all.visits, t.all.views, t.oxford.visits, t.oxford.views, t.dorset.visits, t.dorset.views];
  month.visits += day.visits;
  month.views += day.views;
  month.sources = addRows(month.sources, day.sources, 3);
  month.pages = addRows(month.pages, day.pages, 1).slice(0, MONTH_PAGES);
}

// A month's running totals, or nothing for a month with none kept.
async function monthFigures(env, year, month) {
  const label = isoDate(Date.UTC(year, month, 1)).slice(0, 7);
  const from = londonMidnight(Date.UTC(year, month, 1));
  const to = londonMidnight(Date.UTC(year, month + 1, 1));
  if (to <= COUNTED_FROM || from >= Date.now()) return emptyMonth(label);
  return (await getKept(env, MONTH_KEY + label)) || emptyMonth(label);
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
 * device and the page they began on; and views of every page. The API scales sampled figures up
 * itself, so they are used as given.
 */
async function fetchDay(env, date) {
  const filter = rumFilter(env, londonMidnight(date), londonMidnight(date + DAY));
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
          dimensions { refererHost deviceType requestPath }
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
  return {
    date: isoDate(date),
    visits: whole(t.sum && t.sum.visits),
    views: whole(t.count),
    // 1 while the day is exact; about 10 once Cloudflare has thinned it.
    sampleInterval: Number((t.avg && t.avg.sampleInterval) || 1),
    // [website, device, part of the site the visit began on, visits]. A page
    // view from inside the site carries no visit, so rows without one are the
    // site linking to itself, and go.
    sources: addRows(
      [],
      (account.sources || [])
        .map((g) => [
          String(dim(g).refererHost || "").toLowerCase(),
          String(dim(g).deviceType || ""),
          partOf(String(dim(g).requestPath || "/")),
          whole(g.sum && g.sum.visits),
        ])
        .filter((row) => row[3] > 0),
      3
    ),
    // [path, page views]
    pages: (account.pages || []).map((g) => [String(dim(g).requestPath || "/"), whole(g.count)]),
  };
}

// Days or months added together.
function combine(list) {
  let visits = 0;
  let views = 0;
  let sources = [];
  let pages = [];
  for (const f of list) {
    visits += f.visits;
    views += f.views;
    sources = addRows(sources, f.sources, 3);
    pages = addRows(pages, f.pages, 1);
  }
  return { visits, views, sources, pages: pages.slice(0, MONTH_PAGES) };
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
  return { month: label, days: {}, visits: 0, views: 0, sources: [], pages: [] };
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

// One part's [host, device, part, visits] rows; for "all", every row.
function inPart(sources, part) {
  return part === "all" ? sources : sources.filter((row) => row[2] === part);
}

// Visits and page views for the whole site and each woodland: a woodland's
// visits are those that began on its pages, its page views every view of them.
function partTotals(f) {
  const t = { all: { visits: f.visits, views: f.views }, oxford: { visits: 0, views: 0 }, dorset: { visits: 0, views: 0 } };
  for (const [, , part, visits] of f.sources) if (t[part] && part !== "all") t[part].visits += visits;
  for (const [path, views] of f.pages) {
    const part = partOf(path);
    if (t[part]) t[part].views += views;
  }
  return t;
}

// Bots left out, as the dashboard leaves them out by default.
function rumFilter(env, from, to) {
  const time = (t) => JSON.stringify(new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"));
  return `{ siteTag: ${JSON.stringify(env.ANALYTICS_SITE)}, datetime_geq: ${time(from)}, datetime_lt: ${time(to)}, bot: 0 }`;
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function sourceName(host) {
  if (!host) return DIRECT;
  for (const [pattern, name] of SOURCE_NAMES) {
    if (pattern.test(host)) return name;
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

// What the period before is called: "week before", "September", "2025".
function beforeLabel(p) {
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
const CHART_HEIGHT = 120; // px, the busiest month's column
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
  ".hl,.hn{padding:6px 8px}.l,.n{padding:7px 8px}.hl2,.hn2,.l2,.n2{padding:6px 4px}",
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

/*
 * The email itself: subject, plain text, HTML, and the spreadsheet. Its
 * three parts, in PARTS order, each come from renderPart.
 *
 * Every value from the analytics -- a referring website above all, which any
 * visitor's browser can set to anything -- is escaped for HTML, and guarded
 * in the spreadsheet against being read as a formula.
 */
function renderReport(p, r) {
  const label = periodLabel(p);
  const year = new Date(p.start).getUTCFullYear();
  const note = periodNote(p);
  const dashboard = `https://dash.cloudflare.com/${r.account}/web-analytics/overview?siteTag~in=${r.site}`;
  const visits = fmtNum(r.parts.all.visits);

  const subject = {
    week: `Cedar Hollow website: ${visits} visits, ${periodLabel(p, true)}`,
    month: `Cedar Hollow website: ${visits} visits in ${label}`,
    year: `Cedar Hollow website: ${visits} visits in ${label}, month by month`,
  }[p.kind];
  const kicker = { week: "weekly visitors", month: "monthly visitors", year: "the year in visitors" }[p.kind];
  const directNote =
    "“Direct” means the visitor’s browser didn’t say where they came from: " +
    "the address typed in, a bookmark, or a link in WhatsApp, an email or another app.";
  const attached = "The full breakdown by part of the site, website and device is attached as a spreadsheet.";

  const text = [`Cedar Hollow website: visitors, ${label}`, ...(note ? ["", note] : [])];
  let parts = "";
  for (const [part, title] of PARTS) {
    const section = renderPart(p, r, part, title);
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
  const line = (key, x) => [key, PART_LABELS[x.part] || x.part, x.source, x.host || "(none)", x.device, x.visits];
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
    // A byte-order mark first, so Excel reads the file as UTF-8.
    attachments: [{ filename: `cedar-hollow-visitors-${stamp}.csv`, content: base64(String.fromCharCode(0xfeff) + csv) }],
  };
}

/*
 * One part of a report -- the whole website, or one woodland -- as plain
 * text lines and HTML. The year's report adds its graphs, month by month.
 *
 * The year's graphs are made of tables and blocks of colour rather than
 * images or SVG, which most mail clients block or strip; every figure in
 * them is in a table beside them too.
 */
function renderPart(p, r, part, title) {
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
  const scope = part === "all" ? "" : `Visits that began on ${part === "oxford" ? "Oxford" : "Dorset"} pages, and every view of them.`;

  // The whole website's part says where its visits began.
  const began =
    part === "all"
      ? BEGAN.map(([key, name]) => ({ name, visits: r.rows.reduce((n, x) => n + (x.part === key ? x.visits : 0), 0) }))
      : [];
  const beganTotal = began.reduce((n, b) => n + b.visits, 0);

  // The year's months, from the first one anything was counted in.
  const months = (r.months || [])
    .map((m, index) => {
      const rows = toRows(inPart(m.sources, part));
      const visits = part === "all" ? m.visits : rows.reduce((n, x) => n + x.visits, 0);
      const views = part === "all" ? m.views : m.pages.reduce((n, [path, v]) => n + (partOf(path) === part ? v : 0), 0);
      return { index, visits, views, rows, ...groupRows(rows) };
    })
    .filter((m) => londonMidnight(Date.UTC(year, m.index + 1, 1)) > COUNTED_FROM);

  // ---- plain text ---------------------------------------------------------
  const pad = (s, n) => String(s).padEnd(n);
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const lpad = (s, n) => String(s).padStart(n);
  const text = [
    ...(scope ? [scope] : []),
    `Visits: ${num(S.visits)}${before ? ` (${before})` : ""}`,
    `Page views: ${num(S.views)}`,
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
    "",
    "COMPUTER, PHONE OR TABLET",
    ...deviceRows.map((d) => `${pad(d.name, 10)} ${lpad(num(d.visits), 6)}  ${lpad(share(d.visits), 4)}`),
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

  let html =
    `<p class="part">${esc(title)}</p>` +
    (scope ? `<p class="s" style="margin:0;">${esc(scope)}</p>` : "") +
    `<table role="presentation" style="border-collapse:collapse;margin-top:14px;"><tr>` +
    `<td style="padding:0 30px 0 0;vertical-align:top;"><div class="big">${num(S.visits)}</div><div class="s">visits${before ? ` <span style="white-space:nowrap;">(${esc(before)})</span>` : ""}</div></td>` +
    `<td style="padding:0;vertical-align:top;"><div class="big">${num(S.views)}</div><div class="s">page views</div></td>` +
    `</tr></table>`;

  if (began.length) {
    html +=
      `<h2 class="h2">Where visits began</h2><table class="t"><tr><th class="hl">Pages</th><th class="hn">Visits</th><th class="hn">Share</th><th class="hn"></th></tr>` +
      began
        .map(
          (b) =>
            `<tr><td class="l">${esc(b.name)}</td><td class="n"><strong>${num(b.visits)}</strong></td><td class="n">${share(b.visits, beganTotal)}</td><td class="n">${bar(b.visits, beganTotal)}</td></tr>`
        )
        .join("") +
      "</table>";
  }

  if (months.length) {
    const busiest = Math.max(1, ...months.map((m) => m.visits));

    // Visits each month, a column per month, stacked by device.
    const columns = months
      .map((m) => {
        const height = m.visits ? Math.max(2, Math.round((CHART_HEIGHT * m.visits) / busiest)) : 0;
        const pieces = splitParts(height, DEVICE_ORDER.map((d) => m.devices[d] || 0));
        const stack = DEVICE_ORDER.map((d, i) => [d, pieces[i]])
          .filter(([, h]) => h > 0)
          .reverse()
          .map(([d, h]) => `<div style="height:${h}px;background:${DEVICE_COLOURS[d]};font-size:0;line-height:0;"></div>`)
          .join("");
        return (
          `<td style="vertical-align:bottom;text-align:center;padding:0 2px;">` +
          `<div class="s" style="font-size:10px;line-height:14px;white-space:nowrap;">${m.visits ? compactNum(m.visits) : ""}</div>` +
          `<div style="width:70%;margin:0 auto;">${stack}</div></td>`
        );
      })
      .join("");
    const columnLabels = months
      .map((m) => `<td class="s" style="text-align:center;font-size:11px;padding:4px 0 0;border-top:1px solid #e4e0c8;">${MONTHS[m.index]}</td>`)
      .join("");
    // A short year (2026 began in October) keeps the columns a year's width.
    const chartWidth = Math.max(30, Math.round((100 * months.length) / 12));

    const columnsShown = ["Computer", "Phone", "Tablet", ...(months.some((m) => m.devices.Other) ? ["Other"] : [])];
    const monthTable =
      `<table class="t" style="font-size:13px;margin-top:20px;"><tr><th class="hl2">Month</th><th class="hn2">Visits</th><th class="hn2">Page views</th>` +
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

    // Where each month's visitors came from: a bar per month, as long as its
    // visits, divided between the year's biggest websites and the rest.
    const named = sources.filter((s) => !s.other).slice(0, CHART_SOURCES);
    const colours = [...SOURCE_COLOURS.slice(0, named.length), OTHER_COLOUR];
    let anyOther = false;
    const bars = months
      .map((m) => {
        const pieces = named.map((s) => (m.bySource.get(s.name) || { visits: 0 }).visits);
        const rest = Math.max(0, m.list.reduce((n, s) => n + s.visits, 0) - pieces.reduce((a, b) => a + b, 0));
        if (rest) anyOther = true;
        const shares = splitParts(100, [...pieces, rest]);
        const width = m.visits ? Math.max(2, Math.round((100 * m.visits) / busiest)) : 0;
        const cells = shares
          .map((pct, i) =>
            pct ? `<td style="width:${pct}%;height:14px;padding:0;background:${colours[i]};font-size:0;line-height:0;">&nbsp;</td>` : ""
          )
          .join("");
        return (
          `<tr><td class="s" style="width:34px;padding:3px 6px 3px 0;">${MONTHS[m.index]}</td>` +
          `<td style="padding:3px 0;">${width && cells ? `<table role="presentation" style="border-collapse:collapse;width:${width}%;"><tr>${cells}</tr></table>` : ""}</td>` +
          `<td style="width:48px;text-align:right;font-size:12px;padding:3px 0 3px 6px;white-space:nowrap;">${m.visits ? num(m.visits) : "&ndash;"}</td></tr>`
        );
      })
      .join("");

    html +=
      `<h2 class="h2">Month by month</h2>` +
      `<table role="presentation" style="border-collapse:collapse;width:${chartWidth}%;table-layout:fixed;"><tr>${columns}</tr><tr>${columnLabels}</tr></table>` +
      legend(DEVICE_ORDER.filter((d) => devices[d]).map((d) => [d, DEVICE_COLOURS[d]])) +
      monthTable +
      `<h2 class="h2">Where visitors came from, month by month</h2>` +
      legend([...named.map((s, i) => [s.name, SOURCE_COLOURS[i]]), ...(anyOther ? [["Other websites", OTHER_COLOUR]] : [])]) +
      `<table role="presentation" style="border-collapse:collapse;width:100%;margin-top:4px;">${bars}</table>`;
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
          `<td class="n"><strong>${num(s.visits)}</strong></td><td class="n">${share(s.visits)}</td></tr>`
      )
      .join("") || `<tr><td class="l" colspan="3">No visits recorded.</td></tr>`) +
    "</table>" +
    `<h2 class="h2">Computer, phone or tablet</h2><table class="t" style="width:auto;"><tr><th class="hl">Device</th><th class="hn">Visits</th><th class="hn">Share</th><th class="hn"></th></tr>` +
    deviceRows
      .map(
        (d) =>
          `<tr><td class="l">${esc(d.name)}</td><td class="n"><strong>${num(d.visits)}</strong></td><td class="n">${share(d.visits)}</td><td class="n">${bar(d.visits, counted)}</td></tr>`
      )
      .join("") +
    "</table>" +
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
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
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
