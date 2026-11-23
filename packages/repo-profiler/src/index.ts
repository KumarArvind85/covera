/**
 * Layer 3: Repository Profiler
 * 
 * Auto-detects Playwright framework patterns, extracts few-shot examples,
 * and generates dynamic prompts tailored to the customer's repo conventions.
 */

// @ts-ignore Node built-in types are provided by the runtime environment.
import * as fs from "fs";
// @ts-ignore Node built-in types are provided by the runtime environment.
import * as path from "path";

export interface RepositoryProfile {
  framework: "typescript" | "javascript";
  playwrightVersion: string;
  testDir: string;
  pageObjectDir?: string;
  fixturesDir?: string;
  customFixtures: Record<string, string>;
  patterns: string[]; // e.g., ["POM", "BDD", "nested-describe"]
  eslintConfig?: Record<string, unknown>;
  fewShotExamples: string[];
  importConventions: Record<string, string>;
}

/**
 * Repository Profiler
 * Fingerprints a Playwright test repository and extracts conventions
 */
export class RepositoryProfiler {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /**
   * Profile a Playwright repository
   */
  async profile(): Promise<RepositoryProfile> {
    // Avoid relying on the DOM console type in this package.

    // Step 1: Framework fingerprinting
    const framework = this.detectFramework();
    const playwrightVersion = this.detectPlaywrightVersion();
    const { testDir, pageObjectDir, fixturesDir } = this.detectDirectories();
    const customFixtures = this.extractCustomFixtures(fixturesDir);

    // Step 2: Extract few-shot examples
    const fewShotExamples = this.extractFewShotExamples(testDir);

    // Step 3: Detect patterns
    const patterns = this.detectPatterns(testDir);

    // Step 4: Extract import conventions
    const importConventions = this.extractImportConventions(fewShotExamples);

    // Step 5: ESLint config
    const eslintConfig = this.loadESLintConfig();

    const profile: RepositoryProfile = {
      framework,
      playwrightVersion,
      testDir,
      pageObjectDir,
      fixturesDir,
      customFixtures,
      patterns,
      fewShotExamples,
      eslintConfig,
      importConventions,
    };

    return profile;
  }

  private detectFramework(): "typescript" | "javascript" {
    const tsconfigPath = path.join(this.repoPath, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      return "typescript";
    }
    return "javascript";
  }

