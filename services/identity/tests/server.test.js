import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server, baseUrl, dataDir, closeDb;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "relay-identity-test-"));
  process.env.RELAY_IDENTITY_DATA_DIR = dataDir;
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
  assert.equal(r.body.status, "ok");
});

test("sends permissive CORS headers so the browser-based web client can call this service", async () => {
  const r = await fetch(`${baseUrl}/health`);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("answers CORS preflight requests", async () => {
  const r = await fetch(`${baseUrl}/usernames/check`, { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.ok(r.headers.get("access-control-allow-methods")?.includes("POST"));
});

test("username availability check", async () => {
  const r = await post("/usernames/check", { username: "ama" });
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
});

test("rejects invalid username formats", async () => {
  const r = await post("/usernames/check", { username: "a" });
  assert.equal(r.body.available, false);
  assert.equal(r.body.reason, "invalid_format");
});

test("rejects reserved usernames", async () => {
  const r = await post("/usernames/register", { username: "admin", matrixUserId: "@admin:example.org" });
  assert.equal(r.status, 400);
});

test("registers a new stable username and resolves it", async () => {
  const reg = await post("/usernames/register", { username: "kwame", matrixUserId: "@kwame_1:example.org" });
  assert.equal(reg.status, 201);

  const lookup = await get("/usernames/kwame");
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.matrixUserId, "@kwame_1:example.org");
  assert.equal(lookup.body.phoneE164, null, "phone hidden by default");
});

test("rejects duplicate username registration", async () => {
  await post("/usernames/register", { username: "amina", matrixUserId: "@amina1:example.org" });
  const dup = await post("/usernames/register", { username: "amina", matrixUserId: "@amina2:example.org" });
  assert.equal(dup.status, 409);
});

test("migrates a username to a new matrix user id", async () => {
  await post("/usernames/register", { username: "tunde", matrixUserId: "@tunde_old:example.org" });
  const migrate = await post("/usernames/migrate", { username: "tunde", newMatrixUserId: "@tunde_new:example.org" });
  assert.equal(migrate.status, 200);

  const lookup = await get("/usernames/tunde");
  assert.equal(lookup.body.matrixUserId, "@tunde_new:example.org");
});

test("unknown username returns 404", async () => {
  const r = await get("/usernames/does-not-exist-user");
  assert.equal(r.status, 404);
});
