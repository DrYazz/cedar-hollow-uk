/*
 * Cedar Hollow -- Worker entry point.
 *
 * One Worker serves the whole site:
 *   - every static file, via the ASSETS binding (see wrangler.toml)
 *   - POST /api/contact, the homepage contact form
 *   - GET /api/instagram, the live Instagram grids
 *   - every Monday, an email of last week's visitors (see "Weekly visitor
 *     report" below)
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
 * Weekly visitor report.
 *
 * Early every Monday the cron in wrangler.toml also emails last week's
 * Cloudflare Web Analytics figures for cedarhollow.uk: the websites visitors
 * came from, each split by computer, phone and tablet, with the week's totals
 * and most-read pages, and the full source-by-device breakdown attached as a
 * spreadsheet. Cloudflare keeps six months of Web Analytics and thins it to a
 * sample after a week, so these emails are also the long-term record.
 *
 * The figures come from Cloudflare's GraphQL Analytics API, which needs an API
 * token with Account Analytics: Read. It is a secret, set once:
 *
 *   npx wrangler secret put ANALYTICS_API_TOKEN
 *
 * The account and the Web Analytics site are vars in wrangler.toml, as is
 * REPORT_TO, the address the report goes to.
 *
 * POST /api/weekly-report sends it on demand, for checking a change or
 * re-sending a week. It must carry that same token as a bearer token, so
 * nobody without it can trigger mail.
 *
 *   ?week=2026-10-05   any day of the week to report (default: last week)
 *   ?dry=1             answer with the email as JSON instead of sending it
 */
const REPORT_PATH = "/api/weekly-report";
const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const REPORT_TZ = "Europe/London";
const REPORT_TOP_SOURCES = 15;
const REPORT_TOP_PAGES = 10;

// Visits were not counted from the move to Workers static assets until the
// beacon went back in (worker-served pages never got Cloudflare's injected
// one). A week overlapping this is incomplete, and is not compared against.
const UNCOUNTED_FROM = Date.UTC(2026, 9, 1);       // 1 Oct 2026
const UNCOUNTED_UNTIL = Date.UTC(2026, 9, 2, 14); // 2 Oct 2026, mid-afternoon

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
        weeklyReport: analyticsReady(env) && mailReady(env),
      });
    }

    // Static assets normally never reach the Worker -- Cloudflare serves them
    // first -- but fall through explicitly so nothing depends on that ordering.
    return env.ASSETS.fetch(request);
  },

  // The cron in wrangler.toml, early on Mondays: keep the Instagram tokens
  // alive, and email last week's visitor report. Each fails on its own.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshInstagramTokens(env));
    ctx.waitUntil(sendWeeklyReport(env));
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
 * POST /api/weekly-report -- the report on demand. Answers {ok, subject} once
 * sent, or with ?dry=1 the whole email ({subject, text, html, csv}) unsent.
 */
async function handleReportRequest(request, url, env) {
  if (!analyticsReady(env)) return json({ ok: false, error: "Report not configured" }, 503);

  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!given || !(await sameSecret(given, env.ANALYTICS_API_TOKEN))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const dry = url.searchParams.get("dry") === "1";
  const week = url.searchParams.get("week");
  let day;
  if (week) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week);
    if (!m) return json({ ok: false, error: "week must be YYYY-MM-DD" }, 400);
    day = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }

  const result = await sendWeeklyReport(env, { day, containing: Boolean(week), dry });
  return json(result, result.ok ? 200 : 502);
}

/*
 * Build the report and, unless this is a dry run, send it.
 *
 * When the figures cannot be fetched -- the token missing, expired or revoked
 * -- a short note saying so goes out in its place. A report that silently
 * stops arriving would look exactly like a quiet week.
 */
