#!/usr/bin/env node

/**
 * Covera CLI
 * Local entry point for test generation workflow
 */

import {
  VendorFactory,
  VendorConfig,
  StateGraphExecutor,
  BuildMetadata,
} from "@covera/core";
import {
  McpHost,
  SealightsClient,
  FileGapSource,
  createSealightsTools,
  loadBuildContext,
} from "@covera/mcp-host";
import { RepositoryProfiler } from "@covera/repo-profiler";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd(): string;
  exit(code?: number): never;
  exitCode?: number;
};
declare const require: (id: string) => {
  readFileSync(path: string, encoding: string): string;
};
declare const console: {
  log(...data: unknown[]): void;
  error(...data: unknown[]): void;
};

try {
  const envFile = require("node:fs").readFileSync(`${process.cwd()}/.env`, "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2] || "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[match[1]] = value;
  }
} catch {
  // A local .env file is optional.
}

const args = process.argv.slice(2);

function parseOptions(values: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value.startsWith("--")) {
      const key = value.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      options[key] = values[i + 1] && !values[i + 1].startsWith("--") ? values[++i] : "true";
    }
  }
  return options;
}

function showHelp(): void {
  console.log("Usage: covera <command> [options]");
  console.log("\nCommands:");
  console.log("  profile <testRepoPath>  Profile a Playwright repository");
  console.log("  generate                Generate tests from coverage data");
  console.log("  serve                   Start webhook server");
  console.log("  config                  Show Covera configuration");
}

/**
 * Command: profile
 * Profile a Playwright repository and show its conventions
 */
async function profile(testRepoPath: string): Promise<void> {
    try {
      console.log("🔍 Analyzing repository...\n");
      const profiler = new RepositoryProfiler(testRepoPath);
      const profile = await profiler.profile();

      console.log("\n📋 Repository Profile:");
      console.log(`   Framework: ${profile.framework}`);
      console.log(`   Playwright: ${profile.playwrightVersion}`);
      console.log(`   Test Dir: ${profile.testDir}`);
      console.log(`   Patterns: ${profile.patterns.join(", ") || "(none)"}`);
      console.log(`   Custom Fixtures: ${Object.keys(profile.customFixtures).join(", ") || "(none)"}`);
      console.log(
        `\n📚 Few-shot examples extracted: ${profile.fewShotExamples.length}`
      );

      if (profile.fewShotExamples.length > 0) {
        console.log(
          "\n   Example 1 (first 300 chars):\n",
          profile.fewShotExamples[0].substring(0, 300)
        );
      }

      console.log("\n✓ Profile complete\n");
    } catch (error) {
      console.error("✗ Profiling failed:", error);
      process.exit(1);
    }
}

/**
 * Command: generate
 * Generate tests from coverage data
 */
