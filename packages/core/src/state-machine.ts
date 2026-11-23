/**
 * Layer 2: State Machine Definition (5-Node LangGraph)
 * 
 * This orchestrates the entire test generation workflow deterministically,
 * independent of which LLM vendor is being used.
 */

import { ILLMVendor, LLMResponse, MCPTool, ToolCall, ToolExecutionResult } from "./llm-vendor-interface";

/**
 * State passed between all nodes in the workflow
 */
export interface WorkflowState {
  buildMetadata: BuildMetadata;
  uncoveredGaps: CoverageGap[];
  codeSlices: CodeSlice[];
  repoProfile: RepositoryProfile;
  stagingUIExploration?: UIExplorationResult;
  generatedTestCode?: string;
  verificationResult?: VerificationResult;
  error?: string;
  retryCount: number;
  mcpToolResults: Map<string, ToolExecutionResult>;
}

export interface BuildMetadata {
  appName: string;
  branch: string;
  buildSessionId: string;
  devRepoUrl: string;
  testRepoUrl: string;
  commitSha: string;
  devRepoPath: string;
  testRepoPath: string;
}

export interface CoverageGap {
  methodSignature: string;
  filePath: string;
  uncoveredLines: number[];
  branchCoverage: number;
  relatedComponents: string[];
}

export interface CodeSlice {
  methodSignature: string;
  code: string;
  relatedComponentCode?: string;
  routeDefinition?: string;
  apiEndpoint?: string;
}

export interface RepositoryProfile {
  framework: "typescript" | "javascript";
  playwrightVersion: string;
  testDir: string;
  pageObjectDir?: string;
  fixturesDir?: string;
  customFixtures: Record<string, string>;
  patterns: string[];
  eslintConfig?: Record<string, unknown>;
  fewShotExamples: string[];
  importConventions: Record<string, string>;
}

export interface UIExplorationResult {
  screenshots: string[];
  domStructure: string;
  networkLog: NetworkInteraction[];
  interactiveElements: InteractiveElement[];
}

export interface NetworkInteraction {
  method: string;
  url: string;
  status: number;
  responseTime: number;
}

export interface InteractiveElement {
  selector: string;
  type: string;
  label?: string;
  ariaLabel?: string;
}

export interface VerificationResult {
  passed: boolean;
  lintErrors: string[];
  typeErrors: string[];
  testExecutionResult: TestExecutionResult;
  coverageDelta?: CoverageDeltaResult;
}

export interface TestExecutionResult {
  passed: boolean;
  durationMs: number;
  failureMessage?: string;
  playwrightTrace?: string;
  screenshots: string[];
  flakeRate?: number;
}

export interface CoverageDeltaResult {
  status: "NEWLY_COVERED" | "PARTIAL" | "NOT_COVERED";
  coveragePercentage: number;
  details: string;
}

/**
 * State Machine Executor
 * Orchestrates the 5-node workflow with tool execution and retry logic
 */
export class StateGraphExecutor {
  private llmVendor: ILLMVendor;
  private mcpHost: IMCPHost;
  private retryPolicy: RetryPolicy;

  constructor(
    llmVendor: ILLMVendor,
    mcpHost: IMCPHost,
    retryPolicy: RetryPolicy = defaultRetryPolicy
  ) {
    this.llmVendor = llmVendor;
    this.mcpHost = mcpHost;
    this.retryPolicy = retryPolicy;
  }

