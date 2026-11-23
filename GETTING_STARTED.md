# Covera Getting Started Checklist

## ✅ Setup Phase (15 minutes)

- [ ] **Clone Repository**
  ```bash
  cd C:\covera
  ```

- [ ] **Install Dependencies**
  ```bash
  npm install
  npm run build
  ```
  Expected: All packages build without errors

- [ ] **Configure Environment**
  ```bash
  cp .env.template .env.local
  ```
  Edit `.env.local`:
  - [ ] Set `LLM_VENDOR` (openai, anthropic, google, or local)
  - [ ] Set corresponding `*_API_KEY`
  - [ ] Set `SEALIGHTS_API_TOKEN`
  - [ ] Set `STAGING_BASE_URL`

- [ ] **Verify Setup**
  ```bash
  npx covera config
  ```
  Expected: All required keys marked with ✓

---

## 🔍 Exploration Phase (10 minutes)

- [ ] **Review Architecture**
  ```bash
  # Read the design document
  cat ARCHITECTURE.md
  ```
  Focus: 4-layer architecture diagram, 5-node workflow

- [ ] **Check Your Test Repository**
  ```bash
  npx covera profile ./path/to/your/tests
  ```
  Expected output:
  - [ ] Framework detected (TypeScript/JavaScript)
  - [ ] Playwright version identified
  - [ ] Test directory recognized
  - [ ] Few-shot examples extracted (2–3 files)

---

## 🚀 Launch Phase (5 minutes)

- [ ] **Start Webhook Server**
  ```bash
  npx covera serve --port 3000
  ```
  Expected: Server running on http://localhost:3000

- [ ] **Test Health Endpoint**
  ```bash
  curl http://localhost:3000/health
  ```
  Expected response:
  ```json
  { "status": "healthy", "timestamp": "2026-11-21T..." }
  ```

- [ ] **Send Test Webhook**
  ```bash
  curl -X POST http://localhost:3000/webhooks/sealights \
    -H "Content-Type: application/json" \
    -d '{
      "appName": "test-app",
      "branch": "main",
      "buildSessionId": "sess_test_123",
      "devRepoUrl": "https://github.com/test/dev-repo.git",
      "testRepoUrl": "https://github.com/test/test-repo.git",
      "commitSha": "abc123def456"
    }'
  ```
  Expected response:
  ```json
  { "jobId": "job_...", "status": "queued" }
  ```

- [ ] **Check Job Status**
  ```bash
  curl http://localhost:3000/jobs/job_...
  ```
  Expected: Job progresses through pending → running → completed

---

## 🔗 Integration Phase (20 minutes)

### SeaLights Integration

- [ ] **Get SeaLights Webhook URL**
  - Your Covera instance: `http://your-host:3000/webhooks/sealights`

- [ ] **Configure SeaLights Webhook**
  - [ ] Log into SeaLights dashboard
  - [ ] Go to: Settings → Integrations → Webhooks
  - [ ] Add webhook:
    - URL: `http://your-host:3000/webhooks/sealights`
    - Event: `build.completed`
    - Secret: (optional) generate random string
  - [ ] Click "Test Webhook"
  - [ ] Verify: Webhook delivered successfully

### GitHub Integration (Optional)

- [ ] **Generate GitHub Token**
  - [ ] Go to: GitHub Settings → Developer settings → Personal access tokens
  - [ ] Create token with scopes:
    - `repo` (full control of private repositories)
    - `workflow` (actions)
  - [ ] Copy token

- [ ] **Store GitHub Token**
  ```bash
  # Add to .env.local
  GITHUB_TOKEN=ghp_...
  GITHUB_OWNER=your-org
  GITHUB_TEST_REPO=test-repo
  ```

- [ ] **Verify GitHub Access**
  ```bash
  curl -H "Authorization: token ${GITHUB_TOKEN}" \
    https://api.github.com/user
  ```
  Expected: Your GitHub user info

### Slack Integration (Optional)

- [ ] **Create Slack Webhook**
  - [ ] Go to: Slack workspace → Integrations → Incoming Webhooks
  - [ ] Create webhook pointing to your Slack channel
  - [ ] Copy webhook URL

- [ ] **Store Slack Webhook**
  ```bash
  # Add to .env.local
  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
  SLACK_CHANNEL=#covera-tests
  ```

- [ ] **Test Slack Notification**
  ```bash
  curl -X POST "${SLACK_WEBHOOK_URL}" \
    -H 'Content-Type: application/json' \
    -d '{"text": "Covera is connected! ✓"}'
  ```
  Expected: Message appears in Slack channel

