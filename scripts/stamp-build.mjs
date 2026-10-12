/*
 * Writes public/build.json: which commit the site being deployed was built
 * from. Wrangler runs this before every deploy (see [build] in wrangler.toml),
 * so https://cedarhollow.uk/build.json always names the commit that is live.
 *
 * .github/workflows/site-health.yml compares that with the tip of main. If
 * they differ for long enough, a build failed to deploy, and the workflow
 * starts another.
 *
 * Workers Builds sets WORKERS_CI_COMMIT_SHA. Anywhere else (wrangler dev, a
 * deploy by hand) it falls back to git, and says so in "source". The file is
 * generated, so it is in .gitignore.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

// A build started by the deploy hook -- site-health's retry after a failed
// build -- is given the branch name in WORKERS_CI_COMMIT_SHA, not a commit.
// Stamped as is, build.json said "main" (12 October 2026), which never equals
// main's commit, so the health check took the site for stale, rebuilt it
// every run and would have raised an alert. The checkout's own HEAD is the
// commit such a build is building.
const ciSha = process.env.WORKERS_CI_COMMIT_SHA || "";
const ci = Boolean(ciSha);
const stamp = {
  commit: (/^[0-9a-f]{40}$/i.test(ciSha) ? ciSha : git("rev-parse HEAD")) || ciSha || "unknown",
  branch: process.env.WORKERS_CI_BRANCH || git("rev-parse --abbrev-ref HEAD") || "unknown",
  source: ci ? "workers-builds" : "manual",
  built: new Date().toISOString(),
};

writeFileSync(new URL("../public/build.json", import.meta.url), JSON.stringify(stamp, null, 2) + "\n");
console.log(`[stamp-build] ${stamp.commit.slice(0, 7)} on ${stamp.branch} (${stamp.source})`);
