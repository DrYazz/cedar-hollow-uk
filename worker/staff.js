/*
 * The staff guide, at /staff/, behind a password.
 *
 * Nothing of the guide is in this repository, which is public: it carries
 * lock combinations, the escape room's start code and the team's numbers.
 * Its page and its photographs and video live in IG_KV, under "staff:guide.html"
 * and "staff:media/<name>", put there by scripts/build-staff-guide.py from a
 * folder kept off GitHub. This file only decides who may see them.
 *
 * The password is the Worker secret STAFF_PASSWORD, one for the whole team.
 * Signing in sets a cookie for thirty days, signed with the password itself,
 * so changing the password signs everyone out. Ten wrong tries from one
 * address lock it out for fifteen minutes. Until STAFF_PASSWORD is set, the
 * guide stays shut.
 *
 * Kept out of search engines (noindex on every answer) and linked from
 * nowhere on the site. /staff/suppliers is not part of this: it is a public
 * page with nothing secret on it, served as a plain file. wrangler.toml's
 * run_worker_first sends only the guide's own addresses here.
 */

const BASE = "/staff";
const COOKIE = "ch_staff";
const DAYS = 30;
const MAX_TRIES = 10;
const LOCK_SECONDS = 15 * 60;
// The video is an MP4 named .m4v: an address ending .mp4 is not sent to the
// Worker by the asset router (tested with wrangler dev), whatever
// run_worker_first says, and would be answered "not found".
const MEDIA = /^[a-z0-9-]{1,80}\.(m4v|webp|jpg|png)$/;
const TYPES = { m4v: "video/mp4", webp: "image/webp", jpg: "image/jpeg", png: "image/png" };
const HEADERS = {
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
};

// The guide's own addresses; everything else under /staff/ is a plain file.
export function isStaffGuide(pathname) {
  return (
    pathname === BASE ||
    pathname === BASE + "/" ||
    pathname === BASE + "/index.html" ||
    pathname === BASE + "/login" ||
    pathname === BASE + "/logout" ||
    pathname.startsWith(BASE + "/media/")
  );
}

export async function staffGuide(request, url, env) {
  const path = url.pathname;
  if (path === BASE || path === BASE + "/index.html") return redirect(url, BASE + "/");
  if (path === BASE + "/login") return login(request, url, env);
  if (path === BASE + "/logout") {
    return redirect(url, BASE + "/", `${COOKIE}=; Path=${BASE}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  }
  const signedIn = await validCookie(request, env);
  if (path.startsWith(BASE + "/media/")) {
    if (!signedIn) return page("Sign in first.", 403, "text/plain; charset=utf-8");
    return media(request, path.slice((BASE + "/media/").length), env);
  }
  if (request.method !== "GET" && request.method !== "HEAD") return page("Method not allowed", 405, "text/plain; charset=utf-8");
  if (!signedIn) return page(loginPage(url, env), 200);
  const guide = env.IG_KV ? await env.IG_KV.get("staff:guide.html") : null;
  if (!guide) return page(shell("The guide has not been uploaded yet.", '<p>Ask Yaz to upload it.</p>'), 503);
  return page(guide, 200);
}

// POST /staff/login: the password from the form, against STAFF_PASSWORD.
async function login(request, url, env) {
  if (request.method !== "POST") return redirect(url, BASE + "/");
  if (!env.STAFF_PASSWORD) return redirect(url, BASE + "/?e=unset");
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return page("Forbidden", 403, "text/plain; charset=utf-8");
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const triesKey = `staff:tries:${ip}`;
  const tries = env.IG_KV ? Number(await env.IG_KV.get(triesKey)) || 0 : 0;
  if (tries >= MAX_TRIES) return redirect(url, BASE + "/?e=locked");
  let given = "";
  try {
    const form = await request.formData();
    given = String(form.get("password") || "").slice(0, 200);
  } catch (err) {
    given = "";
  }
  if (!given || !(await same(given, env.STAFF_PASSWORD))) {
    if (env.IG_KV) await env.IG_KV.put(triesKey, String(tries + 1), { expirationTtl: LOCK_SECONDS });
    return redirect(url, BASE + "/?e=wrong");
  }
  if (env.IG_KV && tries) await env.IG_KV.delete(triesKey);
  const exp = Math.floor(Date.now() / 1000) + DAYS * 86400;
  const token = `${exp}.${await sign(env.STAFF_PASSWORD, exp)}`;
  return redirect(url, BASE + "/", `${COOKIE}=${token}; Path=${BASE}; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`);
}

async function validCookie(request, env) {
  if (!env.STAFF_PASSWORD) return false;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([A-Za-z0-9_-]+)`).exec(request.headers.get("cookie") || "");
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  return same(m[2], await sign(env.STAFF_PASSWORD, m[1]));
}

async function sign(secret, exp) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`staff|${exp}`)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Equal, in time that does not depend on where they differ.
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)))));
  return crypto.subtle.timingSafeEqual(x, y);
}

