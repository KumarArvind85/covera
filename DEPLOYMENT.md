# Covera Enterprise Deployment Manual

## Deployment Checklist

### Pre-Deployment (1-2 days before)

- [ ] **Provision Infrastructure**
  - [ ] Kubernetes cluster (3+ nodes) or Docker host
  - [ ] PostgreSQL 14+ for job history
  - [ ] S3 bucket (or equivalent cloud storage)
  - [ ] VPC with private subnets

- [ ] **Configure Secrets**
  - [ ] SeaLights API token
  - [ ] LLM vendor API keys (OpenAI, Anthropic, Google)
  - [ ] Staging environment credentials
  - [ ] GitHub token (for PR creation)
  - [ ] Slack webhook (for notifications)
  - [ ] Store in Vault or AWS Secrets Manager

- [ ] **Prepare Repositories**
  - [ ] Dev repo accessible via HTTPS with token
  - [ ] Test repo with write access
  - [ ] Branch protection rules configured
  - [ ] CI/CD webhooks pointing to Covera

- [ ] **Network & Security**
  - [ ] Firewall rules allow webhook ingress (port 3000)
  - [ ] SSL/TLS certificate (self-signed for staging, real for prod)
  - [ ] Network policies for pod-to-pod communication
  - [ ] Rate limiting configured (10 req/sec default)

### Deployment (Day 1)

#### Option A: Kubernetes (Production)

```bash
# 1. Create namespace
kubectl create namespace covera

# 2. Create secrets
kubectl create secret generic covera-secrets \
  --from-literal=openai-api-key=${OPENAI_API_KEY} \
  --from-literal=sealights-token=${SEALIGHTS_API_TOKEN} \
  --from-literal=github-token=${GITHUB_TOKEN} \
  --from-literal=slack-webhook=${SLACK_WEBHOOK} \
  -n covera

# 3. Apply deployment
kubectl apply -f k8s/deployment.yaml -n covera
kubectl apply -f k8s/service.yaml -n covera
kubectl apply -f k8s/configmap.yaml -n covera

# 4. Verify deployment
kubectl get pods -n covera
kubectl get svc -n covera
kubectl logs -f deployment/covera -n covera

# 5. Expose service (use ingress in production)
kubectl port-forward svc/covera 3000:3000 -n covera
```

**Kubernetes Manifests** (k8s/deployment.yaml):

```yaml
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: covera-config
  namespace: covera
data:
  LLM_VENDOR: "openai"
  LLM_MODEL: "gpt-4-turbo"
  STAGING_BASE_URL: "https://staging.yourapp.com"
  SEALIGHTS_API_URL: "https://sealights.io/api"
  LOG_LEVEL: "info"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: covera
  namespace: covera
spec:
  replicas: 3
  selector:
    matchLabels:
      app: covera
  template:
    metadata:
      labels:
        app: covera
    spec:
      serviceAccountName: covera
      containers:
      - name: covera
        image: covera:latest  # Build from Dockerfile
        ports:
        - containerPort: 3000
          name: http
        
        envFrom:
        - configMapRef:
            name: covera-config
        
        env:
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: covera-secrets
              key: openai-api-key
        - name: SEALIGHTS_API_TOKEN
          valueFrom:
            secretKeyRef:
              name: covera-secrets
              key: sealights-token
        - name: GITHUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: covera-secrets
              key: github-token
        - name: SLACK_WEBHOOK
          valueFrom:
            secretKeyRef:
              name: covera-secrets
              key: slack-webhook
        
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: covera
  namespace: covera
spec:
  selector:
    app: covera
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
  type: LoadBalancer

---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: covera
  namespace: covera

---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: covera
  namespace: covera
rules:
- apiGroups: ["batch"]
  resources: ["jobs"]
  verbs: ["create", "get", "list", "watch", "delete"]
- apiGroups: [""]
  resources: ["pods", "pods/logs"]
  verbs: ["get", "list"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: covera
  namespace: covera
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: covera
subjects:
- kind: ServiceAccount
  name: covera
  namespace: covera
```

#### Option B: Docker Compose (Staging)

```bash
# 1. Build Docker image
docker build -t covera:latest .

# 2. Start services
docker-compose up -d

# 3. Verify
docker-compose ps
docker-compose logs -f covera
```

**Docker Compose** (docker-compose.yml):

```yaml
version: '3.8'

services:
  covera:
    build: .
    container_name: covera
    ports:
      - "3000:3000"
    environment:
      LLM_VENDOR: openai
      LLM_MODEL: gpt-4-turbo
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      SEALIGHTS_API_TOKEN: ${SEALIGHTS_API_TOKEN}
      STAGING_BASE_URL: https://staging.yourapp.com
      LOG_LEVEL: info
    volumes:
      - ./logs:/app/logs
    depends_on:
      - postgres
    networks:
      - covera

  postgres:
    image: postgres:15
    container_name: covera-postgres
    environment:
      POSTGRES_DB: covera
      POSTGRES_USER: covera
      POSTGRES_PASSWORD: covera-secure-password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - covera

networks:
  covera:
    driver: bridge

volumes:
  postgres_data:
```

**Dockerfile:**

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built source
COPY dist ./dist

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 3000

