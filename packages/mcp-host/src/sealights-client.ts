/**
 * Thin client for the SeaLights Public API (https://api-doc.sealights.io).
 *
 * Only endpoints verified against the official collection are used:
 *   GET /sl-api/v1/builds/:bsid            build metadata
 *   GET /sl-api/v1/coverage/builds/:bsid   coverage totals (percentages and counts)
 *
 * The public API does not list which methods/lines are uncovered; see gap-source.ts.
 */

type FileSystemModule = {
  readFileSync(path: string, encoding: "utf8"): string;
};

const readFileSync = (() => {
  let nodeRequire: ((id: string) => unknown) | undefined;
  try {
    nodeRequire = eval("require") as (id: string) => unknown;
  } catch {
    nodeRequire = undefined;
  }
  if (!nodeRequire) {
    throw new Error("Node.js require is unavailable");
  }
  const fs = nodeRequire("fs") as FileSystemModule;
  return fs.readFileSync.bind(fs);
})();

export interface CoverageDetails {
  method: number | null;
  branch?: number | null;
  line?: number | null;
}

export interface CoverageSummary {
  isHighPriority: boolean;
  qrs: CoverageDetails;
  /** Percentages (0-100) */
  overallCoverage: CoverageDetails;
  /** Absolute counts of code elements */
  overallTotals: CoverageDetails;
  modifiedCodeCoverage: CoverageDetails;
  modifiedTotals: CoverageDetails;
}

export interface SealightsBuildCoverage {
  bsid: string;
  entireBuild: CoverageSummary;
  testStages?: Array<CoverageSummary & { name: string }>;
}

export interface SealightsBuildMetadata {
  appName: string;
  branchName: string;
  build: { bsid: string; name: string; generated: string; isIntegration: boolean };
  buildScanStatus: "In Progress" | "Completed";
  buildFailureMessage?: string;
  technology?: string;
}

export class SealightsApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: number
  ) {
    super(message);
    this.name = "SealightsApiError";
  }
}

export interface SealightsClientOptions {
  /** Tenant root, e.g. https://mycompany.sealights.co (no /api suffix) */
  baseUrl: string;
  token: string;
  fetchImpl?: SealightsFetch;
}

type SealightsFetch = (
  input: string,
  init: { headers: Record<string, string> }
) => Promise<{ text(): Promise<string>; ok: boolean; status: number }>;

export class SealightsClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: SealightsFetch;

  constructor(options: SealightsClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token.trim();
    this.fetchImpl = options.fetchImpl ?? (globalThis as unknown as { fetch: SealightsFetch }).fetch;
  }

  static fromEnv(env: Record<string, string | undefined>): SealightsClient {
    const token = readToken(env);
    const baseUrl = env.SEALIGHTS_API_URL || env.SEALIGHTS_DOMAIN || decodeJwtClaim(token, "x-sl-server");
    if (!baseUrl) {
      throw new Error(
        "Cannot determine the SeaLights domain: set SEALIGHTS_API_URL or use a token that carries the x-sl-server claim"
      );
    }
    return new SealightsClient({ baseUrl, token });
  }

  getBuildMetadata(bsid: string): Promise<SealightsBuildMetadata> {
    return this.get<SealightsBuildMetadata>(`/sl-api/v1/builds/${encodeURIComponent(bsid)}`);
  }

  getBuildCoverage(bsid: string, options: { withTestStages?: boolean } = {}): Promise<SealightsBuildCoverage> {
    const query = options.withTestStages ? "?withTestStages=true" : "";
    return this.get<SealightsBuildCoverage>(`/sl-api/v1/coverage/builds/${encodeURIComponent(bsid)}${query}`);
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    });

    const text = await response.text();
    let body: any;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      throw new SealightsApiError(response.status, `Non-JSON response from SeaLights (${response.status})`);
    }

    if (!response.ok) {
      const error = body?.error;
      throw new SealightsApiError(
        response.status,
        error?.message ?? `SeaLights request failed: ${response.status} ${path}`,
        error?.code
      );
    }

    // Successful responses are wrapped in { data }, but not every endpoint documents it that way
    return (body?.data ?? body) as T;
  }
}

/** Accepts https://host, https://host/ or https://host/api and returns https://host */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

export function readToken(env: Record<string, string | undefined>): string {
  if (env.SEALIGHTS_API_TOKEN) return env.SEALIGHTS_API_TOKEN.trim();
  if (env.SEALIGHTS_TOKEN_FILE) return readFileSync(env.SEALIGHTS_TOKEN_FILE, "utf8").trim();
  throw new Error("Missing SeaLights token: set SEALIGHTS_API_TOKEN or SEALIGHTS_TOKEN_FILE");
}

/** Reads a claim from a JWT payload without verifying it (same approach as the SeaLights demo project) */
export function decodeJwtClaim(token: string, claim: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const json = JSON.parse(
      decodeURIComponent(Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""))
    );
    const value = json[claim];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
function atob(padded: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (padded.length % 4 !== 0) {
    throw new Error("Invalid base64 string");
  }

  let decoded = "";
  for (let i = 0; i < padded.length; i += 4) {
    const chunk = padded.slice(i, i + 4);
    const a = alphabet.indexOf(chunk[0]);
    const b = alphabet.indexOf(chunk[1]);
    const c = chunk[2] === "=" ? 0 : alphabet.indexOf(chunk[2]);
    const d = chunk[3] === "=" ? 0 : alphabet.indexOf(chunk[3]);

    if (a < 0 || b < 0 || c < 0 || d < 0 || (chunk[2] === "=" && chunk[3] !== "=")) {
      throw new Error("Invalid base64 string");
    }

    decoded += String.fromCharCode((a << 2) | (b >> 4));
    if (chunk[2] !== "=") {
      decoded += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    }
    if (chunk[3] !== "=") {
      decoded += String.fromCharCode(((c & 3) << 6) | d);
    }
  }

  return decoded;
}

