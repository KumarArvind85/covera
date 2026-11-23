# Covera: Vendor-Agnostic Enterprise Test Generation Platform

## Overview

Covera is a 4-layer headless agentic platform that:
- Ingests SeaLights coverage gaps from development repositories
- Automatically generates valid, convention-compliant Playwright tests
- Works with **any LLM vendor** (OpenAI, Anthropic, Google, local models)
- Adapts to **any Playwright framework variant** (POM, BDD, fixtures, custom)
- Runs in **ephemeral, isolated sandboxes** for enterprise security

---

## Architecture Layers

### Layer 1: Event-Driven Ingestion & Workspace Sandbox

**Purpose:** Isolate test generation jobs in ephemeral containers with dual-repo access.

**Components:**
- **Webhook Listener** – Receives SeaLights/CI webhooks containing:
  ```json
  {
    "appName": "my-app",
    "branch": "main",
    "buildSessionId": "sess_12345",
    "devRepoUrl": "https://github.com/org/dev-repo.git",
    "testRepoUrl": "https://github.com/org/test-repo.git",
    "commitSha": "abc123def456"
  }
  ```
- **Sandbox Orchestrator** – Spins up Kubernetes Job or Docker container with:
  - Dev repo cloned at exact SHA → `/workspace/dev`
  - Test repo cloned at HEAD → `/workspace/tests`
  - Ephemeral credentials injected from Vault/AWS Secrets
  - MCP server bootstrapped for tooling access
- **Artifact Storage** – Persist generated tests, logs, and coverage deltas to cloud storage

**Flow:**
```
Webhook Received
    ↓
Validate Request & Extract Build Metadata
    ↓
Spin Ephemeral Sandbox (Kubernetes Job)
    ├─ Clone Dev Repo @ Commit SHA
    ├─ Clone Test Repo @ HEAD
    ├─ Inject Secrets & Environment
    └─ Bootstrap MCP Server
    ↓
Hand Off to Layer 2 (Orchestration)
```

---

### Layer 2: LLM-Agnostic Orchestration & Context Engine

**Purpose:** Abstract away LLM vendor differences and enforce deterministic state flow.

**Key Design Decisions:**

1. **Unified Model Gateway**
   - Use **LiteLLM** or **OpenRouter** to route all calls through OpenAI-compatible API
   - Normalize tool-calling schemas across vendors
   - Support BYOK (Bring Your Own Key) or managed endpoints (Bedrock, Vertex)
   - Config example:
     ```python
     model = "openai/gpt-4-turbo"  # or "anthropic/claude-opus"
     # LiteLLM routes to correct endpoint + schema
     ```

2. **MCP as Universal Tool Interface**
   - Act as **MCP Host** connecting to MCP Servers:
     - `sealights-mcp` – Query coverage gaps, trace code paths
     - `playwright-mcp` – Execute tests, capture traces, screenshots
     - `codebase-mcp` – AST parsing, static analysis, type info
   - All LLM vendors interact with same JSON tool signatures
   - **No prompt injection risk** – tools are deterministic

3. **Deterministic State Machine (5-Node LangGraph)**
   ```
   START
     ↓
   [1] FetchGaps
       └─ Query SeaLights API (MCP call)
       └─ Extract uncovered methods, file paths, branch coverage
     ↓
   [2] MapCodeToEntrypoints
       └─ Static analysis on dev repo (MCP call)
       └─ Trace uncovered method → React component → route/endpoint
       └─ Identify test entry points (login, navigate, interaction)
     ↓
   [3] ExploreStagingUI (Optional)
       └─ Launch Playwright browser (MCP call)
       └─ Navigate staging app to understand UI structure
       └─ Capture screenshots, DOM, network calls
     ↓
   [4] SynthesizeCode (LLM)
       └─ Constrained prompt using repo conventions (from Repo Profiler)
       └─ Generate test file with correct imports, fixtures, patterns
     ↓
   [5] VerifyAndHeal
       └─ Lint → Type-check → Run tests → Check coverage
       └─ Bounded retry loop with LLM if failures detected
     ↓
   END (Pull Request or Archive)
   ```

**LLM-Specific Adaptation:**
- **Claude (Anthropic):** Excels at code analysis; use for Layers 2 & 4
- **GPT-4 (OpenAI):** Strongest code generation; primary in Layer 4
- **Gemini (Google):** Multimodal (useful for UI exploration); Layer 3
- **Local Ollama/vLLM:** Fallback; smaller context, simpler prompts

---

### Layer 3: Repo Profiler (Adapt to Any Playwright Framework)

