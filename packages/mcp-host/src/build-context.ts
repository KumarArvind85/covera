/**
 * Build context: the buildSessionId and commitSha that identify what SeaLights scanned.
 *
 * Mirrors the sealights-integration-examples/playwright-browser-agent-otel demo:
 *  - `slnodejs config` writes the build session id to a file named `buildSessionId`
 *  - the demo scans with `--scm none`, so SeaLights never records a commit SHA.
 *    The SHA therefore comes from the dev repo's git HEAD (or COMMIT_SHA / the CI webhook).
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export interface BuildContext {
  buildSessionId: string;
  commitSha: string;
  commitShaSource: "explicit" | "git";
  appName?: string;
  branch?: string;
}

export interface BuildContextInput {
  /** Dev repo (or demo app) folder that was scanned */
  devRepoPath: string;
  buildSessionId?: string;
  /** Defaults to <devRepoPath>/buildSessionId, the file written by `slnodejs config` */
  buildSessionIdFile?: string;
  /** Overrides git detection (e.g. COMMIT_SHA from CI) */
  commitSha?: string;
  appName?: string;
  branch?: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function readBuildSessionIdFile(path: string): string {
  const bsid = readFileSync(path, "utf8").trim();
  if (!bsid) throw new Error(`Build session id file is empty: ${path}`);
  return bsid;
}

export function resolveCommitSha(repoPath: string): string {
  let sha: string;
  try {
    sha = execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(
      `Cannot read the commit SHA from git in ${repoPath}. Pass commitSha explicitly or set COMMIT_SHA. ${
        error instanceof Error ? error.message : error
      }`
    );
  }
  if (!SHA_PATTERN.test(sha)) throw new Error(`Unexpected git HEAD value: ${sha}`);
  return sha;
}

export function loadBuildContext(input: BuildContextInput): BuildContext {
  const buildSessionId =
    input.buildSessionId?.trim() ||
    readBuildSessionIdFile(input.buildSessionIdFile ?? join(input.devRepoPath, "buildSessionId"));

  if (input.commitSha) {
    if (!SHA_PATTERN.test(input.commitSha)) {
      throw new Error(`commitSha must be a full 40-character SHA, got: ${input.commitSha}`);
    }
    return { buildSessionId, commitSha: input.commitSha, commitShaSource: "explicit", appName: input.appName, branch: input.branch };
  }

  return {
    buildSessionId,
    commitSha: resolveCommitSha(input.devRepoPath),
    commitShaSource: "git",
    appName: input.appName,
    branch: input.branch,
  };
}