CMD ["node", "dist/orchestrator/src/server.js"]
```

### Post-Deployment (Day 2-3)

#### Verification Tests

```bash
# 1. Health check
curl http://your-covera-host:3000/health
# Expected: { "status": "healthy", "timestamp": "..." }

# 2. Test webhook
curl -X POST http://your-covera-host:3000/webhooks/sealights \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "test-app",
    "branch": "main",
    "buildSessionId": "sess_test_123",
    "devRepoUrl": "https://github.com/test/dev-repo.git",
    "testRepoUrl": "https://github.com/test/test-repo.git",
    "commitSha": "abc123def456"
  }'
# Expected: { "jobId": "job_...", "status": "queued" }

# 3. Query job status
curl http://your-covera-host:3000/jobs/job_xxxx
# Expected: { "jobId": "job_...", "status": "completed", "artifactUrl": "s3://..." }
```

#### Integration with SeaLights

```bash
# In your SeaLights dashboard:
# 1. Navigate to: Settings → Integrations → Webhooks
# 2. Add new webhook:
#    URL: https://your-covera-host/webhooks/sealights
#    Event: build.completed
#    Secret: (optional, but recommended)
# 3. Test webhook
```

#### Integration with GitHub

```bash
# In your GitHub test repo:
# 1. Settings → Webhooks → Add webhook
#    Payload URL: https://your-covera-host/webhooks/github
#    Events: push, pull_request
# 2. Add deploy key (read-only for dev repo)
# 3. Add token (write access for test repo)
```

---

## Monitoring & Operations

### Logging

```bash
# View logs (Docker Compose)
docker-compose logs -f covera

# View logs (Kubernetes)
kubectl logs -f deployment/covera -n covera

# Log aggregation (ELK / CloudWatch)
# Forward logs via stdout/stderr or sidecar
```

### Metrics

```bash
# Track these metrics:
- job_count (total jobs)
- job_duration_seconds (avg time per job)
- job_success_rate (% successful)
- coverage_improvement (avg % coverage gained)
- llm_tokens_used (cost tracking)
- sandbox_uptime (% container health)
```

### Alerts

```yaml
# Example Prometheus alert
groups:
  - name: covera
    rules:
    - alert: CoveraHighErrorRate
      expr: rate(covera_job_failures[5m]) > 0.1
      annotations:
        summary: "Covera job failure rate > 10%"
    
    - alert: CoveraJobTimeout
      expr: covera_job_duration_seconds > 300
      annotations:
        summary: "Covera job taking > 5 minutes"
```

### Scaling

**Horizontal Scaling:**
```bash
# Kubernetes: increase replicas
kubectl scale deployment covera --replicas=5 -n covera

# Or use HPA (Horizontal Pod Autoscaler)
kubectl apply -f k8s/hpa.yaml
```

**Vertical Scaling:**
```bash
# Update resource requests/limits
kubectl set resources deployment covera \
  --limits=cpu=2,memory=4Gi \
  --requests=cpu=500m,memory=1Gi \
  -n covera
```

---

## Troubleshooting Production Issues

### "Webhook returns 500 error"

```bash
# 1. Check logs
kubectl logs deployment/covera -n covera | grep -i error

# 2. Verify environment variables
kubectl get configmap covera-config -n covera -o yaml

# 3. Test API key
curl -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  https://api.openai.com/v1/models
```

### "Jobs stuck in 'running' state"

```bash
# 1. Check pod resources
kubectl top pods -n covera

# 2. Check sandbox containers
kubectl describe pod <pod-name> -n covera

# 3. Increase timeout
kubectl set env deployment/covera \
  WEBHOOK_TIMEOUT_MS=60000 \
  -n covera
```

### "High LLM API costs"

```bash
# 1. Check token usage
curl -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  https://api.openai.com/v1/usage

# 2. Reduce token count
# - Smaller code slices (adjust CodeSliceExtractor)
# - Use cheaper model (gpt-3.5-turbo)
# - Cache frequently-used prompts
```

---

## Maintenance Tasks

### Weekly

- [ ] Review job success rate
- [ ] Check storage usage (S3)
- [ ] Verify backups (Postgres)
- [ ] Check API quota usage

### Monthly

- [ ] Update Playwright/Covera to latest version
- [ ] Audit generated tests (sample 5)
- [ ] Review and optimize slow jobs
- [ ] Update LLM model selection (if new models available)

### Quarterly

- [ ] Security audit
- [ ] Performance tuning
- [ ] Cost optimization review
- [ ] Disaster recovery drill

---

## Rollback Procedure

```bash
# If deployment fails:

# 1. Revert to previous image
kubectl set image deployment/covera \
  covera=covera:previous-version \
  -n covera

# 2. Wait for rollout
kubectl rollout status deployment/covera -n covera

# 3. Verify
curl http://your-covera-host:3000/health
```

---

## Support & Escalation

**Tier 1 (Self-Service):**
- Check health endpoint: `/health`
- Review job logs via API
- Consult troubleshooting guide

**Tier 2 (Support Team):**
- Access monitoring dashboard
- Review infrastructure metrics
- Check external API connectivity (SeaLights, LLM vendors)

**Tier 3 (Engineering):**
- Code debugging
- Custom configurations
- Performance optimization
