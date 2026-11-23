# Covera: Vendor-Agnostic Enterprise Test Generation

> **Build enterprise-grade Playwright tests automatically from SeaLights coverage gaps — works with any LLM vendor.**

## 🎯 What is Covera?

Covera is a **4-layer headless agentic platform** that:

1. **Ingests** SeaLights coverage data from your dev repo
2. **Analyzes** uncovered code paths using static analysis
3. **Generates** valid, convention-compliant Playwright tests
4. **Verifies** tests with deterministic quality gates
5. **Works with ANY LLM vendor** (OpenAI, Anthropic, Google, local models)

**Without Covera:**
```
Write tests manually → 2-4 hours per method → Hundreds of edge cases → Flaky tests
```

**With Covera:**
```
SeaLights webhook → Auto-generate tests → Verify → PR in <5 minutes
```

---

## 🏗️ Architecture (4 Layers)

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: Event-Driven Ingestion & Sandbox                       │
│ • Webhook listener (SeaLights, CI/CD)                          │
│ • Ephemeral container orchestration (Kubernetes, Docker)       │
│ • Dual-repo checkout (dev @ commit SHA, test @ HEAD)           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ Layer 2: LLM-Agnostic Orchestration                             │
│ • Vendor-neutral LLM interface (OpenAI, Anthropic, Google...)   │
│ • 5-node deterministic state machine (LangGraph)               │
│ • MCP as universal tool protocol                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ Layer 3: Repository Profiler                                    │
│ • Auto-detect framework patterns (POM, BDD, fixtures)           │
│ • Extract few-shot examples from customer's repo               │
│ • Minimal code slicing (avoid token bloat)                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│ Layer 4: Verification & Self-Healing                            │
│ ✓ Gate 1: Linting + Type checking (auto-fix)                   │
│ ✓ Gate 2: Execution + Flake detection (retry up to 3x)        │
│ ✓ Gate 3: Coverage delta validation (SeaLights)                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Install

