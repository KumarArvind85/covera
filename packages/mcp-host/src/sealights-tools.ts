import type { CoverageGap } from "@covera/core";
import type { BuildContext } from "./build-context";
import { GapSource, MethodLevelGapsUnavailableError } from "./gap-source";
import { CoverageSummary, SealightsClient } from "./sealights-client";
import type { ToolHandler } from "./mcp-host";

export interface SealightsToolsOptions {
  client: SealightsClient;
  /** Provider of method/line-level gaps. Without one, builds with uncovered code fail loudly. */
  gapSource?: GapSource;
}

export function createSealightsTools(options: SealightsToolsOptions): Record<string, ToolHandler> {
  return {
    query_coverage_gaps: (input) => queryCoverageGaps(options, input),
  };
}

async function queryCoverageGaps(
  { client, gapSource }: SealightsToolsOptions,
  input: Record<string, unknown>
): Promise<CoverageGap[]> {
  const context = toBuildContext(input);

  // Validates the BSID and makes sure the build scan finished before trusting its coverage
  const metadata = await client.getBuildMetadata(context.buildSessionId);
  if (metadata.buildScanStatus !== "Completed") {
    throw new Error(
      `SeaLights build ${context.buildSessionId} is "${metadata.buildScanStatus}"` +
        (metadata.buildFailureMessage ? `: ${metadata.buildFailureMessage}` : "")
    );
  }

  const coverage = await client.getBuildCoverage(context.buildSessionId, { withTestStages: true });
  const summary = coverage.entireBuild;

  if (summary.overallCoverage.method === 100) return [];

  if (!gapSource) {
    throw new MethodLevelGapsUnavailableError(describeMissingGapSource(context, summary));
  }
  return gapSource.getGaps(context);
}

function toBuildContext(input: Record<string, unknown>): BuildContext {
  const buildSessionId = input.buildSessionId;
  const commitSha = input.commitSha;
  if (typeof buildSessionId !== "string" || !buildSessionId) throw new Error("buildSessionId is required");
  if (typeof commitSha !== "string" || !commitSha) throw new Error("commitSha is required");
  return {
    buildSessionId,
    commitSha,
    commitShaSource: "explicit",
    appName: typeof input.appName === "string" ? input.appName : undefined,
    branch: typeof input.branch === "string" ? input.branch : undefined,
  };
}

function describeMissingGapSource(context: BuildContext, summary: CoverageSummary): string {
  const percent = summary.overallCoverage.method;
  const total = summary.overallTotals.method;
  const uncovered =
    typeof percent === "number" && typeof total === "number" ? Math.round(total * (1 - percent / 100)) : "unknown";
  return (
    `SeaLights reports ${percent ?? "unknown"}% method coverage for build ${context.buildSessionId} ` +
    `(${uncovered} of ${total ?? "unknown"} methods uncovered), but the SeaLights Public API does not list which ` +
    `methods are uncovered. Configure a gap source (for example SEALIGHTS_GAPS_FILE) to provide them.`
  );
}