**Purpose:** Auto-detect framework patterns and inject them as few-shot examples.

**Key Operations:**

1. **Framework Fingerprinting**
   ```python
   # Parse package.json + playwright.config.ts
   {
       "framework": "typescript",
       "playwrightVersion": "1.40.0",
       "testDir": "tests/e2e",
       "fixtures": ["auth", "db", "storage"],
       "patterns": ["POM", "BDD", "nested-describe"],
       "eslintRules": {...},
       "customFixtures": {
           "auth": "fixtures/auth.ts",
           "db": "fixtures/db.ts"
       }
   }
   ```

2. **Style & Pattern Extraction**
   - Use **Tree-sitter** or **TypeScript Compiler API** to parse 2–3 representative test files
   - Extract:
     - Import statements (page objects, fixtures, utilities)
     - Test structure (describe/it, test.describe, cucumber)
     - Assertion patterns
     - Page object naming conventions
   - Feed as dynamic few-shot prompt:
     ```
     Here are 2 example tests from this repo:
     
     [Example 1: tests/auth/login.spec.ts]
     import { test, expect } from '@playwright/test';
     import { LoginPage } from '../pages/LoginPage';
     
     test.describe('Authentication', () => {
       test('should login with valid credentials', async ({ page }) => {
         const loginPage = new LoginPage(page);
         await loginPage.navigateTo();
         await loginPage.fillCredentials('user@test.com', 'password');
         await loginPage.submit();
         expect(page.url()).toContain('/dashboard');
       });
     });
     
     [Example 2: tests/checkout.spec.ts]
     ...
     ```

3. **Cross-Repo Call-Graph Slicing**
   - Start from SeaLights' uncovered method (e.g., `calculateDiscount()`)
   - Use static analysis to trace:
     - Which React component calls it
     - Which route/page renders that component
     - Which HTTP endpoint feeds that route
   - Extract only that minimal slice (~500–2000 LOC) for LLM context
   - **Avoid token bloat:** Don't pass entire dev repo

4. **Dynamic Prompt Construction**
   ```python
   system_prompt = f"""You are a Playwright test expert.
   
   This repository uses these patterns:
   - Framework: TypeScript + {repo_profile.framework}
   - Fixtures: {repo_profile.fixtures}
   - Page Objects: Named as PascalCase in {repo_profile.testDir}/pages/
   
   Uncovered Code:
   {uncovered_code_slice}
   
   Example Tests (follow this style exactly):
   {few_shot_examples}
   
   Generate a new test file that:
   1. Imports correct page objects/fixtures
   2. Follows the exact assertion style shown
   3. Names test cases following the repo convention
   """
   ```

---

### Layer 4: Closed-Loop Verification & Self-Healing

**Purpose:** Ensure enterprise-grade reliability before merging tests.

**Three Deterministic Quality Gates:**

1. **Static & Lint Check**
   ```python
   # MCP call to codebase-mcp
   result = run_linting(generated_file)
   if result.errors:
       healer_prompt = f"""
       The generated test has these errors:
       {result.errors}
       
       Fix them while maintaining the test logic.
       """
       regenerated_code = llm.call(healer_prompt, temperature=0.1)
       generated_file = regenerated_code
       # Retry linting (max 2 attempts)
   ```

2. **Execution & Flake Check**
   ```python
   # MCP call to playwright-mcp
   result = run_tests(
       file=generated_file,
       staging_env=True,
       repeat_each=2,  # Run twice to catch flakes
       capture_trace=True
   )
   
   if result.failed:
       # Bounded healer loop
       for attempt in range(3):
           trace_analysis = analyze_playwright_trace(result.trace)
           healer_prompt = f"""
           Test failed: {result.error}
           
           DOM Snapshot:
           {trace_analysis.dom}
           
           Network Log:
           {trace_analysis.network}
           
           Fix the test to handle the actual UI.
           """
           regenerated_code = llm.call(healer_prompt, temperature=0.1)
           result = run_tests(regenerated_code, repeat_each=2)
           if result.passed:
               break
   ```

3. **Coverage Delta Check (Optional but Recommended)**
   ```python
   # Run test with SeaLights plugin attached
   with sealights_enabled(build_session_id):
       result = run_tests(generated_file, staging_env=True)
   
   # Query SeaLights API
   coverage_delta = query_sealights_coverage(
       method_signature=target_method,
       before_session=original_build,
       after_session=new_build
   )
   
   if coverage_delta.status == "NEWLY_COVERED":
       approval_signal = True  # Safe to PR
   elif coverage_delta.status == "PARTIAL":
       # Edge cases; note in PR description
       approval_signal = True
   else:
       # Test didn't actually cover target; fail
       raise CoverageNotMetError(coverage_delta)
   ```

