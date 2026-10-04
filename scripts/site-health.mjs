/*
 * Site health check, run by .github/workflows/site-health.yml every 15
 * minutes and whenever a Cloudflare build of main fails.
 *
 * Two jobs:
 *
 * 1. Check the live site does what visitors need: pages load, www redirects,
 *    the contact form reaches the Worker and can send, the map tiles serve.
 *
 * 2. Check the live site is running the tip of main. Cloudflare's build
 *    machines sometimes fail to start, and a failed build leaves the previous
 *    version live, silently, until the next push. If the commit in
 *    /build.json (written by scripts/stamp-build.mjs) is not main's, this
 *    calls the Workers Builds deploy hook to build main again.
 *
 * Anything still wrong after a second look a minute later opens a GitHub
 * issue labelled "site-health", which emails the repo's watchers once. Later
 * runs comment only when the list of problems changes, and close the issue
 * when everything passes again. The job itself only fails if this script
 * crashes, so nobody gets an email every 15 minutes during an outage.
 *
 * It never submits the contact form: that would email the inbox each run.
 * GET /api/contact answering 405 in JSON proves the request reached the
 * Worker, and /health proves the Worker holds the mail key -- between them,
 * the two ways the form has actually broken.
 *
 * Run locally (read-only unless DEPLOY_HOOK_URL and a token are set):
 *   node scripts/site-health.mjs
 */

const SITE = "https://cedarhollow.uk";
const REPO = process.env.GITHUB_REPOSITORY || "thelabgroup/cedar-hollow-uk";
const TOKEN = process.env.GITHUB_TOKEN || "";
const HOOK = process.env.DEPLOY_HOOK_URL || "";
const FAILED_SHA = process.env.FAILED_SHA || ""; // set when a failed build triggered this run
const RUN_URL = process.env.RUN_URL || "";
const LABEL = "site-health";

const RETRY_AFTER_MIN = 15;   // a normal build takes 2-3 minutes; give it room
const ALERT_AFTER_MIN = 60;   // retries have had four chances by then
const STUCK_AFTER_MIN = 45;   // a build "in progress" this long has hung
const RENEWAL_MAX_DAYS = 9;   // Instagram tokens renew every Monday
const RECHECK_DELAY_MS = 60_000;

const notes = []; // shown in the run summary, never alerted on

/* ---------- site checks ---------- */

async function get(url, init = {}) {
  return fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "cedar-hollow-site-health", ...(init.headers || {}) },
    ...init,
  });
}

async function json(res) {
  try { return await res.json(); } catch { return null; }
}