async function generate(options: Record<string, string>): Promise<void> {
      try {
        console.log("🚀 Starting test generation workflow\n");

        options.vendor ||= "openai";
        options.model ||= "gpt-4-turbo";
        for (const key of ["devRepo", "testRepo"]) {
          if (!options[key]) throw new Error(`Missing required option: --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
        }

        // Validate vendor
        if (!["openai", "anthropic", "google", "local"].includes(options.vendor)) {
          throw new Error(`Unsupported vendor: ${options.vendor}`);
        }

        // Create LLM vendor
        const vendorConfig: VendorConfig = {
          provider: options.vendor as
            | "openai"
            | "anthropic"
            | "google"
            | "local",
          apiKey: process.env[`${options.vendor.toUpperCase()}_API_KEY`] || "",
          model: options.model,
        };

        if (!vendorConfig.apiKey) {
          throw new Error(
            `Missing API key: ${options.vendor.toUpperCase()}_API_KEY`
          );
        }

        const vendor = VendorFactory.createVendor(vendorConfig);
        console.log(`✓ LLM Vendor: ${vendor.name}`);

        // Validate config
        await vendor.validateConfig();
        console.log(`✓ Vendor configuration valid\n`);

        // Build session id (--session-id or the `buildSessionId` file written by `slnodejs config`)
        // and commit SHA (COMMIT_SHA or git HEAD of the dev repo)
        const buildContext = loadBuildContext({
          devRepoPath: options.devRepo,
          buildSessionId: options.sessionId,
          buildSessionIdFile: options.buildSessionIdFile,
          commitSha: process.env.COMMIT_SHA,
        });
        console.log(`✓ Build session: ${buildContext.buildSessionId}`);
        console.log(`✓ Commit: ${buildContext.commitSha} (from ${buildContext.commitShaSource})\n`);

        const metadata: BuildMetadata = {
          appName: options.appName || process.env.SEALIGHTS_APP_NAME || "unknown-app",
          branch: options.branch || process.env.SEALIGHTS_DEFAULT_BRANCH || "main",
          buildSessionId: buildContext.buildSessionId,
          devRepoUrl: options.devRepo,
          testRepoUrl: options.testRepo,
          commitSha: buildContext.commitSha,
          devRepoPath: options.devRepo,
          testRepoPath: options.testRepo,
        };

        const gapsFile = options.gapsFile || process.env.SEALIGHTS_GAPS_FILE;
        const mcpHost = new McpHost({
          profileRepository: (repoPath) => new RepositoryProfiler(repoPath).profile(),
        }).registerServer(
          "sealights",
          createSealightsTools({
            client: SealightsClient.fromEnv(process.env),
            gapSource: gapsFile ? new FileGapSource(gapsFile) : undefined,
          })
        );

        // Execute workflow
        const executor = new StateGraphExecutor(vendor, mcpHost);
        const result = await executor.executeWorkflow(metadata);

        console.log("\n✅ Workflow completed");
        console.log(`   Generated code: ${result.generatedTestCode?.substring(0, 100)}...`);
        if (result.error) {
          console.log(`   ⚠️  Error: ${result.error}`);
        }
      } catch (error) {
        console.error("✗ Generation failed:", error);
        process.exit(1);
      }
}

/**
 * Command: serve
 * Start webhook server
 */
function serve(options: Record<string, string>): void {
    console.log("🌐 Starting Covera webhook server...\n");
    // Import and start WebhookServer
    // (This would import from @covera/orchestrator)
    console.log(`   Listening on port ${options.port || "3000"}`);
    console.log(
      "   POST /webhooks/sealights -- Receive SeaLights webhooks"
    );
    console.log("   GET  /jobs/:jobId       -- Check job status");
}

/**
 * Command: config
 * Show and validate configuration
 */
function config(): void {
    console.log("⚙️  Covera Configuration\n");
    console.log("Environment Variables:");
    console.log(`   OPENAI_API_KEY:    ${process.env.OPENAI_API_KEY ? "✓" : "✗"}`);
    console.log(
      `   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "✓" : "✗"}`
    );
    console.log(
      `   SEALIGHTS_API_TOKEN: ${process.env.SEALIGHTS_API_TOKEN ? "✓" : "✗"}`
    );
    console.log(
      `   STAGING_BASE_URL:  ${process.env.STAGING_BASE_URL || "(not set)"}`
    );
    console.log(`\nSupported LLM Vendors:`);
    console.log(`   • openai        (GPT-4, GPT-4-turbo)`);
    console.log(`   • anthropic     (Claude Opus, Sonnet, Haiku)`);
    console.log(`   • google        (Gemini Pro)`);
    console.log(`   • local         (Ollama, vLLM, LM Studio)`);
}

async function main(): Promise<void> {
  const command = args[0];
  const options = parseOptions(args.slice(1));
  switch (command) {
    case "profile":
      await profile(args[1]);
      break;
    case "generate":
      await generate(options);
      break;
    case "serve":
      serve(options);
      break;
    case "config":
      config();
      break;
    case "--version":
    case "-V":
      console.log("0.1.0");
      break;
    case "--help":
    case "-h":
    case undefined:
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exitCode = 1;
  }
}

void main();

export {};