---

## 🧪 Testing Phase (varies)

### Local Test Generation

- [ ] **Trigger Manual Test Generation**
  ```bash
  npx covera generate \
    --dev-repo ./path/to/dev-repo \
    --test-repo ./path/to/test-repo \
    --session-id sess_test_123 \
    --vendor openai \
    --model gpt-4-turbo
  ```
  Expected: Test file generated and verified

- [ ] **Inspect Generated Test**
  ```bash
  cat ./output/generated-tests/*.spec.ts
  ```
  Verify:
  - [ ] TypeScript syntax correct
  - [ ] Uses repo's import conventions
  - [ ] Follows Page Object Model (if used)
  - [ ] Uses correct fixtures
  - [ ] Proper test naming

- [ ] **Review Verification Logs**
  ```bash
  cat ./output/logs/job_*.log
  ```
  Check each gate:
  - [ ] Gate 1: Lint passed ✓
  - [ ] Gate 2: Execution passed ✓
  - [ ] Gate 3: Coverage check passed ✓

### Try Different Vendors (No Code Changes!)

- [ ] **Switch to Anthropic**
  ```bash
  export LLM_VENDOR=anthropic
  export ANTHROPIC_API_KEY=sk-ant-...
  npx covera generate --dev-repo ... --vendor anthropic
  ```
  Expected: Same test generated, different model

- [ ] **Switch to Google Gemini**
  ```bash
  export LLM_VENDOR=google
  export GOOGLE_API_KEY=...
  npx covera generate --dev-repo ... --vendor google
  ```
  Expected: Same test, potentially faster/cheaper

- [ ] **Switch to Local Model**
  ```bash
  # First: start local LLM server
  ollama serve &  # or vLLM, LM Studio
  
  export LLM_VENDOR=local
  npx covera generate --dev-repo ... --vendor local
  ```
  Expected: Same test, completely free

---

## 🏢 Production Preparation (1–2 hours)

### Infrastructure Setup

- [ ] **Choose Deployment Model**
  - [ ] Docker Compose (staging)
  - [ ] Kubernetes (production)
  - [ ] Bare metal (special cases)

- [ ] **For Kubernetes Deployment**
  ```bash
  # Apply manifests
  kubectl create namespace covera
  kubectl create secret generic covera-secrets ... -n covera
  kubectl apply -f k8s/deployment.yaml -n covera
  kubectl apply -f k8s/service.yaml -n covera
  
  # Verify
  kubectl get pods -n covera
  kubectl logs -f deployment/covera -n covera
  ```
  Expected: 3 replicas running, pod logs clean

- [ ] **For Docker Compose Deployment**
  ```bash
  docker-compose up -d
  docker-compose ps
  docker-compose logs -f covera
  ```
  Expected: covera and postgres services running

### Security Hardening

- [ ] **Move Secrets to Vault (not .env)**
  ```bash
  # Option 1: HashiCorp Vault
  vault kv put secret/covera/openai-key value=sk-...
  
  # Option 2: AWS Secrets Manager
  aws secretsmanager create-secret --name covera/openai-key
  ```

- [ ] **Enable SSL/TLS**
  ```bash
  # For production webhook URL: https://your-host/webhooks/sealights
  # Use valid certificate (not self-signed)
  ```

- [ ] **Configure Firewall Rules**
  - [ ] Allow port 3000 inbound (from SeaLights, CI/CD)
  - [ ] Restrict egress to: OpenAI API, Anthropic API, Google API, SeaLights, GitHub, Slack
  - [ ] Enable VPC flow logs

### Monitoring & Alerting

- [ ] **Set Up Logging**
  ```bash
  # ELK Stack / CloudWatch / DataDog
  LOG_LEVEL=info
  ENABLE_REQUEST_LOGGING=true
  ```

- [ ] **Enable Metrics**
  ```bash
  ENABLE_METRICS=true
  METRICS_PORT=9090
  ```

- [ ] **Create Alerts**
  - [ ] Alert: Job success rate < 90%
  - [ ] Alert: Average job duration > 300s
  - [ ] Alert: S3 artifacts storage > 100GB

### Database Setup

- [ ] **Initialize PostgreSQL**
  ```bash
  # Create database
  createdb covera
  
  # Run migrations (future: schema creation script)
  # For now: manual table creation for job history
  ```

