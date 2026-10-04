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

const ci = Boolean(process.env.WORKERS_CI_COMMIT_SHA);
const stamp = {
  commit: process.env.WORKERS_CI_COMMIT_SHA || git("rev-parse HEAD") || "unknown",
  branch: process.env.WORKERS_CI_BRANCH || git("rev-parse --abbrev-ref HEAD") || "unknown",
  source: ci ? "workers-builds" : "manual",
  built: new Date().toISOString(),
};

writeFileSync(new URL("../public/build.json", import.meta.url), JSON.stringify(stamp, null, 2) + "\n");
console.log(`[stamp-build] ${stamp.commit.slice(0, 7)} on ${stamp.branch} (${stamp.source})`);
