# Covera Quick Reference Card

## 🎯 Essentials in 60 Seconds

### What Does Covera Do?
Automatically generates Playwright tests from SeaLights coverage gaps using any LLM vendor (OpenAI, Anthropic, Google, local models).

### How Does It Work?
```
SeaLights webhook → Dev repo analysis → Test generation → 3 quality gates → PR
```

### Supported LLM Vendors
| Vendor | Setup | Cost | Speed | Context |
|--------|-------|------|-------|---------|
| OpenAI | `LLM_VENDOR=openai` | $0.02/test | 2–5s | 128K |
| Anthropic | `LLM_VENDOR=anthropic` | $0.01/test | 3–8s | 200K |
| Google | `LLM_VENDOR=google` | $0.005/test | 1–3s | 1M |
| Local | `LLM_VENDOR=local` | Free | 5–30s | 32K |

---

## ⚡ Getting Started

### 1. Install
```bash
git clone https://github.com/covera/covera.git
cd covera
npm install && npm run build
```

### 2. Configure
Create `.env.local`:
```env
LLM_VENDOR=openai
LLM_MODEL=gpt-4-turbo
OPENAI_API_KEY=sk-...
SEALIGHTS_API_TOKEN=...
STAGING_BASE_URL=https://staging.yourapp.com
```

### 3. Profile Your Repo
```bash
npx covera profile ./tests
```

### 4. Start Server
```bash
npx covera serve --port 3000
```

### 5. Connect SeaLights
Webhook URL: `http://your-host:3000/webhooks/sealights`

---

## 🔄 The 5-Node Workflow

```
[1] FetchGaps              → Query SeaLights API
↓
[2] MapCodeToEntrypoints   → Static analysis (MCP)
↓
[3] ExploreStagingUI       → Playwright exploration (optional)
↓
[4] SynthesizeCode         → LLM generates test
↓
[5] VerifyAndHeal
  ├─ Lint + Type check (auto-fix)
  ├─ Execute + Flake test (retry 3x max)
  └─ Coverage check (SeaLights)
```

---

## 🏗️ 4-Layer Architecture

| Layer | Purpose | Key Components |
|-------|---------|---|
| **1** | Webhook + Sandbox | Listener, ephemeral container, dual-repo checkout |
| **2** | LLM Orchestration | Vendor abstraction, state machine (5-node), MCP host |
| **3** | Repo Profiler | Framework detection, few-shot examples, code slicing |
| **4** | Verification | 3 quality gates, bounded retry loop, coverage delta |

---

## 📋 Configuration

### Minimum (`.env.local`)
```env
LLM_VENDOR=openai
OPENAI_API_KEY=sk-...
SEALIGHTS_API_TOKEN=...
```

### Full (`.env.local`)
```env
# LLM
LLM_VENDOR=openai
LLM_MODEL=gpt-4-turbo
OPENAI_API_KEY=sk-...

# Fallback vendor
FALLBACK_VENDOR=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# SeaLights
SEALIGHTS_API_URL=https://sealights.io/api
SEALIGHTS_API_TOKEN=...

# Staging
STAGING_BASE_URL=https://staging.yourapp.com
STAGING_AUTH_TOKEN=...

# Server
PORT=3000
LOG_LEVEL=info

# Quality Gates
VERIFY_COVERAGE_DELTA=true
MAX_RETRIES=3
FLAKE_THRESHOLD=0.1
```

### Repository Config (`covera.yaml`)
```yaml
vendor:
  primary: openai
  fallback: anthropic

repository:
  framework: typescript
  testDir: tests/e2e
  patterns: [POM, fixtures, nested-describe]

sealights:
  apiUrl: https://sealights.io/api
  token: ${SEALIGHTS_API_TOKEN}

staging:
  baseUrl: https://staging.yourapp.com
  authToken: ${STAGING_AUTH_TOKEN}

quality:
  minCoverageTarget: 0.8
  maxRetries: 3
```

---

## 🚀 CLI Commands

```bash
# Profile repository
npx covera profile ./path/to/tests

# Start webhook server
npx covera serve --port 3000

# Generate tests (demo)
npx covera generate \
  --dev-repo ./dev-repo \
  --test-repo ./test-repo \
  --session-id sess_12345 \
  --vendor openai

# Show config
npx covera config
```

---

## 🔌 Webhook Format

### Trigger (SeaLights/CI sends this)
```json
POST /webhooks/sealights
{
  "appName": "my-app",
  "branch": "main",
  "buildSessionId": "sess_12345",
  "devRepoUrl": "https://github.com/org/dev-repo.git",
  "testRepoUrl": "https://github.com/org/test-repo.git",
  "commitSha": "abc123def456"
}
```