// A photograph or the video, from IG_KV, in parts when a part is asked for,
// as a phone's video player always does.
async function media(request, name, env) {
  if (!MEDIA.test(name) || !env.IG_KV) return page("Not found", 404, "text/plain; charset=utf-8");
  const body = await env.IG_KV.get(`staff:media/${name}`, { type: "arrayBuffer" });
  if (!body) return page("Not found", 404, "text/plain; charset=utf-8");
  const bytes = new Uint8Array(body);
  const size = bytes.byteLength;
  const headers = {
    ...HEADERS,
    "content-type": TYPES[name.split(".").pop()],
    "cache-control": "private, max-age=86400",
    "accept-ranges": "bytes",
  };
  const asked = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get("range") || "").trim());
  if (!asked || (!asked[1] && !asked[2])) {
    return new Response(request.method === "HEAD" ? null : bytes, { headers: { ...headers, "content-length": String(size) } });
  }
  const start = asked[1] ? Number(asked[1]) : Math.max(0, size - Number(asked[2]));
  const end = asked[1] && asked[2] ? Math.min(Number(asked[2]), size - 1) : size - 1;
  if (start > end) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  return new Response(request.method === "HEAD" ? null : bytes.subarray(start, end + 1), {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}

function redirect(url, to, cookie) {
  const headers = { ...HEADERS, location: new URL(to, url).toString(), "cache-control": "no-store" };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(null, { status: 303, headers });
}

function page(body, status, type = "text/html; charset=utf-8") {
  return new Response(body, { status, headers: { ...HEADERS, "content-type": type, "cache-control": "no-store" } });
}

const SAYS = {
  wrong: "That password is not right. Try again.",
  locked: "Too many tries. Wait fifteen minutes, then try again.",
  unset: "The staff password has not been set up yet.",
};

function loginPage(url, env) {
  const said = env.STAFF_PASSWORD ? SAYS[url.searchParams.get("e")] : SAYS.unset;
  return shell(
    "Staff guide",
    (said ? `<p class="said" role="alert">${said}</p>` : "") +
      `<form method="post" action="${BASE}/login">` +
      '<label for="pw">Password</label>' +
      '<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>' +
      '<button type="submit">Open the guide</button>' +
      "</form>" +
      '<p class="small">For the Cedar Hollow team. Ask Yaz if you need the password.</p>'
  );
}

function shell(title, body) {
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex, nofollow">' +
    `<title>${title} | Cedar Hollow staff</title>` +
    '<link rel="icon" href="/images/favicon.svg" type="image/svg+xml">' +
    "<style>" +
    "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f6ea;color:#3f4433;font:17px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:24px 16px;box-sizing:border-box}" +
    "main{width:100%;max-width:380px}" +
    "h1{font:400 2rem/1.1 Georgia,serif;color:#3b4126;margin:0 0 18px}" +
    "label{display:block;font-weight:600;margin:0 0 6px}" +
    "input{width:100%;box-sizing:border-box;font:inherit;font-size:1.1rem;padding:14px;border:1px solid rgba(59,65,38,.3);border-radius:12px;background:#fffef8;color:inherit}" +
    "button{width:100%;margin-top:14px;min-height:52px;border:0;border-radius:12px;background:#3b4126;color:#fffef8;font:600 1.05rem/1 system-ui,sans-serif;cursor:pointer}" +
    ":focus-visible{outline:3px solid #1f5fa8;outline-offset:2px}" +
    ".said{background:#fff3e0;border:1px solid #e8b06a;border-radius:10px;padding:10px 12px;margin:0 0 14px}" +
    ".small{color:#6b6f5a;font-size:.9rem;margin-top:18px}" +
    "</style></head><body><main>" +
    `<h1>${title}</h1>${body}` +
    "</main></body></html>"
  );
}
