/**
 * Layer 1: Event-Driven Orchestration
 * 
 * Webhook listener that:
 * 1. Receives SeaLights/CI webhooks
 * 2. Spins up ephemeral sandboxes
 * 3. Coordinates the entire workflow
 */

import express, { Request, Response } from "express";

export interface WebhookPayload {
  appName: string;
  branch: string;
  buildSessionId: string;
  devRepoUrl: string;
  testRepoUrl: string;
  commitSha: string;
}

export interface JobMetadata {
  jobId: string;
  timestamp: Date;
  webhook: WebhookPayload;
  status: "pending" | "running" | "completed" | "failed";
  sandboxId?: string;
  artifactUrl?: string;
  error?: string;
}

/**
 * Webhook Server for SeaLights & CI events
 */
export class WebhookServer {
  private app: express.Application;
  private port: number;
  private jobQueue: Map<string, JobMetadata> = new Map();
  private sandboxOrchestrator: SandboxOrchestrator;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.sandboxOrchestrator = new SandboxOrchestrator();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use(express.json());

    // Health check
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "healthy", timestamp: new Date() });
    });

    // Receive SeaLights webhook
    this.app.post(
      "/webhooks/sealights",
      async (req: Request, res: Response) => {
        try {
          const payload: WebhookPayload = req.body;
          console.log("📨 Received SeaLights webhook:", payload);

          // Validate webhook
          if (!this.validateWebhook(payload)) {
            return res.status(400).json({ error: "Invalid webhook payload" });
          }

          // Queue job
          const jobId = this.generateJobId();
          const job: JobMetadata = {
            jobId,
            timestamp: new Date(),
            webhook: payload,
            status: "pending",
          };

          this.jobQueue.set(jobId, job);
          console.log(`✓ Queued job: ${jobId}`);

          // Acknowledge webhook immediately (async processing)
          res.json({ jobId, status: "queued" });

          // Process asynchronously
          this.processJob(jobId).catch((error) => {
            console.error(`✗ Job ${jobId} failed:`, error);
            const job = this.jobQueue.get(jobId);
            if (job) {
              job.status = "failed";
              job.error = error.message;
            }
          });
        } catch (error) {
          console.error("Webhook processing error:", error);
          res.status(500).json({
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // Job status endpoint
    this.app.get("/jobs/:jobId", (req: Request, res: Response) => {
      const job = this.jobQueue.get(req.params.jobId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      res.json(job);
    });
  }

  private validateWebhook(payload: WebhookPayload): boolean {
    return (
      !!payload.appName &&
      !!payload.branch &&
      !!payload.buildSessionId &&
      !!payload.devRepoUrl &&
      !!payload.testRepoUrl &&
      !!payload.commitSha
    );
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private async processJob(jobId: string): Promise<void> {
    const job = this.jobQueue.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    job.status = "running";
    console.log(`🚀 Starting job: ${jobId}`);

    try {
      // Step 1: Spin up sandbox
      console.log("→ Spinning up ephemeral sandbox...");
      const sandboxId = await this.sandboxOrchestrator.createSandbox({
        devRepoUrl: job.webhook.devRepoUrl,
        devRepoSha: job.webhook.commitSha,
        testRepoUrl: job.webhook.testRepoUrl,
        buildSessionId: job.webhook.buildSessionId,
      });

      job.sandboxId = sandboxId;
      console.log(`✓ Sandbox created: ${sandboxId}`);

      // Step 2: Run orchestration inside sandbox
      console.log("→ Running test generation workflow...");
      const result = await this.sandboxOrchestrator.executeWorkflow(
        sandboxId,
        job.webhook
      );

      // Step 3: Upload artifacts
      console.log("→ Uploading artifacts...");
      job.artifactUrl = await this.uploadArtifacts(jobId, result);

      job.status = "completed";
      console.log(`✓ Job completed: ${jobId}`);
      console.log(`✓ Artifacts: ${job.artifactUrl}`);
    } finally {
      // Cleanup: Destroy sandbox
      if (job.sandboxId) {
        console.log("→ Cleaning up sandbox...");
        await this.sandboxOrchestrator.destroySandbox(job.sandboxId);
      }
    }
  }

  private async uploadArtifacts(
    jobId: string,
    result: Record<string, unknown>
  ): Promise<string> {
    // Upload to S3 or cloud storage
    // For now, return stub URL
    return `s3://covera-artifacts/${jobId}/results.json`;
  }

  start(): void {
    this.app.listen(this.port, () => {
      console.log(`🌐 Webhook server running on port ${this.port}`);
      console.log(
        `   POST /webhooks/sealights -- Receive coverage webhooks`
      );
      console.log(
        `   GET  /jobs/:jobId       -- Check job status`
      );
    });
  }
}

/**
 * Sandbox Orchestrator
 * Manages ephemeral containers for test generation
 */
export class SandboxOrchestrator {
  private activeContainers: Map<string, string> = new Map();

  /**
   * Create ephemeral sandbox container
   */
  async createSandbox(config: {
    devRepoUrl: string;
    devRepoSha: string;
    testRepoUrl: string;
    buildSessionId: string;
  }): Promise<string> {
    // In production: use Kubernetes API or Docker SDK
    // For now: simulate container creation
    const sandboxId = `sandbox_${Date.now()}`;
    this.activeContainers.set(sandboxId, config.devRepoUrl);

    console.log(`  🐳 Docker/K8s container: ${sandboxId}`);
    console.log(`     Dev repo: ${config.devRepoUrl} @ ${config.devRepoSha}`);
    console.log(`     Test repo: ${config.testRepoUrl}`);

    return sandboxId;
  }

  /**
   * Execute workflow inside sandbox
   */
  async executeWorkflow(
    sandboxId: string,
    webhook: WebhookPayload
  ): Promise<Record<string, unknown>> {
    // In production: execute Covera orchestration inside the container
    // For now: return stub result
    console.log(`  Executing workflow in ${sandboxId}`);

    return {
      sandboxId,
      generatedTestFile: "new-test-spec.ts",
      verificationPassed: true,
      coverageDelta: 0.15,
      artifactSize: 2048,
    };
  }

  /**
   * Destroy sandbox (cleanup)
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    this.activeContainers.delete(sandboxId);
    console.log(`  ✓ Sandbox destroyed: ${sandboxId}`);
  }
}

// Start only when run directly (node dist/server.js), not when imported
if (require.main === module) {
  new WebhookServer(parseInt(process.env.PORT || "3000", 10)).start();
}