### Response
```json
{
  "jobId": "job_1234567890_xyz",
  "status": "queued"
}
```

### Check Status
```bash
curl http://your-host:3000/jobs/job_1234567890_xyz
```

---

## 🔐 Security Checklist

- [ ] API keys in Vault or AWS Secrets Manager (never in code)
- [ ] Webhook validated (signature, IP whitelist)
- [ ] All generated tests require manual review before merge
- [ ] Audit logs enabled (track all jobs, vendors, costs)
- [ ] Network policies: private VPC, restricted egress
- [ ] SSL/TLS for webhook endpoint

---

## 🐳 Deployment Options

### Local (Development)
```bash
docker-compose up -d
```

### Docker (Staging)
```bash
docker build -t covera:latest .
docker run -p 3000:3000 covera:latest
```

### Kubernetes (Production)
```bash
kubectl apply -f k8s/deployment.yaml -n covera
```

---

## 💡 Switching LLM Vendors

**Current vendor:** `LLM_VENDOR=openai`

**Switch to Anthropic:**
```bash
export LLM_VENDOR=anthropic
export ANTHROPIC_API_KEY=sk-ant-...
npx covera serve
```

**No code changes needed.** The state machine adapts automatically.

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Invalid LLM API key" | `curl https://api.openai.com/v1/models -H "Authorization: Bearer ${OPENAI_API_KEY}"` |
| "Repository profile failed" | Verify `tests/` directory exists; run `npx covera profile ./tests` |
| "SeaLights webhook timeout" | Increase `WEBHOOK_TIMEOUT_MS=60000` |
| "High API costs" | Switch to `google` (cheaper) or `local` (free) |
| "Generated tests flaky" | Increase `FLAKE_THRESHOLD=0.2`; check staging env |

---

## 📊 Monitoring

### Health Check
```bash
curl http://your-host:3000/health
```

Expected:
```json
{ "status": "healthy", "timestamp": "..." }
```

### Job Metrics
- `job_count` – Total jobs processed
- `job_success_rate` – % of successful jobs
- `job_duration_seconds` – Average time per job
- `coverage_improvement` – Average % coverage gained
- `llm_tokens_used` – Total tokens (cost tracking)

---

## 💰 Cost Estimation

**Example:** Generating tests for 10 uncovered methods

```
Vendor: OpenAI (gpt-4-turbo)
Tokens/test: ~2,000
Cost/test: $0.02
Total: $0.20

Vendor: Anthropic (Claude Sonnet)
Tokens/test: ~1,500
Cost/test: $0.01
Total: $0.10

Vendor: Google (Gemini)
Tokens/test: ~1,000
Cost/test: $0.005
Total: $0.05

Vendor: Local (Ollama)
Cost: $0.00 (self-hosted)
Total: $0.00
```

---

## 📚 Documentation Map

| Document | Purpose |
|----------|---------|
| **README.md** | Overview and quick start |
| **ARCHITECTURE.md** | Detailed 4-layer design |
| **CONFIG_GUIDE.md** | Configuration reference |
| **DEPLOYMENT.md** | Production deployment |
| **Quick Reference** | This card! |

---

## 🎯 Success Metrics

✅ Coverage gap filled (70–90% of target method)  
✅ Test passes all 3 quality gates  
✅ No manual editing needed  
✅ PR created and ready for review  
✅ <5 minute turnaround time  
✅ <5% flake rate  

---

## 🆘 Support Channels

- 📖 **Docs:** Check ARCHITECTURE.md, CONFIG_GUIDE.md
- 🔧 **Verify Setup:** `npx covera config`
- 📧 **Email:** support@covera.io
- 💬 **Slack:** [Join community](https://slack.covera.io)
- 🐛 **Issues:** GitHub Issues (with job ID and logs)

---

## 🎓 Key Takeaways

1. **Vendor Agnostic:** Switch LLMs with one env var
2. **Deterministic:** Same test for same code
3. **Fast:** <5 minutes from webhook to PR
4. **Reliable:** 3 quality gates + auto-healing
5. **Secure:** Ephemeral sandboxes, audit logs
6. **Framework Aware:** Adapts to any Playwright variant

---

**Ready to generate tests automatically?**

```bash
npm install && npm run build
npx covera serve
```

Connect your SeaLights webhook. Watch tests generate. 🚀

---

**Last Updated:** 2026-11-21  
**Version:** 0.1.0  
**GitHub:** https://github.com/covera/covera
