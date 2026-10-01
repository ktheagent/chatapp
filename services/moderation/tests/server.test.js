import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server, baseUrl, dataDir, closeDb;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "relay-moderation-test-"));
  process.env.RELAY_MODERATION_DATA_DIR = dataDir;
  const mod = await import("../src/server.js");
  closeDb = mod.closeDb;
  server = createServer(mod.createApp());
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function post(path, body) {
  const r = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function get(path) {
  const r = await fetch(`${baseUrl}${path}`);
  return { status: r.status, body: await r.json() };
}

test("health check responds ok", async () => {
  const r = await get("/health");
  assert.equal(r.status, 200);
});

test("sends permissive CORS headers so the browser-based web client can call this service", async () => {
  const r = await fetch(`${baseUrl}/health`);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("answers CORS preflight requests", async () => {
  const r = await fetch(`${baseUrl}/reports`, { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.ok(r.headers.get("access-control-allow-methods")?.includes("POST"));
});

test("files a report with required fields", async () => {
  const r = await post("/reports", {
    reporterId: "@ama:example.org", targetId: "@bad_actor:example.org", targetType: "user", reasonCode: "spam",
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, "open");
  assert.equal(r.body.suspiciousReporter, false);
});

test("rejects invalid reason code", async () => {
  const r = await post("/reports", {
    reporterId: "@ama:example.org", targetId: "@x:example.org", targetType: "user", reasonCode: "nonsense",
  });
  assert.equal(r.status, 400);
});

test("flags mass-reporting against the same target", async () => {
  const reporter = "@mass_reporter:example.org";
  const target = "@target:example.org";
  let last;
  for (let i = 0; i < 5; i++) {
    last = await post("/reports", { reporterId: reporter, targetId: target, targetType: "user", reasonCode: "spam" });
  }
  assert.equal(last.body.suspiciousReporter, true);
});

test("enforcement action, then appeal lifecycle", async () => {
  const filed = await post("/reports", {
    reporterId: "@reporter:example.org", targetId: "@wrongdoer:example.org", targetType: "user", reasonCode: "harassment",
  });
  const reportId = filed.body.id;

  const action = await post(`/reports/${reportId}/action`, {
    action: "restrict_messaging", reasonCode: "harassment", moderatorId: "@mod1:example.org", scope: "account", durationHours: 48,
  });
  assert.equal(action.status, 201);

  let detail = await get(`/reports/${reportId}`);
  assert.equal(detail.body.status, "actioned");
  assert.equal(detail.body.cases.length, 1);

  const appeal = await post(`/reports/${reportId}/appeal`, { message: "This was a misunderstanding." });
  assert.equal(appeal.status, 201);

  detail = await get(`/reports/${reportId}`);
  assert.equal(detail.body.status, "appealed");

  const resolve = await post(`/reports/${reportId}/appeal/resolve`, { decision: "upheld", moderatorId: "@mod2:example.org" });
  assert.equal(resolve.status, 200);

  detail = await get(`/reports/${reportId}`);
  assert.equal(detail.body.status, "appeal_upheld");
  assert.equal(detail.body.appeals[0].status, "upheld");
});

test("cannot appeal a report that has not been actioned", async () => {
  const filed = await post("/reports", {
    reporterId: "@reporter2:example.org", targetId: "@someone:example.org", targetType: "user", reasonCode: "spam",
  });
  const appeal = await post(`/reports/${filed.body.id}/appeal`, { message: "please reconsider" });
  assert.equal(appeal.status, 409);
});