// Each check resolves to null (fine) or a sentence a person can act on.
const checks = {
  async home() {
    const res = await get(`${SITE}/`);
    if (res.status !== 200) return `The homepage answers ${res.status}.`;
    const server = res.headers.get("server") || "";
    if (!/cloudflare/i.test(server)) return `The homepage is not served by Cloudflare (server: ${server || "none"}). Has DNS changed?`;
    return null;
  },

  async www() {
    const res = await get("https://www.cedarhollow.uk/oxford.html?x=1");
    const to = res.headers.get("location") || "";
    if (![301, 308].includes(res.status) || to !== `${SITE}/oxford.html?x=1`) {
      return `www.cedarhollow.uk no longer redirects to cedarhollow.uk (answered ${res.status}${to ? ` to ${to}` : ""}).`;
    }
    return null;
  },

  async pages() {
    const paths = ["/oxford.html", "/dorset.html", "/about.html", "/search-results.html", "/sitemap.xml", "/robots.txt"];
    const bad = [];
    for (const p of paths) {
      const res = await get(SITE + p);
      if (res.status !== 200) bad.push(`${p} (${res.status})`);
    }
    return bad.length ? `Pages not loading: ${bad.join(", ")}.` : null;
  },

  async contactReachesWorker() {
    const res = await get(`${SITE}/api/contact`);
    const type = res.headers.get("content-type") || "";
    if (res.status !== 405 || !type.includes("application/json")) {
      return `The contact form's address is not reaching the Worker (GET /api/contact answered ${res.status}, ${type || "no content type"}). Enquiries will fail. Check run_worker_first in wrangler.toml.`;
    }
    return null;
  },

  async workerHealth() {
    const res = await get(`${SITE}/health`);
    const body = res.status === 200 ? await json(res) : null;
    if (!body || body.ok !== true) return `/health is failing (${res.status}). The Worker may be down.`;
    if (body.mailConfigured !== true) return "The contact form cannot send: the Worker has no mail key (RESEND_API_KEY).";

    // Instagram: only once tokens exist, and only if renewal has stopped.
    for (const site of body.instagram || []) {
      const renewed = (body.instagramRenewed || {})[site];
      if (!renewed) { notes.push(`Instagram ${site}: token set, not yet renewed.`); continue; }
      const days = (Date.now() - Date.parse(renewed)) / 86_400_000;
      if (days > RENEWAL_MAX_DAYS) {
        return `The ${site} Instagram token was last renewed ${Math.floor(days)} days ago; renewal is failing and the grid will freeze when the token expires.`;
      }
      notes.push(`Instagram ${site}: renewed ${renewed.slice(0, 10)}.`);
    }
    return null;
  },

  async mapTiles() {
    const res = await get("https://tiles.cedarhollow.uk/southern-england.pmtiles", { headers: { range: "bytes=0-15" } });
    return res.status === 206 ? null : `The map's tile file is not serving (answered ${res.status}); the zoomed-out map will be blank.`;
  },
};

async function runChecks(names) {
  const failed = {};
  for (const name of names) {
    try {
      const problem = await checks[name]();
      if (problem) failed[name] = problem;
    } catch (err) {
      failed[name] = `Check "${name}" could not reach the site: ${err && err.message ? err.message : err}.`;
    }
  }
  return failed;
}