  /**
   * Execute the complete 5-node workflow
   */
  async executeWorkflow(metadata: BuildMetadata): Promise<WorkflowState> {
    let state: WorkflowState = {
      buildMetadata: metadata,
      uncoveredGaps: [],
      codeSlices: [],
      repoProfile: {} as RepositoryProfile,
      retryCount: 0,
      mcpToolResults: new Map(),
    };

    try {
      // Node 1: Fetch coverage gaps from SeaLights
      (globalThis as typeof globalThis & {
        console?: { log: (...data: unknown[]) => void };
      }).console?.log("→ [Node 1] Fetching coverage gaps from SeaLights...");
      state = await this.fetchGaps(state);

      if (!state.uncoveredGaps.length) {
        (globalThis as typeof globalThis & {
          console?: { log: (...data: unknown[]) => void };
        }).console?.log("✓ No coverage gaps found; workflow complete");
        return state;
      }

      // Node 2: Map code to entry points
      (globalThis as typeof globalThis & {
        console?: { log: (...data: unknown[]) => void };
      }).console?.log("→ [Node 2] Mapping code to entry points...");
      state = await this.mapCodeToEntrypoints(state);

      // Node 3: Explore staging UI (optional, can enhance prompts)
      (globalThis as typeof globalThis & {
        console?: { log: (...data: unknown[]) => void };
      }).console?.log("→ [Node 3] Exploring staging UI...");
      state = await this.exploreStagingUI(state);

      // Node 4: Synthesize test code
      (globalThis as typeof globalThis & {
        console?: { log: (...data: unknown[]) => void };
      }).console?.log("→ [Node 4] Synthesizing test code...");
      state = await this.synthesizeCode(state);

      // Node 5: Verify and heal
      (globalThis as typeof globalThis & {
        console?: { log: (...data: unknown[]) => void };
      }).console?.log("→ [Node 5] Verifying and healing generated tests...");
      state = await this.verifyAndHeal(state);

      (globalThis as typeof globalThis & {
        console?: { log: (...data: unknown[]) => void };
      }).console?.log("✓ Workflow completed successfully");
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      (globalThis as typeof globalThis & {
        console?: { error: (...data: unknown[]) => void };
      }).console?.error(`✗ Workflow failed: ${state.error}`);
    }

    return state;
  }

  /**
   * Node 1: Fetch Gaps
   * Deterministic MCP call to SeaLights API
   */
  private async fetchGaps(state: WorkflowState): Promise<WorkflowState> {
    const result = await this.mcpHost.executeTool("sealights", {
      toolName: "query_coverage_gaps",
      input: {
        buildSessionId: state.buildMetadata.buildSessionId,
        commitSha: state.buildMetadata.commitSha,
        appName: state.buildMetadata.appName,
        branch: state.buildMetadata.branch,
      },
    });

    if (result.isError) {
      throw new Error(`SeaLights API error: ${result.content}`);
    }

    const gaps: unknown = JSON.parse(result.content);
    if (!Array.isArray(gaps)) {
      throw new Error("SeaLights query_coverage_gaps must return an array of coverage gaps");
    }
    state.uncoveredGaps = gaps;
    state.mcpToolResults.set("fetch_gaps", result);
    return state;
  }

  /**
   * Node 2: Map Code to Entry Points
   * Uses static analysis (MCP call) + light LLM reasoning
   */
  private async mapCodeToEntrypoints(
    state: WorkflowState
  ): Promise<WorkflowState> {
    for (const gap of state.uncoveredGaps.slice(0, 3)) {
      // Process top 3 gaps only
      const result = await this.mcpHost.executeTool("codebase", {
        toolName: "trace_code_path",
        input: {
          methodSignature: gap.methodSignature,
          filePath: gap.filePath,
          repoPath: state.buildMetadata.devRepoPath,
        },
      });

      if (!result.isError) {
        state.codeSlices.push(JSON.parse(result.content));
      }
    }

    return state;
  }

  /**
   * Node 3: Explore Staging UI
   * Uses Playwright MCP to understand the UI
   */
  private async exploreStagingUI(
    state: WorkflowState
  ): Promise<WorkflowState> {
    if (!state.codeSlices.length) {
      (globalThis as typeof globalThis & {
        console?: { log: (...data: unknown[]) => void };
      }).console?.log("  (Skipping UI exploration: no code slices)");
      return state;
    }

    const env = (globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }).process?.env;

    const result = await this.mcpHost.executeTool("playwright", {
      toolName: "explore_staging_app",
      input: {
        appUrl: env?.STAGING_BASE_URL || "https://staging.app",
        authToken: env?.STAGING_AUTH_TOKEN,
        maxScreenshots: 5,
      },
    });

    if (!result.isError) {
      state.stagingUIExploration = JSON.parse(result.content);
    }

