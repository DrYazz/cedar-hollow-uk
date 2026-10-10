/*
 * Can every menu item and footer link actually be read?
 *
 * Twice in October 2026 a burger menu opened as an empty panel: its links were
 * the same moss green as the panel behind them, left over from a time that
 * page's menu sat on the cream page instead. The footers' social icons had
 * the same fault on the Dorset pages. Nothing was missing from the HTML, so
 * no amount of reading the markup would have caught it; it has to be looked
 * at in a browser.
 *
 * So this opens every page in public/ (and public/oxford/), at a computer's
 * width and a phone's, opens its burger menu, and measures the colour of every
 * link and heading in the menu and the footer against the colour actually
 * painted behind it. Anything under 3:1 -- the WCAG floor for large text, and
 * far above the 1:1 of the faults above -- fails the check, with the page,
 * the width, the item and both colours.
 *
 * Run by .github/workflows/contrast.yml on every pull request that touches
 * public/, against the pull request's own files served as they are. Locally:
 *   npm install --no-save playwright && npx playwright install chromium
 *   (cd public && python3 -m http.server 8765) &
 *   node scripts/check-contrast.mjs            # BASE defaults to that server
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

// require() rather than import, so any playwright install resolves, old or new.
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE || "http://localhost:8765/";
const MIN = 3;
const WIDTHS = [1440, 390];
// Pages that have no burger menu on purpose: the 404 page, the legal pages'
// plain top bar, the honesty-box honey page and the internal style guide.
const NO_MENU = new Set(["404.html", "cookies.html", "privacy-policy.html", "terms-of-service.html", "honey.html", "style-guide.html"]);

// Every real page: forwarders (a meta refresh) only send the reader on.
function pages() {
  const out = [];
  for (const dir of ["", "oxford/"]) {
    for (const f of readdirSync(join("public", dir))) {
      if (!f.endsWith(".html")) continue;
      const html = readFileSync(join("public", dir, f), "utf8");
      if (/http-equiv="refresh"/i.test(html)) continue;
      out.push(dir + f);
    }
  }
  return out.sort();
}

// Runs in the page: each menu and footer item's colour against what is behind it.
function measure() {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  // The first ancestor that paints a background is what the text sits on.
  const behind = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a >= 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const out = [];
  const check = (el, where, colour) => {
    if (!shown(el)) return;
    const fg = parse(colour);
    if (!fg) return;
    const bg = behind(el);
    let opacity = 1;
    for (let e = el; e; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
    out.push({
      where,
      item: (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40),
      ratio: Math.round(ratio(fg, bg) * 100) / 100,
      opacity: Math.round(opacity * 100) / 100,
      fg: colour,
      bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
    });
  };
  const menu = document.getElementById("ch-nav-menu");
  if (menu) menu.querySelectorAll("a, .ch-navgroup__title").forEach((el) => check(el, "menu", getComputedStyle(el).color));
  const foot = document.querySelector(".section-footer");
  if (foot) {
    foot.querySelectorAll("a, .footer_col-title").forEach((el) => {
      const svg = el.querySelector("svg");
      // an icon link draws in its own svg's colour
      if (svg && !el.textContent.trim()) check(el, "footer icon", getComputedStyle(svg).color);
      else check(el, "footer", getComputedStyle(el).color);
    });
  }
  return { hasMenu: Boolean(menu), items: out };
}

const browser = await chromium.launch();
const faults = [];
let views = 0;
let items = 0;
for (const page of pages()) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const tab = await ctx.newPage();
    try {
      await tab.goto(BASE + page, { waitUntil: "networkidle", timeout: 45000 });
      const toggle = tab.locator(".ch-nav__toggle").first();
      if (await toggle.count()) {
        await toggle.click();
        await tab.waitForTimeout(900); // the menu's items animate in
      }
      const { hasMenu, items: found } = await tab.evaluate(measure);
      views++;
      items += found.length;
      if (!hasMenu && !NO_MENU.has(page)) faults.push(`${page} @${width}px: no burger menu`);
      for (const f of found) {
        if (f.ratio < MIN || f.opacity < 0.4) {
          faults.push(`${page} @${width}px: ${f.where} "${f.item}" is ${f.fg} on ${f.bg} (${f.ratio}:1${f.opacity < 1 ? `, opacity ${f.opacity}` : ""})`);
        }
      }
    } catch (err) {
      faults.push(`${page} @${width}px: could not be checked (${String(err.message).split("\n")[0]})`);
    }
    await ctx.close();
  }
}
await browser.close();

console.log(`Checked ${items} menu and footer items over ${views} page views.`);
if (faults.length) {
  console.log(`\n${faults.length} cannot be read (under ${MIN}:1 against what is behind them):\n`);
  for (const f of faults) console.log("  " + f);
  process.exit(1);
}
console.log("Every menu and footer item can be read.");
