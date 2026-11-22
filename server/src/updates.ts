import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildInfo, config } from "./config.js";

/**
 * Updates come from the GitHub repository. Two channels map to two branches:
 * production (stable) and test (preview of the next release). The app only
 * checks and requests; the privileged helper network-simulator-update (started
 * by a systemd path unit) fetches, builds, migrates, switches and rolls back.
 */
export const CHANNELS = ["production", "test"] as const;
export type Channel = (typeof CHANNELS)[number];

export type RemoteRelease = { channel: Channel; version: string; commit: string; date: string; message: string };

export type UpdateStatus = {
  state: "idle" | "queued" | "fetching" | "building" | "backup" | "installing" | "completed" | "failed" | "rolling-back" | "rolled-back";
  message: string;
  fromVersion?: string;
  toVersion?: string;
  fromCommit?: string;
  toCommit?: string;
  channel?: string;
  startedAt?: string;
  updatedAt?: string;
};

export function currentChannel(): Channel {
  const b = buildInfo().branch;
  return (CHANNELS as readonly string[]).includes(b) ? (b as Channel) : "production";
}

async function github(path: string, accept = "application/vnd.github+json"): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept, "User-Agent": "network-simulator-updater", "X-GitHub-Api-Version": "2022-11-28" };
  if (config.updateToken) headers.Authorization = `Bearer ${config.updateToken}`;
  const res = await fetch(`https://api.github.com/repos/${config.updateRepo}/${path}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) throw new Error("updates.repoNotFound");
  if (!res.ok) throw new Error(`updates.github:${res.status}`);
  return res;
}

export async function latestRelease(channel: Channel): Promise<RemoteRelease> {
  const commit = (await (await github(`commits/${channel}`)).json()) as {
    sha: string;
    commit: { message: string; committer: { date: string } };
  };
  const pkg = JSON.parse(await (await github(`contents/package.json?ref=${commit.sha}`, "application/vnd.github.raw+json")).text()) as {
    version: string;
  };
  return {
    channel,
    version: pkg.version,
    commit: commit.sha,
    date: commit.commit.committer.date,
    message: commit.commit.message.split("\n")[0] ?? "",
  };
}

export async function checkForUpdates(channel: Channel) {
  const current = buildInfo();
  const latest = await latestRelease(channel);
  return {
    current,
    latest,
    updateAvailable: latest.commit !== current.commit,
    channelChange: channel !== currentChannel(),
  };
}

const requestFile = () => join(config.dataDir, "update", "request.json");

/** Asks the privileged helper to install a commit of a channel. Only the branch and the commit id are passed. */
export async function requestUpdate(channel: Channel, commit: string, requestedBy: string): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("updates.invalidCommit");
  const status = await updateStatus();
  if (["queued", "fetching", "building", "backup", "installing", "rolling-back"].includes(status.state)) throw new Error("updates.running");
  await mkdir(join(config.dataDir, "update"), { recursive: true });
  const tmp = requestFile() + ".tmp";
  await writeFile(tmp, JSON.stringify({ channel, commit, requestedBy, requestedAt: new Date().toISOString() }));
  await rename(tmp, requestFile());
}

export async function updateStatus(): Promise<UpdateStatus> {
  let s: UpdateStatus = { state: "idle", message: "" };
  try {
    s = JSON.parse(await readFile(config.updateStatusFile, "utf8")) as UpdateStatus;
  } catch {
    // no update has run yet
  }
  // A request that the helper has not picked up yet.
  try {
    await readFile(requestFile());
    if (!["fetching", "building", "backup", "installing", "rolling-back"].includes(s.state)) s = { ...s, state: "queued", message: "" };
  } catch {
    // no pending request
  }
  return s;
}
