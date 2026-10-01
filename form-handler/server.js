import express from "express";
import nodemailer from "nodemailer";

const {
  PORT = 3000,
  SMTP_HOST,
  SMTP_PORT = "587",
  SMTP_SECURE = "false",
  SMTP_USER,
  SMTP_PASS,
  CONTACT_TO = "hello@thelabgroup.com",
  CONTACT_FROM,
  ALLOWED_ORIGINS = "",
} = process.env;

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

// --- CORS -------------------------------------------------------------------
// Comma-separated allowlist. If empty, every origin is allowed (open).
const allowlist = ALLOWED_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const permitted =
    allowlist.length === 0 || (origin && allowlist.includes(origin));
  if (permitted) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Mailer -----------------------------------------------------------------
const mailReady = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const transporter = mailReady
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE === "true",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

// --- Routes -----------------------------------------------------------------
/* --- Instagram ---------------------------------------------------------------
 * GET /api/instagram?site=oxford|dorset -> the four most recent posts.
 *
 * The grids on the two location home pages were curated by hand because the
 * Basic Display API was retired in 2024 and its replacement needs a server to
 * hold a token. This is that server.
 *
 * The same endpoint exists in worker/index.js, the way /api/contact does: the
 * site is served from Railway today, and the Worker is the other side of a
 * migration that has not happened. Whichever one is in front, the shapes match,
 * so js/instagram-live.js only ever changes its base URL.
 *
 * Two woodlands, two accounts, two tokens, set in Railway's variables:
 *   @cedarhollowoxford         -> IG_TOKEN_OXFORD
 *   @mallinsonswoodlandretreat -> IG_TOKEN_DORSET
 *
 * Without a token this answers 503 and the page keeps the posts in its own
 * markup, so the grid is never empty.
 */
const IG_TOKENS = {
  oxford: process.env.IG_TOKEN_OXFORD,
  dorset: process.env.IG_TOKEN_DORSET,
};
const IG_FIELDS = "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp";
const IG_COUNT = 4;
const IG_TTL_MS = 30 * 60 * 1000;
const igCache = new Map();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mailConfigured: mailReady,
    instagram: Object.keys(IG_TOKENS).filter((s) => Boolean(IG_TOKENS[s])),
  });
});

app.get("/api/instagram", async (req, res) => {
  const site = String(req.query.site || "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(IG_TOKENS, site)) {
    return res.status(400).json({ ok: false, error: "Unknown site" });
  }
  const token = IG_TOKENS[site];
  if (!token) return res.status(503).json({ ok: false, error: "Not configured" });

  const cached = igCache.get(site);
  if (cached && cached.until > Date.now()) {
    res.set("cache-control", "public, max-age=900");
    return res.json(cached.body);
  }

  // media_url and thumbnail_url are signed and expire within days, which is
  // why these were downloaded in the first place. Handing them to the browser
  // is fine while they are fresh, hence a cache in minutes, not days.
  const url = new URL("https://graph.instagram.com/me/media");
  url.searchParams.set("fields", IG_FIELDS);
  url.searchParams.set("limit", String(IG_COUNT));
  url.searchParams.set("access_token", token);

  let payload;
  try {
    const upstream = await fetch(url, { headers: { accept: "application/json" } });
    if (!upstream.ok) {
      return res.status(502).json({ ok: false, error: "Upstream rejected the request" });
    }
    payload = await upstream.json();
  } catch {
    return res.status(502).json({ ok: false, error: "Upstream unreachable" });
  }

  const posts = (Array.isArray(payload?.data) ? payload.data : [])
    .map(igPost)
    .filter(Boolean)
    .slice(0, IG_COUNT);

  // A short set would leave some cells current and some stale, which reads as
  // broken rather than as out of date. Better to let the page keep its own.
  if (posts.length < IG_COUNT) {
    return res.status(502).json({ ok: false, error: "Too few posts" });
  }

  const body = { ok: true, site, posts };
  igCache.set(site, { body, until: Date.now() + IG_TTL_MS });
  res.set("cache-control", "public, max-age=900");
  res.json(body);
});

function igPost(item) {
  if (!item || !item.permalink) return null;
  const video = item.media_type === "VIDEO";
  const image = video ? item.thumbnail_url : item.media_url;
  if (!image) return null;
  return {
    permalink: item.permalink,
    image,
    reel: video && /\/reel(s)?\//.test(item.permalink),
    alt: igAlt(item.caption),
    timestamp: item.timestamp || "",
  };
}

/* The curated grid had alt text written by hand, which a feed cannot produce.
   The first sentence of the caption is the closest honest substitute; with no
   caption the image sits inside a link that names where it goes, so an empty
   alt beats a guess. */
function igAlt(caption) {
  if (!caption) return "";
  const first = String(caption).split(/(?<=[.!?])\s|\n/)[0].trim();
  if (!first) return "";
  return first.length > 140 ? first.slice(0, 137).trimEnd() + "..." : first;
}

app.post("/api/contact", async (req, res) => {
  const data = req.body || {};

  // Honeypot: silently accept obvious bots without emailing.
  if (data._gotcha) return res.json({ ok: true });

  const label = String(data._form || "form").slice(0, 80);
  const lines = Object.entries(data)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

  if (lines.length === 0) {
    return res.status(400).json({ ok: false, error: "Empty submission" });
  }

  const body = lines.join("\n");

  // Always log so a submission is never lost, even before SMTP is configured.
  console.log(`[contact] "${label}" submission:\n${body}`);

  if (!mailReady) {
    return res
      .status(503)
      .json({ ok: false, error: "Mail not configured" });
  }

  try {
    await transporter.sendMail({
      from: CONTACT_FROM || SMTP_USER,
      to: CONTACT_TO,
      replyTo: typeof data.email === "string" ? data.email : undefined,
      subject: `Cedar Hollow website — new "${label}" submission`,
      text: body,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[contact] send failed:", err);
    return res.status(502).json({ ok: false, error: "Send failed" });
  }
});

app.listen(Number(PORT), () => {
  console.log(
    `form-handler listening on ${PORT} (mail ${mailReady ? "configured" : "NOT configured"})`
  );
});