  private detectPlaywrightVersion(): string {
    const packageJsonPath = path.join(this.repoPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf-8")
      ) as { devDependencies?: Record<string, string> };
      return packageJson.devDependencies?.["@playwright/test"] || "latest";
    }
    return "unknown";
  }

  private detectDirectories(): {
    testDir: string;
    pageObjectDir?: string;
    fixturesDir?: string;
  } {
    // Common Playwright test directory patterns
    const candidates = ["tests", "e2e", "test", "spec", "playwright"];
    let testDir = "tests";

    for (const candidate of candidates) {
      if (fs.existsSync(path.join(this.repoPath, candidate))) {
        testDir = candidate;
        break;
      }
    }

    // Look for page objects and fixtures
    const pageObjectDir = this.findDir(["pages", "page-objects", "pageobjects"]);
    const fixturesDir = this.findDir(["fixtures", "helpers"]);

    return { testDir, pageObjectDir, fixturesDir };
  }

  private findDir(candidates: string[]): string | undefined {
    for (const candidate of candidates) {
      const fullPath = path.join(this.repoPath, candidate);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    return undefined;
  }

  private extractCustomFixtures(fixturesDir?: string): Record<string, string> {
    const fixtures: Record<string, string> = {};

    if (!fixturesDir || !fs.existsSync(fixturesDir)) {
      return fixtures;
    }

    const files = fs.readdirSync(fixturesDir);
    for (const file of files) {
      if (file.endsWith(".ts") || file.endsWith(".js")) {
        const fixtureName = path.basename(file, path.extname(file));
        fixtures[fixtureName] = path.join(fixturesDir, file);
      }
    }

    return fixtures;
  }

  private extractFewShotExamples(testDir: string): string[] {
    const examples: string[] = [];

    if (!fs.existsSync(testDir)) {
      return examples;
    }

    // Find 2-3 representative test files
    const files = this.findTestFiles(testDir).slice(0, 3);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        examples.push(content);
      } catch (error) {
        (globalThis as { console?: { warn: (...args: unknown[]) => void } }).console?.warn(
          `Failed to read ${file}:`,
          error
        );
      }
    }

    return examples;
  }

  private findTestFiles(dir: string): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dir)) {
      return files;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...this.findTestFiles(fullPath));
      } else if (entry.name.endsWith(".spec.ts") || entry.name.endsWith(".spec.js")) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private detectPatterns(testDir: string): string[] {
    const patterns: Set<string> = new Set();

    if (!fs.existsSync(testDir)) {
      return Array.from(patterns);
    }

    const files = this.findTestFiles(testDir).slice(0, 5);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");

        // Detect patterns based on content
        if (content.includes("test.describe") || content.includes("describe")) {
          patterns.add("nested-describe");
        }
        if (content.includes("test.extend")) {
          patterns.add("custom-fixtures");
        }
        if (content.includes("class") && content.includes("Page")) {
          patterns.add("POM"); // Page Object Model
        }
        if (content.includes("Given") || content.includes("When") || content.includes("Then")) {
          patterns.add("BDD");
        }
        if (content.includes("@before") || content.includes("@after")) {
          patterns.add("hooks");
        }
      } catch (error) {
        // Skip on error
      }
    }

    return Array.from(patterns);
  }

  private extractImportConventions(examples: string[]): Record<string, string> {
    const conventions: Record<string, string> = {};

    for (const example of examples) {
      const importLines = example.split("\n").filter((line) => line.includes("import"));

      for (const line of importLines) {
        // Extract import patterns
        if (line.includes("@playwright/test")) {
          conventions["playwright"] = line;
        }
        if (line.includes("Page")) {
          conventions["pageObjects"] = line;
        }
        if (line.includes("fixtures")) {
          conventions["fixtures"] = line;
        }
      }
    }

    return conventions;
  }

  private loadESLintConfig(): Record<string, unknown> | undefined {
    const eslintFiles = [".eslintrc.json", ".eslintrc.js", "eslint.config.js"];

    for (const file of eslintFiles) {
      const filePath = path.join(this.repoPath, file);
      if (fs.existsSync(filePath)) {
        try {
          if (file.endsWith(".json")) {
            return JSON.parse(fs.readFileSync(filePath, "utf-8"));
          }
          // For .js files, would need require() - skip for now
        } catch {
          // Ignore malformed ESLint configuration files.
        }
      }
    }

    return undefined;
  }
}

/**
 * Code Slice Extractor
 * Uses static analysis to extract minimal code slices for LLM context
 */
export class CodeSliceExtractor {
  private devRepoPath: string;

  constructor(devRepoPath: string) {
    this.devRepoPath = devRepoPath;
  }

  /**
   * Extract minimal code slice around uncovered method
   */
  extractSlice(
    methodSignature: string,
    filePath: string,
    maxLines: number = 100
  ): string {
    const fullPath = path.join(this.devRepoPath, filePath);

    if (!fs.existsSync(fullPath)) {
      return `File not found: ${filePath}`;
    }

    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");

    // Simple pattern matching to find the method
    const methodName = this.extractMethodName(methodSignature);
    const methodIndex: number = lines.findIndex((line: string): boolean =>
      line.includes(methodName)
    );

    if (methodIndex === -1) {
      return `Method not found: ${methodSignature}`;
    }

    // Extract context around method
    const startLine = Math.max(0, methodIndex - 5);
    const endLine = Math.min(lines.length, methodIndex + maxLines);

    return lines.slice(startLine, endLine).join("\n");
  }

  private extractMethodName(signature: string): string {
    // Extract method name from signature like "calculateDiscount()"
    return signature.split("(")[0];
  }

  /**
   * Trace related components for a method
   */
  traceComponents(
    methodSignature: string,
    filePath: string
  ): { components: string[]; routes: string[] } {
    // This would use real static analysis (TypeScript Compiler API)
    // For now, return stub
    return {
      components: ["RelatedComponent"],
      routes: ["/api/endpoint"],
    };
  }
}

