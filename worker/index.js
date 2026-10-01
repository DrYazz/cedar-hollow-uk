/*
 * Cedar Hollow -- Worker entry point.
 *
 * One Worker serves the whole site:
 *   - every static file, via the ASSETS binding (see wrangler.toml)
 *   - POST /api/contact, the homepage contact form
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
      });
    }

    // Static assets normally never reach the Worker -- Cloudflare serves them
    // first -- but fall through explicitly so nothing depends on that ordering.
    return env.ASSETS.fetch(request);
  },

  // The cron in wrangler.toml. Its only job is keeping the Instagram tokens alive.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshInstagramTokens(env));
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

async function sendViaResend(env, { subject, text, replyTo }) {
  const payload = {
    from: `${sanitizeHeader(env.CONTACT_FROM_NAME || "Cedar Hollow website")} <${env.CONTACT_FROM}>`,
    to: [env.CONTACT_TO],
    subject: sanitizeHeader(subject),
    text,
  };
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