**Prerequisites:** [Git](https://git-scm.com) and Node.js with npm (LTS; tested with Node 26).

```bash
git clone https://github.com/KumarArvind85/covera.git
cd covera
npm install
npm run build
```

> **Windows PowerShell:** if you see "running scripts is disabled", use `npm.cmd` instead of `npm`
> (for example `npm.cmd install`), or allow scripts with
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Verify the setup:

```bash
npm test --workspace @covera/mcp-host   # 9 tests, no network or credentials needed
npm run covera -- config                # shows which settings are detected
```

`node_modules/`, `dist/` and `.env` are git-ignored, so a fresh clone always needs the
install and build steps above. Run any CLI command with `npm run covera -- <command>`.
The `npx covera <command>` form used below also works after you run `npm install` a
second time once the build has finished (npm only links the `covera` command when
`packages/cli/dist` exists).

### 2. Configure (`.env`)

Copy the template and fill in your values. The CLI reads `.env` from the directory you run it in.

```bash
cp .env.template .env        # PowerShell: Copy-Item .env.template .env
```

```bash
LLM_VENDOR=openai                    # or: anthropic, google, local
LLM_MODEL=gpt-4-turbo
OPENAI_API_KEY=sk-...
SEALIGHTS_API_TOKEN=...
STAGING_BASE_URL=https://staging.yourapp.com
```

### 3. Profile Your Test Repo

```bash
npx covera profile ./path/to/tests
```

Output:
```
📊 Repository Profile:
   Framework: typescript
   Patterns: POM, nested-describe
   Custom Fixtures: auth, db, storage
✓ Profile complete
```

### 4. Start Webhook Server

```bash
npx covera serve --port 3000
```

Then connect SeaLights:
```
Webhook URL: http://your-host:3000/webhooks/sealights
Event: build.completed
```

### 5. Watch Tests Get Generated!

When SeaLights completes a coverage scan:
1. → Webhook triggers Covera
2. → Test file auto-generated
3. → Verification passes (3 quality gates)
4. → PR created in your test repo

---

## 🔄 The 5-Node Workflow

```
[1] FetchGaps
    ↓ Query SeaLights API → uncovered methods, file paths, branch coverage
    
[2] MapCodeToEntrypoints
    ↓ Static analysis (MCP) → trace uncovered method → React component → route
    
[3] ExploreStagingUI (Optional)
    ↓ Playwright (MCP) → navigate staging, capture DOM/screenshots/network
    
[4] SynthesizeCode (LLM)
    ↓ Dynamic prompt using repo conventions → generate test file
    
[5] VerifyAndHeal
    ├─ Gate 1: Lint + Type check (auto-fix on error)
    ├─ Gate 2: Run test 2x (detect flakes, capture traces)
    └─ Gate 3: Coverage check (verify target method now covered)
    ↓
✅ Test Complete → PR Opened
```

**Key:** State machine is deterministic — produces same test for same code regardless of LLM vendor.

---

## 🤖 LLM Vendor Support

| Vendor | Model | Cost | Speed | Context | Best For |
|--------|-------|------|-------|---------|----------|
| **OpenAI** | GPT-4-turbo | $0.03/test | 2–5s | 128K | ✓ Recommended (best all-around) |
| **Anthropic** | Claude Opus | $0.02/test | 3–8s | 200K | ✓ Code analysis, large repos |
| **Google** | Gemini Pro | $0.005/test | 1–3s | 1M | ✓ Multimodal, fast |
| **Local** | Mistral 7B | Free | 5–30s | 32K | ✓ Privacy, offline |

**Switching vendors?** Change one line:

```bash
# Production (OpenAI)
LLM_VENDOR=openai

# Fallback (Anthropic)
LLM_VENDOR=anthropic

# Cost-conscious (Google)
LLM_VENDOR=google

# Private (Local)
LLM_VENDOR=local
```

No code changes needed. ✨

---

## 📊 Key Concepts

### Coverage Gaps
Uncovered methods, branches, or lines identified by SeaLights.

### Code Slice
Minimal code context around uncovered method (500–2000 LOC) to avoid token waste.

### Repo Profile
Auto-detected conventions: framework, patterns, fixtures, import styles, few-shot examples.

### Few-Shot Examples
2–3 real test files from customer's repo, used to match exact style/patterns.

### Quality Gates
Three deterministic checks before PR:
1. **Lint/Type:** ESLint + TypeScript `--noEmit` (auto-fix)
2. **Execution:** Run test 2x; detect flakes; capture Playwright trace
3. **Coverage:** SeaLights API confirms target method now covered

### Bounded Retry Loop
If test fails, LLM gets Playwright trace + DOM snapshot + error message; maximum 3 attempts.

---

## 📂 Project Structure

```
covera/
├── ARCHITECTURE.md              # Detailed 4-layer design
├── CONFIG_GUIDE.md              # Configuration reference
├── DEPLOYMENT.md                # Production deployment guide
├── packages/
│   ├── core/                    # Layer 2: LLM & state machine
│   │   ├── src/
│   │   │   ├── llm-vendor-interface.ts    # Vendor abstraction
│   │   │   └── state-machine.ts          # 5-node workflow
│   │   └── package.json
│   ├── repo-profiler/           # Layer 3: Framework detection
│   │   ├── src/index.ts
│   │   └── package.json
│   ├── orchestrator/            # Layer 1: Webhooks, sandbox
│   │   ├── src/server.ts
│   │   └── package.json
│   ├── llm-gateway/             # LiteLLM proxy (optional)
│   ├── mcp-host/                # MCP server implementation
│   └── cli/                     # CLI entry point
├── k8s/                         # Kubernetes manifests
├── terraform/                   # IaC for AWS/GCP/Azure
└── docker-compose.yml           # Local development
```

---

## 🔐 Security

- **Ephemeral Sandboxes:** Each job runs in isolated container; destroyed after completion
- **Secrets Management:** API keys stored in Vault/AWS Secrets Manager; never logged
- **Network Isolation:** Private VPC, no egress except to APIs
- **Code Review:** All generated tests flagged `covera-generated`; require manual approval
- **Audit Logs:** Full traceability of all jobs, vendors used, costs

---

## 💰 Cost Example

**Generating tests for 10 uncovered methods:**

```
Vendor: OpenAI (gpt-4-turbo)
Cost per test: $0.02
Tokens per test: ~2,000
Total cost: $0.20

Vendor: Anthropic (Claude Sonnet)
Cost per test: $0.01
Tokens per test: ~1,500
Total cost: $0.10

Vendor: Google (Gemini)
Cost per test: $0.005
Tokens per test: ~1,000
Total cost: $0.05

Vendor: Local (Ollama)
Cost per test: $0.00 (self-hosted)
Total cost: $0.00
```

---

## 📈 Expected Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Coverage for uncovered method | ~0% | 70–90% | +70–90% |
| Time to write test | 2–4 hours | <5 minutes | 50–60x faster |
| Test flakiness | Varies | <5% | More reliable |
| Test maintenance | Manual | Auto-healed | Less burden |

---

## 🛠️ Commands

```bash
# Profile repository
npx covera profile ./tests

# Start webhook server
npx covera serve --port 3000

# Generate tests (demo)
npx covera generate \
  --dev-repo ./my-dev-repo \
  --test-repo ./my-test-repo \
  --session-id sess_12345 \
  --vendor openai

# Show configuration
npx covera config
```

---

## 🔗 Integration Points

### SeaLights
- **Webhook:** POST to `/webhooks/sealights` on build.completed
- **API:** Query coverage gaps, verify coverage delta
- **Data:** `buildSessionId`, uncovered methods, branch coverage

### GitHub
- **PR Creation:** Auto-create PR with generated tests
- **Labels:** Add `covera-generated`, `auto-generated-tests`
- **Reviews:** Notify code owners, support auto-approval for low-risk

### Staging Environment
- **Auth:** Inject tokens for staging
- **Exploration:** Playwright navigates to understand UI
- **Network:** Capture requests/responses for context

---

## 📖 Full Documentation

- **Architecture Deep-Dive:** [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Configuration Reference:** [CONFIG_GUIDE.md](./CONFIG_GUIDE.md)
- **Deployment Manual:** [DEPLOYMENT.md](./DEPLOYMENT.md)
- **API Reference:** See generated JSDoc in `dist/`

---

## 🤝 Contributing

We welcome contributions! Start with:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Write tests and documentation
4. Submit PR with description

---

## 📄 License

MIT © Covera Contributors

---

## 🆘 Support

**Questions?**
- 📖 Check [ARCHITECTURE.md](./ARCHITECTURE.md) first
- 🔧 Try `npx covera config` to verify setup
- 📧 Email: support@covera.io
- 💬 Slack: [Join our community](https://slack.covera.io)

---

## 🎓 Key Takeaways

✅ **LLM Vendor Agnostic:** Work with any vendor; switch with one env var  
✅ **Enterprise Ready:** Multi-tenant, secure, audit logs, cost tracking  
✅ **Deterministic:** Same test for same code regardless of LLM  
✅ **Fast:** <5 minutes from webhook to PR  
✅ **Reliable:** 3 quality gates; auto-healing on failures  
✅ **Framework Aware:** Adapts to any Playwright variant (POM, BDD, fixtures)  

---

**Ready to build enterprise-grade tests automatically?**

```bash
npm install
npm run build
npx covera serve
```

Then connect SeaLights. Sit back. Watch tests generate. 🚀
