import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

// Relay Moderation Service
//
// Reports are evidence signals, not automatic proof. Enforcement actions
// are a separate, explicit step taken by a moderator and always carry a
// reason code, scope, and start time so they can be audited and appealed.

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RELAY_MODERATION_DATA_DIR || join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, "moderation.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    context TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS enforcement_cases (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    action TEXT NOT NULL,
    scope TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    policy_ref TEXT,
    duration_hours INTEGER,
    starts_at TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS appeals (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    resolution_note TEXT,
    moderator_id TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    report_id TEXT,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_id);
  CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
`);

const REASON_CODES = new Set([
  "spam", "harassment", "impersonation", "csam", "violence", "scam_fraud",
  "hate_speech", "self_harm", "illegal_goods", "other",
]);
const TARGET_TYPES = new Set(["user", "room", "message", "business"]);
const ACTIONS = new Set(["warn", "restrict_messaging", "restrict_discovery", "suspend", "ban"]);

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

function audit(reportId, actorId, action, detail) {
  db.prepare(
    `INSERT INTO audit_events (id, report_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), reportId || null, actorId, action, detail ? JSON.stringify(detail) : null, nowIso());
}

// Mass-report abuse detection: flag (not block) when the same reporter
// files an unusually high number of reports against the same target in a
// short window. A human moderator decides what, if anything, to do.
const MASS_REPORT_WINDOW_MS = 60 * 60 * 1000;
const MASS_REPORT_THRESHOLD = 5;
function isSuspiciousReporter(reporterId, targetId) {
  const since = new Date(Date.now() - MASS_REPORT_WINDOW_MS).toISOString();
  const row = db.prepare(
    `SELECT COUNT(*) as n FROM reports WHERE reporter_id = ? AND target_id = ? AND created_at >= ?`
  ).get(reporterId, targetId, since);
  return row.n >= MASS_REPORT_THRESHOLD;
}

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

function reportWithChildren(id) {
  const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
  if (!report) return null;
  const cases = db.prepare("SELECT * FROM enforcement_cases WHERE report_id = ? ORDER BY created_at").all(id);
  const appeals = db.prepare("SELECT * FROM appeals WHERE report_id = ? ORDER BY created_at").all(id);
  return { ...report, cases, appeals };
}