- [ ] **Configure Backups**
  ```bash
  # Daily backup to S3
  pg_dump covera | gzip > s3://backups/covera-$(date +%Y%m%d).sql.gz
  ```

---

## 📊 Validation Phase

- [ ] **End-to-End Test**
  - [ ] Create coverage gap in dev repo
  - [ ] Run SeaLights scan
  - [ ] Trigger Covera webhook (manual or via CI)
  - [ ] Verify test generated in test repo
  - [ ] Verify PR created on GitHub (if enabled)
  - [ ] Verify Slack notification (if enabled)

- [ ] **Performance Baseline**
  - [ ] Record: Average job duration
  - [ ] Record: Average test size (lines of code)
  - [ ] Record: Average LLM tokens used
  - [ ] Record: Cost per test

- [ ] **Quality Baseline**
  - [ ] Check: Test flake rate (< 5% target)
  - [ ] Check: Coverage improvement (70–90% target)
  - [ ] Check: Lint/type error rate after generation

---

## 📚 Knowledge Check

Answer these to confirm you understand Covera:

- [ ] **Q: Can I switch from OpenAI to Anthropic without code changes?**
  A: Yes, change `LLM_VENDOR` env var and `ANTHROPIC_API_KEY`

- [ ] **Q: What are the 5 nodes in the state machine?**
  A: FetchGaps, MapCodeToEntrypoints, ExploreStagingUI, SynthesizeCode, VerifyAndHeal

- [ ] **Q: What are the 3 quality gates?**
  A: (1) Lint + Type, (2) Execution + Flake, (3) Coverage Delta

- [ ] **Q: How does Covera adapt to different Playwright frameworks?**
  A: Repository Profiler detects patterns and uses few-shot examples

- [ ] **Q: What happens if LLM generates bad code?**
  A: Gate 1 catches syntax errors; Gate 2 catches runtime failures; both auto-heal

- [ ] **Q: Can I run Covera locally without cloud?**
  A: Yes, use Docker Compose or bare metal; use local LLM for free

---

## 🎉 Celebrate!

You've successfully:

✅ Installed and configured Covera  
✅ Profiled your Playwright repository  
✅ Started the webhook server  
✅ Integrated with SeaLights  
✅ Generated tests automatically  
✅ Verified 3 quality gates  
✅ Tested multiple LLM vendors  
✅ Prepared for production  

---

## 🚀 What's Next?

**Short-term (This Week):**
- [ ] Run 10 test generations with real coverage gaps
- [ ] Collect metrics: success rate, speed, cost
- [ ] Get team feedback on generated test quality

**Medium-term (This Month):**
- [ ] Deploy to production Kubernetes cluster
- [ ] Set up monitoring dashboards
- [ ] Enable GitHub auto-approval for low-risk tests
- [ ] Configure cost alerts

**Long-term (This Quarter):**
- [ ] Optimize prompts based on failure patterns
- [ ] Add custom MCP tools for domain-specific logic
- [ ] Fine-tune vendor selection (cost vs. quality)
- [ ] Scale to 100+ tests/day

---

## 📞 Troubleshooting

**Server won't start:**
```bash
# Check port 3000 is free
netstat -ano | grep 3000
# Or use different port
PORT=3001 npx covera serve
```

**API key validation fails:**
```bash
# Test API endpoint directly
curl -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  https://api.openai.com/v1/models
```

**Test generation times out:**
```bash
# Increase timeout
WEBHOOK_TIMEOUT_MS=60000 npx covera serve

# Or reduce code context
MAX_CODE_SLICE_LINES=50
```

**Generated tests don't match your style:**
```bash
# Rerun repo profiler to verify examples
npx covera profile ./tests

# Check few-shot examples are extracted
# If not, add more *.spec.ts files to test directory
```

---

## ✨ Success Indicators

Your Covera setup is working well when:

✅ Webhook returns 200 OK  
✅ Jobs complete in <5 minutes  
✅ Generated tests pass all 3 gates  
✅ Tests follow your repo conventions (no manual edits)  
✅ Flake rate < 5%  
✅ Coverage improvement 70–90%  
✅ Cost < $0.03 per test (or free with local model)  

---

**You're ready to generate tests at scale! 🚀**

For detailed info, check:
- [ARCHITECTURE.md](./ARCHITECTURE.md) – Deep dive
- [CONFIG_GUIDE.md](./CONFIG_GUIDE.md) – All settings
- [DEPLOYMENT.md](./DEPLOYMENT.md) – Production setup
- [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) – CLI cheat sheet