**Output:**
- ✅ Generated test file
- 📊 Coverage delta report
- 🔍 Playwright trace (for debugging)
- 📝 PR description with rationale

---

## Technology Stack

| Layer | Component | Technology |
|-------|-----------|------------|
| **1** | Webhook Server | FastAPI / Node.js Express |
| **1** | Sandbox Orchestration | Kubernetes / Docker |
| **1** | Secrets Management | Vault / AWS Secrets Manager |
| **2** | LLM Gateway | LiteLLM / OpenRouter |
| **2** | State Machine | LangGraph / Temporal |
| **2** | MCP Host | Node.js / Python |
| **3** | Static Analysis | Tree-sitter / TypeScript Compiler API |
| **3** | AST Parsing | @babel/parser (JS), typescript-estree |
| **4** | Test Execution | Playwright Test / pytest |
| **4** | Linting | ESLint / TSLint / Prettier |
| **4** | Type Checking | TypeScript / Mypy |

---

## Deployment Model

```
┌─────────────────────────────────────────────────────────────┐
│                   Covera Control Plane                       │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐   │
│  │ Webhook Listener│ │  LLM Gateway   │  │ State Machine│   │
│  │  (FastAPI)     │  │  (LiteLLM)     │  │  (LangGraph) │   │
│  └────────────────┘  └────────────────┘  └──────────────┘   │
│        ↓                     ↓                    ↓            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │         Kubernetes Cluster (Job Queue)                 │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │  │
│  │  │  Job Pod #1  │ │  Job Pod #2  │ │  Job Pod #N  │   │  │
│  │  │ (Ephemeral)  │ │ (Ephemeral)  │ │ (Ephemeral)  │   │  │
│  │  │              │ │              │ │              │   │  │
│  │  │ ├─ Repo Prof │ │ ├─ Repo Prof │ │ ├─ Repo Prof │   │  │
│  │  │ ├─ MCP Host  │ │ ├─ MCP Host  │ │ ├─ MCP Host  │   │  │
│  │  │ ├─ Playwright│ │ ├─ Playwright│ │ ├─ Playwright│   │  │
│  │  │ └─ Verifier  │ │ └─ Verifier  │ │ └─ Verifier  │   │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘   │  │
│  └────────────────────────────────────────────────────────┘  │
│                        ↓                                      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │      Artifact Storage (S3 / Cloud Storage)             │  │
│  │  ├─ Generated tests                                    │  │
│  │  ├─ Verification logs                                 │  │
│  │  └─ Coverage reports                                  │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ↑                                          ↓
  ┌──────────────┐                        ┌──────────────┐
  │ SeaLights    │                        │ GitHub       │
  │ Webhook      │                        │ Pull Request │
  └──────────────┘                        └──────────────┘
```

---

## Configuration & Multi-Tenancy

Each customer (enterprise) gets their own configuration:

```yaml
# covera-config.yaml (stored in customer's test repo)
vendor:
  primary: "openai"  # or "anthropic", "google", "local"
  fallback: "anthropic"
  byok: true  # Bring Your Own Key
  apiKey: "${COVERA_LLM_API_KEY}"  # Injected via CI/CD secrets

repository:
  framework: "typescript"
  testDir: "tests/e2e"
  fixturesDir: "tests/fixtures"
  pageObjectDir: "tests/pages"
  eslintConfig: ".eslintrc.json"

sealights:
  apiUrl: "https://sealights.io/api"
  token: "${SEALIGHTS_API_TOKEN}"
  
staging:
  baseUrl: "https://staging.yourapp.com"
  authToken: "${STAGING_AUTH_TOKEN}"
  
quality:
  minCoverageTarget: 0.8  # 80%
  maxRetries: 3
  timeoutSeconds: 300

notifications:
  slack:
    webhookUrl: "${SLACK_WEBHOOK}"
  github:
    autoApproveLow: true  # Auto-approve low-risk tests
```

---

## Success Metrics

- ✅ **Coverage Improvement:** Test reaches 80%+ of target method coverage
- ✅ **Zero Flakes:** Test passes 100% of repeat runs in staging
- ✅ **LLM Agnostic:** Switching `vendor.primary` to any supported model works without code changes
- ✅ **Fast Turnaround:** Test generation + verification completes in <5 minutes
- ✅ **Enterprise Ready:** Supports 50+ Playwright framework variants without custom code