export function createApp() {
  return async function handler(req, res) {
    const clientKey = req.socket.remoteAddress || "unknown";
    const url = new URL(req.url, "http://localhost");

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { status: "ok", service: "moderation" });
      }

      if (req.method === "POST" && url.pathname === "/reports") {
        if (rateLimited(`report:${clientKey}`, 20, 60_000)) return send(res, 429, { error: "Too many requests" });
        const body = await readJson(req);
        const reporterId = String(body.reporterId || "").trim();
        const targetId = String(body.targetId || "").trim();
        const targetType = String(body.targetType || "").trim();
        const reasonCode = String(body.reasonCode || "").trim();
        const context = body.context ? String(body.context).slice(0, 2000) : null;

        if (!reporterId || !targetId) return send(res, 400, { error: "missing_fields" });
        if (!TARGET_TYPES.has(targetType)) return send(res, 400, { error: "invalid_target_type" });
        if (!REASON_CODES.has(reasonCode)) return send(res, 400, { error: "invalid_reason_code" });

        const id = randomUUID();
        const ts = nowIso();
        db.prepare(
          `INSERT INTO reports (id, reporter_id, target_id, target_type, reason_code, context, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`
        ).run(id, reporterId, targetId, targetType, reasonCode, context, ts, ts);
        // Evaluated after insert so this report itself counts toward the window.
        const suspicious = isSuspiciousReporter(reporterId, targetId);
        audit(id, reporterId, "report_filed", { suspicious });

        return send(res, 201, { id, status: "open", suspiciousReporter: suspicious });
      }

      if (req.method === "GET" && url.pathname === "/reports") {
        const status = url.searchParams.get("status");
        const rows = status
          ? db.prepare("SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC").all(status)
          : db.prepare("SELECT * FROM reports ORDER BY created_at DESC").all();
        return send(res, 200, { reports: rows });
      }

      const idMatch = url.pathname.match(/^\/reports\/([^/]+)$/);
      if (req.method === "GET" && idMatch) {
        const report = reportWithChildren(idMatch[1]);
        if (!report) return send(res, 404, { error: "not_found" });
        return send(res, 200, report);
      }

      const actionMatch = url.pathname.match(/^\/reports\/([^/]+)\/action$/);
      if (req.method === "POST" && actionMatch) {
        const reportId = actionMatch[1];
        const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId);
        if (!report) return send(res, 404, { error: "not_found" });

        const body = await readJson(req);
        const action = String(body.action || "").trim();
        const reasonCode = String(body.reasonCode || "").trim();
        const moderatorId = String(body.moderatorId || "").trim();
        const scope = String(body.scope || "account").trim();
        const durationHours = body.durationHours != null ? Number(body.durationHours) : null;
        const policyRef = body.policyRef ? String(body.policyRef) : null;

        if (!ACTIONS.has(action)) return send(res, 400, { error: "invalid_action" });
        if (!REASON_CODES.has(reasonCode)) return send(res, 400, { error: "invalid_reason_code" });
        if (!moderatorId) return send(res, 400, { error: "missing_moderator_id" });

        const caseId = randomUUID();
        const ts = nowIso();
        db.prepare(
          `INSERT INTO enforcement_cases (id, report_id, action, scope, reason_code, policy_ref, duration_hours, starts_at, moderator_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(caseId, reportId, action, scope, reasonCode, policyRef, durationHours, ts, moderatorId, ts);
        db.prepare("UPDATE reports SET status = 'actioned', updated_at = ? WHERE id = ?").run(ts, reportId);
        audit(reportId, moderatorId, "enforcement_action", { action, scope, reasonCode, durationHours });

        return send(res, 201, { caseId, reportId, action, status: "actioned" });
      }

      const dismissMatch = url.pathname.match(/^\/reports\/([^/]+)\/dismiss$/);
      if (req.method === "POST" && dismissMatch) {
        const reportId = dismissMatch[1];
        const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId);
        if (!report) return send(res, 404, { error: "not_found" });
        const body = await readJson(req);
        const moderatorId = String(body.moderatorId || "").trim();
        if (!moderatorId) return send(res, 400, { error: "missing_moderator_id" });
        db.prepare("UPDATE reports SET status = 'dismissed', updated_at = ? WHERE id = ?").run(nowIso(), reportId);
        audit(reportId, moderatorId, "report_dismissed", { note: body.note || null });
        return send(res, 200, { reportId, status: "dismissed" });
      }

      const appealMatch = url.pathname.match(/^\/reports\/([^/]+)\/appeal$/);
      if (req.method === "POST" && appealMatch) {
        const reportId = appealMatch[1];
        const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId);
        if (!report) return send(res, 404, { error: "not_found" });
        if (report.status !== "actioned") {
          return send(res, 409, { error: "not_appealable", detail: "Only actioned reports can be appealed." });
        }
        const body = await readJson(req);
        const message = String(body.message || "").trim().slice(0, 4000);
        if (!message) return send(res, 400, { error: "missing_message" });

        const appealId = randomUUID();
        const ts = nowIso();
        db.prepare(
          `INSERT INTO appeals (id, report_id, message, status, created_at) VALUES (?, ?, ?, 'pending', ?)`
        ).run(appealId, reportId, message, ts);
        db.prepare("UPDATE reports SET status = 'appealed', updated_at = ? WHERE id = ?").run(ts, reportId);
        audit(reportId, report.reporter_id, "appeal_filed", {});

        return send(res, 201, { appealId, reportId, status: "appealed" });
      }

      const appealResolveMatch = url.pathname.match(/^\/reports\/([^/]+)\/appeal\/resolve$/);
      if (req.method === "POST" && appealResolveMatch) {
        const reportId = appealResolveMatch[1];
        const appeal = db.prepare("SELECT * FROM appeals WHERE report_id = ? ORDER BY created_at DESC LIMIT 1").get(reportId);
        if (!appeal) return send(res, 404, { error: "no_pending_appeal" });
        const body = await readJson(req);
        const decision = String(body.decision || "").trim();
        const moderatorId = String(body.moderatorId || "").trim();
        if (!["upheld", "denied"].includes(decision)) return send(res, 400, { error: "invalid_decision" });
        if (!moderatorId) return send(res, 400, { error: "missing_moderator_id" });

        const ts = nowIso();
        db.prepare(
          "UPDATE appeals SET status = ?, resolution_note = ?, moderator_id = ?, resolved_at = ? WHERE id = ?"
        ).run(decision, body.note || null, moderatorId, ts, appeal.id);
        const newReportStatus = decision === "upheld" ? "appeal_upheld" : "appeal_denied";
        db.prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ?").run(newReportStatus, ts, reportId);
        audit(reportId, moderatorId, "appeal_resolved", { decision });

        return send(res, 200, { reportId, appealId: appeal.id, status: newReportStatus });
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
  const port = Number(process.env.PORT || 9002);
  createServer(createApp()).listen(port, () => {
    console.log(`Relay moderation service listening on :${port}`);
  });
}
