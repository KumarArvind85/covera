# Covera Configuration Guide

## Quick Start

### 1. Environment Setup

Create a `.env.local` file in the project root:

```bash
# LLM Configuration
# Choose primary vendor
LLM_VENDOR=openai                           # or: anthropic, google, local
LLM_MODEL=gpt-4-turbo                       # or: claude-opus, gemini-pro, mistral:7b
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# Staging Environment
STAGING_BASE_URL=https://staging.yourapp.com
STAGING_AUTH_TOKEN=...

# SeaLights Integration
SEALIGHTS_API_URL=https://your-sealights.io/api
SEALIGHTS_API_TOKEN=...

# Cloud Storage (Artifact Upload)
AWS_S3_BUCKET=covera-artifacts
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Deployment
PORT=3000
LOG_LEVEL=info
```

### 2. Install Dependencies

```bash
npm install
npm run build
```

### 3. Run Locally

**Profile a Playwright repository:**
```bash
npx covera profile ./path/to/test/repo
```

**Output:**
```
📊 Profiling repository...

📋 Repository Profile:
   Framework: typescript
   Playwright: 1.40.0
   Test Dir: tests/e2e
   Patterns: POM, nested-describe
   Custom Fixtures: auth, db, storage

✓ Profile complete
```

**Start webhook server:**
```bash
npx covera serve --port 3000
```

**Generate tests (demo):**
```bash
npx covera generate \
  --dev-repo https://github.com/org/dev-repo.git \
  --test-repo https://github.com/org/test-repo.git \
  --session-id sess_12345 \
  --vendor openai \
  --model gpt-4-turbo
```

---

## Per-Vendor Configuration

### OpenAI (GPT-4, GPT-4-turbo)

**Best for:** Code generation, reasoning

```bash
LLM_VENDOR=openai
LLM_MODEL=gpt-4-turbo  # or gpt-4, gpt-3.5-turbo
OPENAI_API_KEY=sk-...
```

**Cost:** ~$0.01–0.03 per test generation  
**Speed:** 2–5 seconds  
**Recommended:** Yes (best all-around)

---

### Anthropic Claude

**Best for:** Code analysis, context window

```bash
LLM_VENDOR=anthropic
LLM_MODEL=claude-opus           # Most capable
# or
LLM_MODEL=claude-sonnet         # Faster
# or
LLM_MODEL=claude-haiku          # Cheapest
ANTHROPIC_API_KEY=sk-ant-...
```

**Cost:** ~$0.01–0.02 per test  
**Speed:** 3–8 seconds  
**Context Window:** 200K tokens (best for large codebases)

---

### Google Gemini

**Best for:** Multimodal (screenshots), fast inference

```bash
LLM_VENDOR=google
LLM_MODEL=gemini-pro
GOOGLE_API_KEY=...
```

**Cost:** ~$0.001–0.005 per test  
**Speed:** 1–3 seconds  
**Features:** Multimodal (can analyze screenshots)

---

### Local Models (Ollama, vLLM, LM Studio)

**Best for:** Privacy, offline, cost savings

```bash
LLM_VENDOR=local
LLM_MODEL=mistral:7b              # or llama2, neural-chat
# Optional: point to custom server
LOCAL_LLM_BASE_URL=http://localhost:8000
```

**Setup:**

```bash
# Using Ollama
brew install ollama
ollama pull mistral
ollama serve

# Or with vLLM
docker run --gpus all \
  -p 8000:8000 \
  vllm/vllm-openai:latest \
  --model mistral-7b
```

**Cost:** Free (self-hosted)  
**Speed:** Varies (1–30 seconds depending on hardware)  
**Recommended:** For private deployments, test before production

---

## Repository Configuration File

Create `covera.yaml` in your test repository:

```yaml
# covera.yaml

project:
  name: "my-app-tests"
  description: "Playwright tests with Covera"

vendor:
  primary: "openai"            # Primary LLM
  fallback: "anthropic"        # Fallback if primary fails
  byok: true                   # Bring Your Own Key
  apiKey: "${COVERA_LLM_API_KEY}"

repository:
  framework: "typescript"       # or "javascript"
  testDir: "tests/e2e"
  fixturesDir: "tests/fixtures"
  pageObjectDir: "tests/pages"
  eslintConfig: ".eslintrc.json"
  patterns:
    - "POM"                    # Page Object Model
    - "fixtures"               # Custom fixtures
    - "nested-describe"        # Nested describe blocks

sealights:
  apiUrl: "https://sealights.io/api"
  token: "${SEALIGHTS_API_TOKEN}"
  # Query these uncovered methods
  targetMethods:
    - "calculateDiscount()"
    - "applyPromoCode()"
    - "validateCheckout()"

staging:
  baseUrl: "https://staging.yourapp.com"
  authToken: "${STAGING_AUTH_TOKEN}"
  # Optional: custom auth setup
  authScript: "tests/helpers/auth-setup.ts"

quality:
  minCoverageTarget: 0.8       # 80% coverage target
  maxRetries: 3                # Max retry attempts
  timeoutSeconds: 300          # Timeout per test
  flakeThreshold: 0.1          # Fail if >10% flaky
  
  gating:
    linting: true              # Gate 1: Linting
    execution: true            # Gate 2: Execution
    coverage: false            # Gate 3: Coverage check (optional)

notifications:
  slack:
    webhookUrl: "${SLACK_WEBHOOK}"
    channel: "#covera-tests"
    mentionOnFailure: "@qa-team"
  
  github:
    autoApproveLow: true       # Auto-approve low-risk tests
    requireReviewHigh: true    # Require review for complex tests
    addLabels:
      - "covera-generated"
      - "auto-generated-tests"

database:
  # Optional: Store test generation history
  postgres:
    host: "localhost"
    port: 5432
    database: "covera"
    user: "${DB_USER}"
    password: "${DB_PASSWORD}"
```

