const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  SealightsClient,
  SealightsApiError,
  McpHost,
  createSealightsTools,
  FileGapSource,
  loadBuildContext,
  normalizeBaseUrl,
  decodeJwtClaim,
} = require("../dist");

const BSID = "81c38595-2a43-47d6-aa52-ebe00423706e";

// Response shapes copied from the SeaLights Public API collection
function coverageBody(methodPercent, methodTotal) {
  const details = (method) => ({ method, branch: null, line: null });
  return {
    data: {
      bsid: BSID,
      entireBuild: {
        isHighPriority: false,
        qrs: details(0),
        overallCoverage: details(methodPercent),
        modifiedCodeCoverage: details(null),
        modifiedTotals: details(0),
        overallTotals: details(methodTotal),
      },
    },
  };
}

async function withServer(routes, run) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization });
    const route = routes[req.url.split("?")[0]];
    res.setHeader("Content-Type", "application/json");
    if (!route) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: { code: 4000, message: "not found" } }));
    }
    res.statusCode = route.status ?? 200;
    res.end(JSON.stringify(route.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(new SealightsClient({ baseUrl, token: "test-token" }), requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const metadata = (status = "Completed") => ({
  appName: "Browser Example",
  branchName: "master",
  build: { bsid: BSID, name: "1.0.0", generated: "2024-01-01T00:00:00.000Z", isIntegration: false },
  buildScanStatus: status,
});

const newHost = (tools) => new McpHost({ profileRepository: async () => ({}) }).registerServer("sealights", tools);

const callGaps = (host) =>
  host.executeTool("sealights", {
    toolName: "query_coverage_gaps",
    input: { buildSessionId: BSID, commitSha: "a".repeat(40), appName: "Browser Example", branch: "master" },
  });

test("client sends the bearer token and unwraps { data }", async () => {
  await withServer({ [`/sl-api/v1/coverage/builds/${BSID}`]: { body: coverageBody(62, 80) } }, async (client, requests) => {
    const coverage = await client.getBuildCoverage(BSID);
    assert.equal(coverage.entireBuild.overallCoverage.method, 62);
    assert.equal(requests[0].auth, "Bearer test-token");
  });
});

test("client surfaces SeaLights errors with status and code", async () => {
  await withServer({}, async (client) => {
    await assert.rejects(client.getBuildMetadata("missing"), (error) => {
      assert.ok(error instanceof SealightsApiError);
      assert.equal(error.status, 404);
      assert.equal(error.code, 4000);
      return true;
    });
  });
});

test("base url strips /api and the x-sl-server JWT claim is read like the demo does", () => {
  assert.equal(normalizeBaseUrl("https://acme.sealights.co/api/"), "https://acme.sealights.co");
  const payload = Buffer.from(JSON.stringify({ "x-sl-server": "https://acme.sealights.co/api" })).toString("base64url");
  assert.equal(decodeJwtClaim(`h.${payload}.s`, "x-sl-server"), "https://acme.sealights.co/api");
});

test("fully covered build yields no gaps without needing a gap source", async () => {
  await withServer(
    {
      [`/sl-api/v1/builds/${BSID}`]: { body: metadata() },
      [`/sl-api/v1/coverage/builds/${BSID}`]: { body: coverageBody(100, 4) },
    },
    async (client) => {
      const result = await callGaps(newHost(createSealightsTools({ client })));
      assert.equal(result.isError, false);
      assert.deepEqual(JSON.parse(result.content), []);
    }
  );
});

test("uncovered build without a gap source fails loudly instead of returning []", async () => {
  await withServer(
    {
      [`/sl-api/v1/builds/${BSID}`]: { body: metadata() },
      [`/sl-api/v1/coverage/builds/${BSID}`]: { body: coverageBody(62, 80) },
    },
    async (client) => {
      const result = await callGaps(newHost(createSealightsTools({ client })));
      assert.equal(result.isError, true);
      assert.match(result.content, /62% method coverage/);
      assert.match(result.content, /30 of 80 methods uncovered/);
    }
  );
});

test("uncovered build returns the gaps from the configured gap source", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covera-gaps-"));
  const gapsFile = path.join(dir, "gaps.json");
  fs.writeFileSync(gapsFile, JSON.stringify([{ methodSignature: "Calculator.add", filePath: "calculator-app/app.js", uncoveredLines: [10, 11] }]));
  try {
    await withServer(
      {
        [`/sl-api/v1/builds/${BSID}`]: { body: metadata() },
        [`/sl-api/v1/coverage/builds/${BSID}`]: { body: coverageBody(62, 80) },
      },
      async (client) => {
        const result = await callGaps(newHost(createSealightsTools({ client, gapSource: new FileGapSource(gapsFile) })));
        assert.equal(result.isError, false);
        assert.deepEqual(JSON.parse(result.content), [
          {
            methodSignature: "Calculator.add",
            filePath: "calculator-app/app.js",
            uncoveredLines: [10, 11],
            branchCoverage: 0,
            relatedComponents: [],
          },
        ]);
      }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a build scan that is still in progress is rejected", async () => {
  await withServer({ [`/sl-api/v1/builds/${BSID}`]: { body: metadata("In Progress") } }, async (client) => {
    const result = await callGaps(newHost(createSealightsTools({ client })));
    assert.equal(result.isError, true);
    assert.match(result.content, /In Progress/);
  });
});

test("unregistered tools return an error result rather than fake data", async () => {
  const host = new McpHost({ profileRepository: async () => ({}) });
  const result = await host.executeTool("codebase", { toolName: "trace_code_path", input: {} });
  assert.equal(result.isError, true);
});

test("build context reads buildSessionId from the slnodejs file and the commit SHA from git", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covera-ctx-"));
  try {
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
    git("init", "-q");
    fs.writeFileSync(path.join(dir, "buildSessionId"), `${BSID}\n`);
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");

    const context = loadBuildContext({ devRepoPath: dir });
    assert.equal(context.buildSessionId, BSID);
    assert.equal(context.commitSha, git("rev-parse", "HEAD"));
    assert.equal(context.commitShaSource, "git");

    assert.throws(() => loadBuildContext({ devRepoPath: dir, commitSha: "abc123" }), /40-character/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
