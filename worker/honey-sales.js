/*
 * Honey sales, from MenuLab, for the private page's Honey tab.
 *
 * GET /wdtcf/honey-sales (see visitorMap) answers with the last twelve
 * months, month by month, and the last seven days, day by day: honey sold at
 * the Honesty Box (MenuLab's table 10) and at every table together, in units
 * and in pence. "Honey" is every product with "honey" in its name -- the
 * jars, the comb, and what is made from or about honey: the bonbons, the
 * mead, the honeyade, the tasting -- and Hive Mind Drink, the honeyade's
 * name before it took the word. A new honey product is counted the day it
 * appears, as long as it says so in its name.
 *
 * The figures are MenuLab's net ones: refunds taken off, cancelled orders,
 * abandoned checkouts and voided lines left out. Dates are the venue's own
 * trading days. They come from MenuLab's sales API on the venue's own token,
 * MENULAB_SALES_TOKEN, a secret of this Worker; it is never sent anywhere but
 * MenuLab, and never back to the page.
 *
 * One request to MenuLab answers both charts: the summary grouped by
 * product, table and day, from the first of the month eleven months back to
 * today. It is kept for five minutes, so the tab, which asks again every five
 * minutes while it is open, is never what keeps MenuLab busy.
 *
 * Each item's own months and days come too (items), so the tab's item list
 * can show any one of them without asking again.
 */

const SALES_API = "https://app.menulab.com/api/business/theoaks/sales/summary";
const HONESTY_BOX = "10";
const ALSO_HONEY = ["hive mind drink"];
const KEEP_MS = 5 * 60 * 1000;
const DAY_MS = 86400000;

let kept = { at: 0, today: "", body: null };

export function isHoney(name) {
  const n = String(name || "").toLowerCase();
  return n.includes("honey") || ALSO_HONEY.includes(n);
}

// "12.50" (MenuLab's money is a string) as 1250. Net figures can be negative.
export function pence(value) {
  return Math.round(Number(value || 0) * 100);
}

function addDays(day, n) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}

// The twelve months ending with today's, oldest first, as "YYYY-MM".
export function lastTwelveMonths(today) {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out = [];
  for (let i = 0; i < 12; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    if (--m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}

// What MenuLab's answer means, in words for the tab.
function failure(status, body) {
  if (status === 401) return "MenuLab did not accept the sales token: it is missing, has expired, or is wrong.";
  if (status === 403) return "The sales token's MenuLab user does not own this venue.";
  if (status === 404) return "MenuLab's sales API is not there (404).";
  if (status === 422) {
    const errors = body && body.errors ? JSON.stringify(body.errors) : "";
    return "MenuLab turned the request down (422)" + (errors ? ": " + errors : ".");
  }
  return `MenuLab's sales API answered ${status}.`;
}

// Sums the summary's rows into the two charts: for all the honey together,
// and for each item on its own. Exported for testing.
export function shape(rows, today) {
  const months = lastTwelveMonths(today);
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(today, -i));
  const blank = () => ({ hbUnits: 0, hbPence: 0, units: 0, pence: 0 });
  const sheet = () => ({
    byMonth: Object.fromEntries(months.map((m) => [m, blank()])),
    byDay: Object.fromEntries(days.map((d) => [d, blank()])),
  });
  const all = sheet();
  const items = new Map();
  for (const r of rows) {
    if (!isHoney(r.product_name)) continue;
    const units = Number(r.net_units || 0);
    const value = pence(r.net_revenue);
    if (!units && !value) continue;
    const box = String(r.table_id) === HONESTY_BOX;
    if (!items.has(r.product_name)) items.set(r.product_name, sheet());
    for (const target of [all, items.get(r.product_name)]) {
      for (const slot of [target.byMonth[String(r.trading_date).slice(0, 7)], target.byDay[r.trading_date]]) {
        if (!slot) continue;
        slot.units += units;
        slot.pence += value;
        if (box) {
          slot.hbUnits += units;
          slot.hbPence += value;
        }
      }
    }
  }
  const row = (key, s) => [key, s.hbUnits, s.hbPence, s.units, s.pence];
  const lay = (t) => ({ months: months.map((m) => row(m, t.byMonth[m])), days: days.map((d) => row(d, t.byDay[d])) });
  const names = [...items.keys()].sort((a, b) => a.localeCompare(b));
  return {
    ...lay(all),
    products: names,
    items: names.map((name) => ({ name, ...lay(items.get(name)) })),
  };
}

// The tab's figures, as a plain object: { ok: true, ... } or { ok: false, error }.
export async function honeySales(env, today, fetcher = fetch) {
  if (!env.MENULAB_SALES_TOKEN) {
    return { ok: false, status: 503, error: "The MenuLab sales token has not been given to the website yet." };
  }
  if (kept.body && kept.today === today && Date.now() - kept.at < KEEP_MS) return kept.body;
  const from = lastTwelveMonths(today)[0] + "-01";
  const url = `${SALES_API}?group_by=product,table,day&from=${from}&to=${today}`;
  let res;
  try {
    res = await fetcher(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${env.MENULAB_SALES_TOKEN}` },
    });
  } catch (err) {
    return { ok: false, status: 502, error: "MenuLab could not be reached." };
  }
  let body = null;
  try {
    body = await res.json();
  } catch (err) {
    body = null;
  }
  if (!res.ok || !body || !Array.isArray(body.data)) {
    return { ok: false, status: 502, error: res.ok ? "MenuLab's answer could not be read." : failure(res.status, body) };
  }
  const out = {
    ok: true,
    today,
    from,
    currency: (body.business && body.business.currency) || "GBP",
    ...shape(body.data, today),
    at: new Date().toISOString(),
  };
  kept = { at: Date.now(), today, body: out };
  return out;
}
