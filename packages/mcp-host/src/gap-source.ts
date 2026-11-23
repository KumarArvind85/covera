/**
 * Gap sources: where method/line-level coverage gaps come from.
 *
 * The SeaLights Public API only exposes coverage totals, not the list of uncovered
 * methods, so the source of that list is pluggable. Implement GapSource for a
 * method-level SeaLights endpoint (or an lcov/Istanbul export) and pass it to
 * createSealightsTools.
 */

import { readFileSync } from "node:fs";
import type { CoverageGap } from "@covera/core";
import type { BuildContext } from "./build-context";

export interface GapSource {
  readonly name: string;
  getGaps(context: BuildContext): Promise<CoverageGap[]>;
}

export class MethodLevelGapsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MethodLevelGapsUnavailableError";
  }
}

/** Reads a JSON array of CoverageGap objects, e.g. produced from a SeaLights export */
export class FileGapSource implements GapSource {
  readonly name = "file";

  constructor(private readonly path: string) {}

  async getGaps(): Promise<CoverageGap[]> {
    const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error(`Gap file must contain a JSON array: ${this.path}`);
    }
    return parsed.map((entry, index) => toCoverageGap(entry, index, this.path));
  }
}

function toCoverageGap(entry: any, index: number, path: string): CoverageGap {
  if (!entry || typeof entry.methodSignature !== "string" || typeof entry.filePath !== "string") {
    throw new Error(`Invalid gap at index ${index} in ${path}: methodSignature and filePath are required strings`);
  }
  return {
    methodSignature: entry.methodSignature,
    filePath: entry.filePath,
    uncoveredLines: Array.isArray(entry.uncoveredLines) ? entry.uncoveredLines : [],
    branchCoverage: typeof entry.branchCoverage === "number" ? entry.branchCoverage : 0,
    relatedComponents: Array.isArray(entry.relatedComponents) ? entry.relatedComponents : [],
  };
}
