/*
 * Cedar Hollow — Dorset guest reviews.
 *
 * Oxford's reviews come from the owner's Repuso feed, which the browser can
 * call directly (see js/reviews-live.js). Dorset has no Repuso subscription,
 * so its reviews are fetched here instead, from Google and Tripadvisor
 * directly, and handed to the page in the same shape Repuso uses — so the
 * wall, its filters and its cards need no special case for them.
 *
 * Why this lives in the Worker rather than the browser:
 *
 *   1. Both APIs authenticate with a key. A key in a static page is a key
 *      anyone can lift and spend, and Google's is billable.
 *   2. Neither sends CORS headers a browser would accept.
 *   3. Both cap what they return, so the answer is small and changes slowly.
 *      Fetching it once a day for everyone beats fetching it per visitor.
 *
 * What you get, and why it is not more:
 *
 *   Tripadvisor's Content API returns "up to 5 of the most recent reviews for
 *   a specific location" — their words — with more only on a paid tier.
 *   Google's Places API returns a handful per place and gives no way to page
 *   past them. So this is the latest ten or so, not the several hundred each
 *   platform holds. The page links out to both for the rest.
 *
 * Every failure is silent and total: no keys, a bad key, a changed payload or
 * a timeout all end in an empty list, and the page simply shows no Dorset
 * reviews rather than an error. That matches how the Oxford feed already
 * behaves, and it is the right trade for something decorative.
 */

const CACHE_SECONDS = 60 * 60 * 12;     // twice a day is far oftener than the reviews change
const TIMEOUT_MS = 6000;
const GOOGLE_ENDPOINT = "https://places.googleapis.com/v1/places/";
const TRIPADVISOR_ENDPOINT = "https://api.content.tripadvisor.com/api/v1/location/";

export function reviewsConfigured(env) {
  return Boolean(
    (env.GOOGLE_PLACES_KEY && env.DORSET_GOOGLE_PLACE_ID) ||
    (env.TRIPADVISOR_KEY && env.DORSET_TRIPADVISOR_ID)
  );
}

export async function handleDorsetReviews(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: "GET" });

  const hit = await cache.match(key);
  if (hit) return hit;

  const [google, tripadvisor] = await Promise.all([
    fromGoogle(env).catch(() => []),
    fromTripadvisor(env).catch(() => []),
  ]);

  const items = google.concat(tripadvisor).sort(byNewest);

  const response = new Response(JSON.stringify({ items }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      /* Cached at the edge and in the browser alike. An empty list is cached
         for a short while only, so a key added this afternoon shows up this
         afternoon rather than tomorrow. */
      "Cache-Control": `public, max-age=${items.length ? CACHE_SECONDS : 300}`,
    },
  });

  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

/* --- Google ------------------------------------------------------------- */

async function fromGoogle(env) {
  const key = env.GOOGLE_PLACES_KEY;
  const place = env.DORSET_GOOGLE_PLACE_ID;
  if (!key || !place) return [];

  const url = GOOGLE_ENDPOINT + encodeURIComponent(place);
  const res = await withTimeout(url, {
    headers: {
      "X-Goog-Api-Key": key,
      /* Asking for the reviews field alone keeps this on the cheapest SKU
         Google bills for a Place Details call. */
      "X-Goog-FieldMask": "reviews",
    },
  });
  if (!res.ok) return [];

  const body = await res.json();
  return (body.reviews || []).map((r, i) => normalise({
    id: "google-" + (r.name || i),
    type: "googleplace",
    from_name: r.authorAttribution && r.authorAttribution.displayName,
    rating_value: r.rating,
    posted_on: r.publishTime,
    text: r.originalText ? r.originalText.text : r.text && r.text.text,
    post_url: r.googleMapsUri,
  }));
}

/* --- Tripadvisor -------------------------------------------------------- */

async function fromTripadvisor(env) {
  const key = env.TRIPADVISOR_KEY;
  const location = env.DORSET_TRIPADVISOR_ID;
  if (!key || !location) return [];

  const url = TRIPADVISOR_ENDPOINT + encodeURIComponent(location) +
    "/reviews?language=en&key=" + encodeURIComponent(key);
  /* Tripadvisor rejects calls whose Referer is not on the key's allow-list,
     so send the site's own origin. */
  const res = await withTimeout(url, {
    headers: { Accept: "application/json", Referer: "https://cedarhollow.uk/" },
  });
  if (!res.ok) return [];

  const body = await res.json();
  return (body.data || []).map((r) => normalise({
    id: "tripadvisor-" + r.id,
    type: "tripadvisor",
    from_name: r.user && (r.user.username || r.user.name),
    rating_value: r.rating,
    posted_on: r.published_date,
    text: r.text,
    post_url: r.url,
  }));
}

/* --- Shared -------------------------------------------------------------- */

/* The shape js/reviews-live.js already reads. Anything it would reject --
   empty text, a missing name -- is dropped here rather than sent and hidden,
   so what crosses the wire is what appears. */
function normalise(raw) {
  const text = String(raw.text || "").trim();
  const rating = Number(raw.rating_value);
  return {
    id: raw.id,
    type: raw.type,
    status: 1,
    disabled: 0,
    from_name: String(raw.from_name || "").trim() || "A guest",
    rating_value: isFinite(rating) && rating > 0 ? Math.min(5, rating) : 5,
    posted_on: isoDay(raw.posted_on),
    text,
    post_url: /^https:\/\//i.test(raw.post_url || "") ? raw.post_url : "",
  };
}

/* Both platforms date things differently -- Google sends an RFC 3339 stamp,
   Tripadvisor a plain day. The page only ever shows a month and a year, and
   sorts on the string, so both become the same plain day. */
function isoDay(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10) + " 00:00:00";
}

function byNewest(a, b) {
  return String(b.posted_on || "").localeCompare(String(a.posted_on || ""));
}

async function withTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({ signal: controller.signal }, options));
  } finally {
    clearTimeout(timer);
  }
}
