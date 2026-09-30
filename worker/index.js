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
  async fetch(request, env) {
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

    // Kept from the old service so the migration can be smoke-tested the same way.
    if (url.pathname === "/health") {
      return json({ ok: true, mailConfigured: mailReady(env) });
    }

    // Static assets normally never reach the Worker -- Cloudflare serves them
    // first -- but fall through explicitly so nothing depends on that ordering.
    return env.ASSETS.fetch(request);
  },
};

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