---

## Deployment Models

### Model 1: Managed SaaS (Recommended for Enterprise)

```
┌─────────────────────────────────────────┐
│   Covera Control Plane (Hosted)        │
│   - Webhook Listener                   │
│   - LLM Gateway                        │
│   - Kubernetes Orchestration           │
└──────────────────┬──────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
    ┌────▼────┐          ┌───▼────┐
    │ Your    │          │ Your   │
    │ Dev Repo│          │ Test   │
    │ Webhook │          │ Repo   │
    └────┬────┘          └───┬────┘
         │                   │
         └─────────┬─────────┘
                   │
    ┌──────────────▼──────────────┐
    │ Covera Ephemeral Jobs       │
    │ (Kubernetes Pods, isolated) │
    │ ├─ Repo Profiler           │
    │ ├─ MCP Host                │
    │ ├─ State Machine           │
    │ └─ Verification Loops      │
    └──────────────┬──────────────┘
                   │
    ┌──────────────▼──────────────┐
    │ Artifact Storage (S3)       │
    │ - Generated tests           │
    │ - Verification logs         │
    │ - Coverage reports          │
    └─────────────────────────────┘
```

**Setup:**
```bash
# Deploy to your Kubernetes cluster
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/configmap.yaml

# Or use our Terraform modules (provided)
terraform apply -f terraform/aws/main.tf
```

### Model 2: Self-Hosted (On-Premise)

```
# Docker Compose (single machine)
docker-compose -f docker-compose.yml up -d

# Or bare metal
npm install
npm run build
npm start  # Starts webhook server on port 3000
```

---

## Multi-Tenant Configuration

For hosting multiple customers:

```yaml
# Multi-tenant config
tenants:
  customer-a:
    llm_vendor: "openai"
    sealights_token: "${VAULT://customer-a/sealights-token}"
    test_repo: "https://github.com/customer-a/test-repo.git"
    allowed_branches:
      - "main"
      - "develop"
  
  customer-b:
    llm_vendor: "anthropic"
    sealights_token: "${VAULT://customer-b/sealights-token}"
    test_repo: "https://github.com/customer-b/test-repo.git"
    allowed_branches:
      - "main"
```

---

## Security Best Practices

1. **Secrets Management:**
   ```bash
   # Use HashiCorp Vault
   vault kv put secret/covera/openai-key value=sk-...
   
   # Or AWS Secrets Manager
   aws secretsmanager create-secret --name covera/openai-key
   ```

2. **Network Isolation:**
   - Run Covera in private VPC
   - Use VPN for SeaLights API access
   - Restrict sandbox egress

3. **Code Review:**
   - All generated tests require manual PR review
   - Automated tests are flagged with `covera-generated` label
   - High-risk tests require additional review

4. **Audit Logging:**
   ```bash
   # Enable audit logs
   LOG_LEVEL=debug
   AUDIT_LOG_ENABLED=true
   AUDIT_LOG_PATH=./logs/audit.log
   ```

---

## Troubleshooting

### "Invalid LLM API key"
```bash
# Verify API key
npx covera config

# Test endpoint
curl -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  https://api.openai.com/v1/models
```

### "Repository profile failed"
```bash
# Check test directory exists
ls -la ./tests/e2e

# Manually profile
npx covera profile ./path/to/tests
```

### "SeaLights webhook timeout"
```bash
# Increase timeout
WEBHOOK_TIMEOUT_MS=30000

# Check SeaLights API endpoint
curl -H "Authorization: Bearer ${SEALIGHTS_API_TOKEN}" \
  ${SEALIGHTS_API_URL}/builds/${BUILD_SESSION_ID}
```

---

## Next Steps

1. **Review the Architecture:** See [ARCHITECTURE.md](./ARCHITECTURE.md)
2. **Start the Webhook Server:** `npx covera serve`
3. **Connect SeaLights:** Webhook → `http://your-host:3000/webhooks/sealights`
4. **Monitor Jobs:** Check status at `http://your-host:3000/jobs/:jobId`
5. **Review Generated Tests:** PRs appear in your test repository
