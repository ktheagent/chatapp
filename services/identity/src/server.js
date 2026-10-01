import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Relay Identity Service
//
// Exposes a stable, user-chosen public handle (e.g. "@ama") that is
// independent of the underlying Matrix user id and independent of any
// phone number. This lets a user change phone numbers or even move to a
// different homeserver account without breaking how other people find them.

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RELAY_IDENTITY_DATA_DIR || join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, "identity.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS usernames (
    username TEXT PRIMARY KEY,
    matrix_user_id TEXT NOT NULL,
    phone_e164 TEXT,
    phone_visible INTEGER NOT NULL DEFAULT 0,
    business_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_usernames_matrix_user_id ON usernames(matrix_user_id);
`);

// Reserved words we never hand out as a public handle.
const RESERVED = new Set(["admin", "root", "support", "relay", "moderator", "system", "help", "security"]);
const USERNAME_RE = /^[a-z][a-z0-9_]{2,31}$/;

function normalizeUsername(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isValidUsername(username) {
  return USERNAME_RE.test(username) && !RESERVED.has(username);
}

// Very small fixed-window rate limiter keyed by remote address + route,
// enough to blunt naive username-enumeration / registration spam in dev.
const rateBuckets = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    rateBuckets.set(key, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function nowIso() {
  return new Date().toISOString();
}

export function createApp() {
  return async function handler(req, res) {
    const clientKey = req.socket.remoteAddress || "unknown";
    const url = new URL(req.url, "http://localhost");

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { status: "ok", service: "identity" });
      }

      if (req.method === "POST" && url.pathname === "/usernames/check") {
        if (rateLimited(`check:${clientKey}`, 30, 60_000)) return send(res, 429, { error: "Too many requests" });
        const body = await readJson(req);
        const username = normalizeUsername(body.username);
        if (!isValidUsername(username)) {
          return send(res, 200, { username, available: false, reason: "invalid_format" });
        }
        const row = db.prepare("SELECT username FROM usernames WHERE username = ?").get(username);
        return send(res, 200, { username, available: !row });
      }

      if (req.method === "POST" && url.pathname === "/usernames/register") {
        if (rateLimited(`register:${clientKey}`, 10, 60_000)) return send(res, 429, { error: "Too many requests" });
        const body = await readJson(req);
        const username = normalizeUsername(body.username);
        const matrixUserId = String(body.matrixUserId || "").trim();
        const phone = body.phoneE164 ? String(body.phoneE164).trim() : null;
        const phoneVisible = Boolean(body.phoneVisible);

        if (!isValidUsername(username)) {
          return send(res, 400, { error: "invalid_username", detail: "3-32 lowercase letters, numbers, underscore; must start with a letter." });
        }
        if (!matrixUserId.startsWith("@") || !matrixUserId.includes(":")) {
          return send(res, 400, { error: "invalid_matrix_user_id" });
        }

        const existing = db.prepare("SELECT username FROM usernames WHERE username = ?").get(username);
        if (existing) return send(res, 409, { error: "username_taken" });

        const ts = nowIso();
        db.prepare(
          `INSERT INTO usernames (username, matrix_user_id, phone_e164, phone_visible, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(username, matrixUserId, phone, phoneVisible ? 1 : 0, ts, ts);

        return send(res, 201, { username, matrixUserId, phoneVisible });
      }

      if (req.method === "POST" && url.pathname === "/usernames/migrate") {
        // Controlled migration: point an existing stable handle at a new
        // Matrix user id (e.g. after a homeserver move). Requires proof
        // of ownership of the *old* matrixUserId in a production system;
        // this development endpoint trusts the caller (Relay API) to have
        // already verified that out of band.
        const body = await readJson(req);
        const username = normalizeUsername(body.username);
        const newMatrixUserId = String(body.newMatrixUserId || "").trim();
        if (!isValidUsername(username) || !newMatrixUserId.startsWith("@")) {
          return send(res, 400, { error: "invalid_request" });
        }
        const row = db.prepare("SELECT username FROM usernames WHERE username = ?").get(username);
        if (!row) return send(res, 404, { error: "not_found" });
        db.prepare("UPDATE usernames SET matrix_user_id = ?, updated_at = ? WHERE username = ?")
          .run(newMatrixUserId, nowIso(), username);
        return send(res, 200, { username, matrixUserId: newMatrixUserId });
      }

      const lookupMatch = url.pathname.match(/^\/usernames\/([^/]+)$/);
      if (req.method === "GET" && lookupMatch) {
        if (rateLimited(`lookup:${clientKey}`, 60, 60_000)) return send(res, 429, { error: "Too many requests" });
        const username = normalizeUsername(decodeURIComponent(lookupMatch[1]));
        const row = db.prepare("SELECT username, matrix_user_id as matrixUserId, phone_visible as phoneVisible, phone_e164 as phoneE164 FROM usernames WHERE username = ?").get(username);
        if (!row) return send(res, 404, { error: "not_found" });
        return send(res, 200, {
          username: row.username,
          matrixUserId: row.matrixUserId,
          phoneE164: row.phoneVisible ? row.phoneE164 : null,
        });
      }

      return send(res, 404, { error: "not_found" });
    } catch (err) {
      return send(res, 400, { error: "bad_request", detail: err?.message || "unknown error" });
    }
  };
}

export function closeDb() {
  db.close();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 9001);
  createServer(createApp()).listen(port, () => {
    console.log(`Relay identity service listening on :${port}`);
  });
}