    return state;
  }

  /**
   * Node 4: Synthesize Code
   * Uses LLM with repo conventions as few-shot examples
   */
  private async synthesizeCode(state: WorkflowState): Promise<WorkflowState> {
    // First, profile the test repository
    state.repoProfile = await this.mcpHost.profileRepository(
      state.buildMetadata.testRepoPath
    );

    const systemPrompt = this.buildSystemPrompt(state);
    const userMessage = this.buildUserMessage(state);

    // Call LLM for code synthesis
    const response = await this.llmVendor.call({
      model:
        (globalThis as typeof globalThis & {
          process?: { env?: Record<string, string | undefined> };
        }).process?.env?.LLM_MODEL || "gpt-4-turbo",
      systemPrompt,
      userMessage,
      temperature: 0.1, // Low temperature for deterministic code generation
      maxTokens: 2048,
    });

    if (response.toolCalls && response.toolCalls.length > 0) {
      // LLM wants to call tools; execute them
      for (const toolCall of response.toolCalls) {
        const result = await this.mcpHost.executeTool("codebase", {
          toolName: toolCall.toolName,
          input: toolCall.input,
        });
        state.mcpToolResults.set(toolCall.toolUseId, result);
      }

      // Re-call LLM with tool results for grounding
      return this.synthesizeCode(state); // Recursive for multi-turn reasoning
    }

    // Extract code from LLM response
    state.generatedTestCode = this.extractCodeFromResponse(response.content);
    return state;
  }

  /**
   * Node 5: Verify and Heal
   * Three quality gates with bounded retry loop
   */
  private async verifyAndHeal(state: WorkflowState): Promise<WorkflowState> {
    if (!state.generatedTestCode) {
      throw new Error("No test code generated");
    }

    state.verificationResult = {
      passed: false,
      lintErrors: [],
      typeErrors: [],
      testExecutionResult: { passed: false, durationMs: 0, screenshots: [] },
    };

    // Gate 1: Lint & Type Check
    (globalThis as typeof globalThis & {
      console?: { log: (...data: unknown[]) => void };
    }).console?.log("  Gate 1: Running linter and type checker...");
    const lintResult = await this.mcpHost.executeTool("codebase", {
      toolName: "lint_and_typecheck",
      input: { code: state.generatedTestCode },
    });

    if (!lintResult.isError) {
      const lintData = JSON.parse(lintResult.content);
      state.verificationResult!.lintErrors = lintData.lintErrors || [];
      state.verificationResult!.typeErrors = lintData.typeErrors || [];
    }

    if (
      (state.verificationResult?.lintErrors.length ?? 0) > 0 ||
      (state.verificationResult?.typeErrors.length ?? 0) > 0
    ) {
      (globalThis as typeof globalThis & {
        console?: { log: (...data: unknown[]) => void };
      }).console?.log("  Gate 1 FAILED: Fixing syntax errors...");
      state = await this.healCodeSyntax(state);
    }

    // Gate 2: Execute & Flake Check
    (globalThis as typeof globalThis & {
      console?: { log: (...data: unknown[]) => void };
    }).console?.log("  Gate 2: Running tests (2x for flake detection)...");
    const execResult = await this.mcpHost.executeTool("playwright", {
      toolName: "run_tests",
      input: {
        code: state.generatedTestCode,
        stagingEnv: true,
        repeatEach: 2,
        captureTrace: true,
      },
    });

    state.verificationResult!.testExecutionResult = JSON.parse(execResult.content);

    if (!state.verificationResult!.testExecutionResult.passed) {
      (globalThis as typeof globalThis & {
        console?: { log: (...data: unknown[]) => void };
      }).console?.log("  Gate 2 FAILED: Healing test failures...");
      state = await this.healTestFailures(state);
    }

    // Gate 3: Coverage Delta (Optional)
    if (
      (globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
      }).process?.env?.VERIFY_COVERAGE_DELTA === "true"
    ) {
      (globalThis as typeof globalThis & {
        console?: { log: (...data: unknown[]) => void };
      }).console?.log("  Gate 3: Verifying coverage delta with SeaLights...");
      const coverageResult = await this.mcpHost.executeTool("sealights", {
        toolName: "verify_coverage_delta",
        input: {
          testCode: state.generatedTestCode,
          targetMethod: state.codeSlices[0]?.methodSignature,
          buildSessionId: state.buildMetadata.buildSessionId,
        },
      });

      if (!coverageResult.isError) {
        state.verificationResult!.coverageDelta = JSON.parse(
          coverageResult.content
        );
      }
    }

    state.verificationResult!.passed = state.verificationResult!.testExecutionResult.passed;
    return state;
  }

  /**
   * Healing function for syntax/type errors
   */
  private async healCodeSyntax(state: WorkflowState): Promise<WorkflowState> {
    const errors = [
      ...state.verificationResult!.lintErrors,
      ...state.verificationResult!.typeErrors,
    ].join("\n");

    const healPrompt = `The generated test has these errors:\n\n${errors}\n\nFix them while maintaining the test logic and coverage intent.`;

    const response = await this.llmVendor.call({
      model: "gpt-4-turbo",
      systemPrompt:
        "You are a TypeScript/JavaScript test expert. Fix syntax and type errors.",
      userMessage: healPrompt,
      temperature: 0.1,
      maxTokens: 2048,
    });

    state.generatedTestCode = this.extractCodeFromResponse(response.content);
    state.retryCount++;

    if (state.retryCount < this.retryPolicy.maxSyntaxRetries) {
      // Re-run lint check
      return this.verifyAndHeal(state);
    }

    return state;
  }

  /**
   * Healing function for test execution failures
   */
  private async healTestFailures(state: WorkflowState): Promise<WorkflowState> {
    const failure = state.verificationResult!.testExecutionResult;
    const trace = failure.playwrightTrace || "No trace available";

    const healPrompt = `The test failed with:
${failure.failureMessage}

Playwright trace:
${trace}

DOM structure from exploration:
${state.stagingUIExploration?.domStructure || "Not available"}

Fix the test to handle the actual UI behavior.`;

    const response = await this.llmVendor.call({
      model:
        (globalThis as typeof globalThis & {
          process?: { env?: Record<string, string | undefined> };
        }).process?.env?.LLM_MODEL || "gpt-4-turbo",
      systemPrompt:
        "You are a Playwright testing expert. Fix test failures by adjusting selectors, waits, and interactions.",
      userMessage: healPrompt,
      temperature: 0.1,
      maxTokens: 2048,
    });

    state.generatedTestCode = this.extractCodeFromResponse(response.content);
    state.retryCount++;

    if (state.retryCount < this.retryPolicy.maxExecutionRetries) {
      // Re-run execution
      return this.verifyAndHeal(state);
    }

    return state;
  }

  private buildSystemPrompt(state: WorkflowState): string {
    return `You are a Playwright test expert generating tests for a ${state.repoProfile.framework} project.

This repository uses these patterns:
- Framework: ${state.repoProfile.framework}
- Playwright Version: ${state.repoProfile.playwrightVersion}
- Test Directory: ${state.repoProfile.testDir}
- Custom Fixtures: ${Object.keys(state.repoProfile.customFixtures).join(", ")}

Follow these conventions exactly:
${state.repoProfile.fewShotExamples.slice(0, 2).map((ex) => `\n${ex}\n`).join("")}

Generate tests that:
1. Use correct imports and fixtures
2. Follow naming conventions
3. Use the exact assertion style shown
4. Are isolated and don't flake
5. Cover the specified code paths`;
  }

  private buildUserMessage(state: WorkflowState): string {
    const gap = state.uncoveredGaps[0];
    const slice = state.codeSlices[0];

    return `Generate a Playwright test that covers this uncovered code:

Method: ${gap.methodSignature}
File: ${gap.filePath}
Uncovered lines: ${gap.uncoveredLines.join(", ")}

Code context:
\`\`\`
${slice.code}
\`\`\`

Related component code:
\`\`\`
${slice.relatedComponentCode || "Not available"}
\`\`\`

UI structure from staging:
${state.stagingUIExploration?.domStructure || "Not explored"}

Generate a complete, working test file.`;
  }

  private extractCodeFromResponse(response: string): string {
    // Extract TypeScript/JavaScript code blocks from LLM response
    const codeBlockMatch = response.match(/```(?:typescript|javascript|ts|js)?\n([\s\S]*?)\n```/);
    return codeBlockMatch ? codeBlockMatch[1] : response;
  }
}

/**
 * MCP Host Interface
 * Abstracts interaction with MCP servers (SeaLights, Playwright, Codebase)
 */
export interface IMCPHost {
  executeTool(
    serverName: string,
    request: { toolName: string; input: Record<string, unknown> }
  ): Promise<ToolExecutionResult>;

  profileRepository(repoPath: string): Promise<RepositoryProfile>;
}

export interface RetryPolicy {
  maxSyntaxRetries: number;
  maxExecutionRetries: number;
  maxCoverageRetries: number;
}

const defaultRetryPolicy: RetryPolicy = {
  maxSyntaxRetries: 2,
  maxExecutionRetries: 3,
  maxCoverageRetries: 1,
};

export { defaultRetryPolicy };
