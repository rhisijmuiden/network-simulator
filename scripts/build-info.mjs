// Writes server/build-info.json with the version, branch and commit of this build.
// The Info dialog and the updater use it to know what is installed.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};
const info = {
  version: pkg.version,
  commit: process.env.NETSIM_COMMIT || git("rev-parse HEAD") || "unknown",
  branch: process.env.NETSIM_BRANCH || git("rev-parse --abbrev-ref HEAD") || "unknown",
  builtAt: new Date().toISOString(),
};
writeFileSync(new URL("../server/build-info.json", import.meta.url), JSON.stringify(info, null, 2) + "\n");
console.log(`build-info: ${info.version} ${info.branch} ${info.commit.slice(0, 7)}`);