async function sendWeeklyReport(env, { day = Date.now(), containing = false, dry = false } = {}) {
  const week = reportWeek(day, containing);

  if (!analyticsReady(env)) {
    console.error("[report] not configured: needs ANALYTICS_API_TOKEN, ANALYTICS_ACCOUNT and ANALYTICS_SITE");
    return { ok: false, error: "Report not configured" };
  }

  let email;
  try {
    email = renderReport(env, await fetchReport(env, week));
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    console.error(`[report] ${weekLabel(week)}: ${reason}`);
    if (dry || !mailReady(env)) return { ok: false, error: reason };
    email = {
      subject: "Cedar Hollow website: last week's visitor report could not be built",
      text:
        `The visitor report for ${weekLabel(week)} could not be built.\n\n` +
        `Reason: ${reason}\n\n` +
        "The usual cause is the ANALYTICS_API_TOKEN secret on the cedar-hollow-uk " +
        "Worker being missing, expired or revoked.",
    };
  }

  if (dry) {
    const { attachments, ...rest } = email;
    return { ok: true, ...rest };
  }
  if (!mailReady(env)) return { ok: false, error: "Mail not configured" };

  try {
    const { csv, ...message } = email;
    await sendViaResend(env, { ...message, to: env.REPORT_TO || env.CONTACT_TO });
    console.log(`[report] ${weekLabel(week)}: sent`);
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
 * One GraphQL request for the whole report: the week's totals, the week
 * before's for comparison, visits by source and device, and the top pages.
 */
async function fetchReport(env, week) {
  const thisWeek = rumFilter(env, week.from, week.to);
  const weekBefore = rumFilter(env, week.before, week.from);
  const query = `{
    viewer {
      accounts(filter: { accountTag: ${JSON.stringify(env.ANALYTICS_ACCOUNT)} }) {
        week: rumPageloadEventsAdaptiveGroups(filter: ${thisWeek}, limit: 1) {
          count
          sum { visits }
          avg { sampleInterval }
        }
        before: rumPageloadEventsAdaptiveGroups(filter: ${weekBefore}, limit: 1) {
          count
          sum { visits }
          avg { sampleInterval }
        }
        sources: rumPageloadEventsAdaptiveGroups(filter: ${thisWeek}, limit: 5000, orderBy: [sum_visits_DESC]) {
          sum { visits }
          avg { sampleInterval }
          dimensions { refererHost deviceType }
        }
        pages: rumPageloadEventsAdaptiveGroups(filter: ${thisWeek}, limit: ${REPORT_TOP_PAGES}, orderBy: [count_DESC]) {
          count
          avg { sampleInterval }
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

  const total = (rows) => {
    const g = (rows || [])[0];
    return { visits: estimate(g && g.sum && g.sum.visits, g), views: estimate(g && g.count, g) };
  };

  // One row per website and device. A page view from inside the site carries
  // no visit, so rows without one are the site linking to itself and go.
  const rows = [];
  for (const g of account.sources || []) {
    const visits = estimate(g.sum && g.sum.visits, g);
    if (!visits) continue;
    const host = String((g.dimensions && g.dimensions.refererHost) || "").toLowerCase();
    rows.push({
      host,
      source: sourceName(host),
      device: DEVICE_NAMES[g.dimensions && g.dimensions.deviceType] || "Other",
      visits,
    });
  }

  return {
    week,
    account: env.ANALYTICS_ACCOUNT,
    site: env.ANALYTICS_SITE,
    ...total(account.week),
    before: total(account.before),
    rows,
    pages: (account.pages || []).map((g) => ({
      path: String((g.dimensions && g.dimensions.requestPath) || "/"),
      views: estimate(g.count, g),
    })),
  };
}

// Web Analytics thins its data to a sample after a week, and reports how
// thinly in sampleInterval; scaling by it gives the estimate the dashboard
// shows. Within the last week it is 1.
function estimate(value, group) {
  const interval = (group && group.avg && group.avg.sampleInterval) || 1;
  return Math.round((Number(value) || 0) * interval);
}

function rumFilter(env, from, to) {
  const time = (t) => JSON.stringify(new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"));
  return `{ siteTag: ${JSON.stringify(env.ANALYTICS_SITE)}, datetime_geq: ${time(from)}, datetime_lt: ${time(to)} }`;
}

function sourceName(host) {
  if (!host) return DIRECT;
  for (const [pattern, name] of SOURCE_NAMES) {
    if (pattern.test(host)) return name;
  }
  return host.replace(/^www\./, "");
}

/*
 * The weeks run Monday to Sunday on London's clocks. Dates are held as
 * UTC-midnight timestamps -- plain calendar dates, safe to step a day at a
 * time -- and turned into instants only at the edges.
 */
const DAY = 86400000;

// The week before the one containing `day`; or, with `containing`, that week.
function reportWeek(day, containing) {
  const date = londonDate(day);
  let monday = date - ((new Date(date).getUTCDay() + 6) % 7) * DAY;
  if (!containing) monday -= 7 * DAY;
  return {
    monday,
    before: londonMidnight(monday - 7 * DAY),
    from: londonMidnight(monday),
    to: londonMidnight(monday + 7 * DAY),
  };
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

function londonParts(ts) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(ts));
  const p = {};
  for (const { type, value } of parts) p[type] = Number(value);
  return p;
}

// "28 September – 4 October 2026", or with `short`, "28 Sep – 4 Oct".
function weekLabel(week, short = false) {
  const first = new Date(week.monday);
  const last = new Date(week.monday + 6 * DAY);
  const month = short ? "short" : "long";
  const fmt = (d, opts) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(d);
  const sameYear = first.getUTCFullYear() === last.getUTCFullYear();
  const sameMonth = sameYear && first.getUTCMonth() === last.getUTCMonth();
  const start = sameMonth
    ? fmt(first, { day: "numeric" })
    : fmt(first, { day: "numeric", month, ...(sameYear || short ? {} : { year: "numeric" }) });
  const end = fmt(last, { day: "numeric", month, ...(short ? {} : { year: "numeric" }) });
  return `${start} – ${end}`;
}

// Whether a span overlaps the days visits went uncounted.
function uncounted(from, to) {
  return from < UNCOUNTED_UNTIL && to > UNCOUNTED_FROM;
}

/*
 * The email itself: subject, plain text, HTML, and the spreadsheet.
 *
 * Every value from the analytics -- a referring website above all, which any
 * visitor's browser can set to anything -- is escaped for HTML, and guarded
 * in the spreadsheet against being read as a formula.
 */
function renderReport(env, r) {
  const label = weekLabel(r.week);
  const week = r.week;

  // Sources, largest first, each with its visits split by device.
  const bySource = new Map();
  const devices = {};
  for (const row of r.rows) {
    let s = bySource.get(row.source);
    if (!s) bySource.set(row.source, (s = { name: row.source, visits: 0, devices: {} }));
    s.visits += row.visits;
    s.devices[row.device] = (s.devices[row.device] || 0) + row.visits;
    devices[row.device] = (devices[row.device] || 0) + row.visits;
  }
  let sources = [...bySource.values()].sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
  if (sources.length > REPORT_TOP_SOURCES) {
    const rest = sources.slice(REPORT_TOP_SOURCES - 1);
    const other = { name: `${rest.length} other websites`, visits: 0, devices: {} };
    for (const s of rest) {
      other.visits += s.visits;
      for (const [d, n] of Object.entries(s.devices)) other.devices[d] = (other.devices[d] || 0) + n;
    }
    sources = [...sources.slice(0, REPORT_TOP_SOURCES - 1), other];
  }
  const counted = sources.reduce((n, s) => n + s.visits, 0);
  const deviceRows = DEVICE_ORDER.filter((d) => devices[d]).map((d) => ({ name: d, visits: devices[d] }));

  const num = (n) => Number(n || 0).toLocaleString("en-GB");
  const share = (n) => {
    if (!counted || !n) return "0%";
    const pct = (100 * n) / counted;
    return pct < 0.5 ? "<1%" : `${Math.round(pct)}%`;
  };
  const compare = !uncounted(week.before, week.from) && r.before.visits > 0;
  const incomplete = uncounted(week.from, week.to);
  const dashboard = `https://dash.cloudflare.com/${r.account}/web-analytics/overview?siteTag~in=${r.site}`;
  const pageUrl = (path) => `https://cedarhollow.uk${path}`;

  const subject = `Cedar Hollow website: ${num(r.visits)} visits, ${weekLabel(week, true)}`;

  const directNote =
    "“Direct” means the visitor’s browser didn’t say where they came from: " +
    "the address typed in, a bookmark, or a link in WhatsApp, an email or another app.";
  const incompleteNote =
    "Visits weren’t counted from 1 October until the afternoon of 2 October, " +
    "so this week’s figures are incomplete.";

  // ---- plain text ---------------------------------------------------------
  const pad = (s, n) => String(s).padEnd(n);
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const lpad = (s, n) => String(s).padStart(n);
  const text = [
    `Cedar Hollow website: visitors, ${label}`,
    "",
    `Visits: ${num(r.visits)}${compare ? ` (the week before: ${num(r.before.visits)})` : ""}`,
    `Page views: ${num(r.views)}`,
    ...(incomplete ? ["", incompleteNote] : []),
    "",
    "WHERE VISITORS CAME FROM",
    ...sources.map((s) => {
      const split = DEVICE_ORDER
        .filter((d) => s.devices[d])
        .map((d) => `${d.toLowerCase()} ${num(s.devices[d])}`)
        .join(", ");
      return `${pad(clip(s.name, 34), 34)} ${lpad(num(s.visits), 6)}  ${lpad(share(s.visits), 4)}   ${split}`;
    }),
    "",
    "COMPUTER, PHONE OR TABLET",
    ...deviceRows.map((d) => `${pad(d.name, 10)} ${lpad(num(d.visits), 6)}  ${lpad(share(d.visits), 4)}`),
    "",
    "MOST-READ PAGES (page views)",
    ...r.pages.map((p) => `${pad(pageUrl(p.path), 52)} ${lpad(num(p.views), 6)}`),
    "",
    directNote,
    "The full breakdown by website and device is attached as a spreadsheet.",
    `Cloudflare dashboard: ${dashboard}`,
  ].join("\n");

  // ---- HTML ---------------------------------------------------------------
  const ink = "#2b2b22";
  const soft = "#6b6a5c";
  const rule = "#e4e0c8";
  const green = "#2f4a33";
  const th = `style="text-align:right;padding:6px 8px;border-bottom:2px solid ${rule};font-weight:600;font-size:13px;color:${soft};"`;
  const thLeft = th.replace("text-align:right", "text-align:left");
  const td = `style="text-align:right;padding:7px 8px;border-bottom:1px solid ${rule};white-space:nowrap;"`;
  const tdLeft = `style="text-align:left;padding:7px 8px;border-bottom:1px solid ${rule};"`;
  const h2 = `style="font-family:Georgia,serif;font-weight:normal;font-size:20px;color:${green};margin:32px 0 8px;"`;
  const bar = (n) => {
    const pct = counted ? Math.max(1, Math.round((100 * n) / counted)) : 0;
    return `<div style="background:${rule};width:120px;height:8px;border-radius:4px;"><div style="background:${green};width:${pct}%;height:8px;border-radius:4px;"></div></div>`;
  };

  // Each website's device split sits under its name rather than in columns
  // of its own: seven columns do not fit a phone, and the full grid is in the
  // spreadsheet. A long host may break after any dot, and nowhere else.
  const sourceRows = sources
    .map((s) => {
      const split = DEVICE_ORDER.filter((d) => s.devices[d])
        .map((d) => `${d} ${num(s.devices[d])}`)
        .join(" &middot; ");
      return (
        `<tr><td ${tdLeft}>${esc(s.name).replace(/\./g, ".<wbr>")}` +
        `<br><span style="font-size:13px;color:${soft};">${split}</span></td>` +
        `<td ${td}><strong>${num(s.visits)}</strong></td><td ${td}>${share(s.visits)}</td></tr>`
      );
    })
    .join("");
  const deviceHtml = deviceRows
    .map(
      (d) =>
        `<tr><td ${tdLeft}>${esc(d.name)}</td><td ${td}><strong>${num(d.visits)}</strong></td><td ${td}>${share(d.visits)}</td><td ${td}>${bar(d.visits)}</td></tr>`
    )
    .join("");
  const pageHtml = r.pages
    .map(
      (p) =>
        `<tr><td ${tdLeft}><a href="${esc(pageUrl(p.path))}" style="color:${green};">${esc(p.path)}</a></td><td ${td}>${num(p.views)}</td></tr>`
    )
    .join("");

  const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f5e1;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:${ink};">
<p style="margin:0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${soft};">Cedar Hollow website &middot; weekly visitors</p>
<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:26px;color:${green};margin:4px 0 20px;">${esc(label)}</h1>
<table role="presentation" style="border-collapse:collapse;"><tr>
<td style="padding:0 32px 0 0;vertical-align:top;"><div style="font-size:34px;font-family:Georgia,serif;color:${ink};">${num(r.visits)}</div><div style="color:${soft};">visits${compare ? ` <span style="white-space:nowrap;">(week before: ${num(r.before.visits)})</span>` : ""}</div></td>
<td style="padding:0;vertical-align:top;"><div style="font-size:34px;font-family:Georgia,serif;color:${ink};">${num(r.views)}</div><div style="color:${soft};">page views</div></td>
</tr></table>
${incomplete ? `<p style="margin:16px 0 0;padding:10px 12px;background:#fff8e1;border-left:3px solid #c9a227;font-size:14px;">${esc(incompleteNote)}</p>` : ""}
<h2 ${h2}>Where visitors came from</h2>
<table style="border-collapse:collapse;width:100%;font-size:14px;">
<tr><th ${thLeft}>Website</th><th ${th}>Visits</th><th ${th}>Share</th></tr>
${sourceRows || `<tr><td ${tdLeft} colspan="3">No visits recorded.</td></tr>`}
</table>
<p style="margin:8px 0 0;font-size:13px;color:${soft};">${esc(directNote)}</p>
<h2 ${h2}>Computer, phone or tablet</h2>
<table style="border-collapse:collapse;font-size:14px;">
<tr><th ${thLeft}>Device</th><th ${th}>Visits</th><th ${th}>Share</th><th ${th}></th></tr>
${deviceHtml}
</table>
<h2 ${h2}>Most-read pages</h2>
<table style="border-collapse:collapse;width:100%;font-size:14px;">
<tr><th ${thLeft}>Page</th><th ${th}>Page views</th></tr>
${pageHtml}
</table>
<p style="margin:32px 0 0;font-size:13px;color:${soft};">The full breakdown by website and device is attached as a spreadsheet. More detail is on the <a href="${esc(dashboard)}" style="color:${green};">Cloudflare dashboard</a>.</p>
</div></body></html>`;

  // ---- spreadsheet --------------------------------------------------------
  const weekStart = new Date(week.monday).toISOString().slice(0, 10);
  const csvRows = [...r.rows].sort(
    (a, b) =>
      (bySource.get(b.source).visits - bySource.get(a.source).visits) ||
      a.source.localeCompare(b.source) ||
      b.visits - a.visits
  );
  const csv =
    [["Week starting", "Source", "Website", "Device", "Visits"]]
      .concat(csvRows.map((x) => [weekStart, x.source, x.host || "(none)", x.device, x.visits]))
      .map((cells) => cells.map(csvCell).join(","))
      .join("\r\n") + "\r\n";

  return {
    subject,
    text,
    html,
    csv,
    attachments: [{ filename: `cedar-hollow-visitors-${weekStart}.csv`, content: base64("﻿" + csv) }],
  };
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