/* ---------- GitHub ---------- */

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!res.ok && res.status !== 422) {
    throw new Error(`GitHub ${init.method || "GET"} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

/* ---------- deploy pipeline ---------- */

async function checkPipeline() {
  const head = await gh(`/repos/${REPO}/commits/main`);
  const sha = head.sha;
  const ageMin = (Date.now() - Date.parse(head.commit.committer.date)) / 60_000;

  const res = await get(`${SITE}/build.json?t=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
  // No stamp means a deploy from before stamping existed, so it counts as
  // behind, the same as a stamp naming an older commit.
  const live = (res.status === 200 && (await json(res))) || { commit: "", built: "" };

  if (live.commit === sha) {
    notes.push(`Live site is on main's latest commit ${sha.slice(0, 7)}, built ${live.built}.`);
    return null;
  }

  // Behind. Is a build of this commit still running?
  const runs = await gh(`/repos/${REPO}/commits/${sha}/check-runs`);
  const build = (runs.check_runs || []).find((r) => r.name.startsWith("Workers Builds"));
  const running = build && build.status !== "completed";

  const summary = `live ${live.commit ? live.commit.slice(0, 7) : "unstamped"}, main ${sha.slice(0, 7)} pushed ${Math.round(ageMin)} min ago, Cloudflare build ${build ? build.conclusion || build.status : "not reported"}`;
  notes.push(`Live site is behind main: ${summary}.`);

  const failedNow = FAILED_SHA === sha;
  const due = failedNow || (ageMin >= RETRY_AFTER_MIN && (!running || ageMin >= STUCK_AFTER_MIN));
  if (due) {
    if (!HOOK) {
      notes.push("Would start a new build, but the CF_DEPLOY_HOOK_URL secret is not set.");
    } else {
      const hook = await fetch(HOOK, { method: "POST", signal: AbortSignal.timeout(20_000) });
      const body = await json(hook);
      notes.push(
        hook.ok
          ? `Started a new build of main${body && body.already_exists ? " (one was already starting)" : ""}: ${body && body.build_uuid}.`
          : `The deploy hook refused the request (${hook.status}).`
      );
      if (!hook.ok) return `The deploy hook failed (${hook.status}), so a failed build cannot be retried automatically. Check the CF_DEPLOY_HOOK_URL secret.`;
    }
  }

  if (ageMin >= ALERT_AFTER_MIN) {
    return `The live site has been behind main for ${Math.round(ageMin)} minutes (${summary}). Automatic retries have not fixed it; Cloudflare's status page may explain why.`;
  }
  return null;
}

/* ---------- alerting ---------- */

function keyOf(problems) {
  return Object.keys(problems).sort().join(",");
}

async function report(problems) {
  if (!TOKEN) return; // local run: print only
  await gh(`/repos/${REPO}/labels`, {
    method: "POST",
    body: JSON.stringify({ name: LABEL, color: "d93f0b", description: "Opened and closed by the site health check" }),
  }); // 422 when it already exists, which is fine

  const open = (await gh(`/repos/${REPO}/issues?labels=${LABEL}&state=open&per_page=5`)).filter((i) => !i.pull_request);
  const issue = open[0];
  const key = keyOf(problems);
  const list = Object.values(problems).map((p) => `- ${p}`).join("\n");
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const footer = `${RUN_URL ? `[Check run](${RUN_URL}) · ` : ""}${when}\n\n<!-- site-health-key:${key} -->`;

  if (key && !issue) {
    const first = Object.values(problems)[0];
    const more = Object.keys(problems).length - 1;
    await gh(`/repos/${REPO}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `Site health: ${first.length > 90 ? first.slice(0, 87) + "..." : first}${more ? ` (+${more} more)` : ""}`,
        labels: [LABEL],
        body: `The scheduled health check found a problem on https://cedarhollow.uk that was still there a minute later.\n\n${list}\n\nThis issue updates itself and closes when everything passes again.\n\n${footer}`,
      }),
    });
    console.log("Opened an issue.");
  } else if (key && issue) {
    const previous = ((issue.body || "").match(/site-health-key:([^ ]*) -->/) || [])[1];
    if (previous !== key) {
      await gh(`/repos/${REPO}/issues/${issue.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: `The problems have changed:\n\n${list}\n\n${footer}` }),
      });
      await gh(`/repos/${REPO}/issues/${issue.number}`, {
        method: "PATCH",
        body: JSON.stringify({ body: (issue.body || "").replace(/<!-- site-health-key:[^ ]* -->/, `<!-- site-health-key:${key} -->`) }),
      });
      console.log(`Updated issue #${issue.number}.`);
    }
  } else if (!key && issue) {
    await gh(`/repos/${REPO}/issues/${issue.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: `Recovered: every check passes again.\n\n${RUN_URL ? `[Check run](${RUN_URL}) · ` : ""}${when}` }),
    });
    await gh(`/repos/${REPO}/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
    console.log(`Closed issue #${issue.number}.`);
  }
}

/* ---------- main ---------- */

async function main() {
  let problems = await runChecks(Object.keys(checks));
  if (Object.keys(problems).length) {
    // A second look, so a single slow response does not email anybody.
    await new Promise((r) => setTimeout(r, RECHECK_DELAY_MS));
    problems = await runChecks(Object.keys(problems));
  }

  try {
    const pipeline = await checkPipeline();
    if (pipeline) problems.pipeline = pipeline;
  } catch (err) {
    notes.push(`Could not check the deploy pipeline: ${err.message}`);
  }

  const lines = [
    "## Site health",
    "",
    ...(Object.keys(problems).length ? Object.values(problems).map((p) => `- ❌ ${p}`) : ["- ✅ All site checks pass."]),
    ...notes.map((n) => `- ${n}`),
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  }

  await report(problems);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
