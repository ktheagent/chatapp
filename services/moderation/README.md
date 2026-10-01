# Moderation Service

Responsibilities:
- report intake;
- enforcement cases;
- restriction reason codes;
- appeal lifecycle;
- moderator assignment;
- audit events;
- mass-report abuse detection.

Reports are evidence signals and must not automatically create irreversible enforcement.

## Implementation status

A working development implementation lives in `src/server.js` (Node
built-ins only: `node:http` + `node:sqlite`). It exposes:

- `POST /reports` — file a report (`reporterId`, `targetId`, `targetType`, `reasonCode`, `context?`). Returns `suspiciousReporter` when the same reporter has filed 5+ reports against the same target within an hour — a signal for moderators, never an automatic action.
- `GET /reports` / `GET /reports/:id` — list/inspect reports with their enforcement cases and appeals.
- `POST /reports/:id/action` — a moderator records an explicit enforcement action (`warn`, `restrict_messaging`, `restrict_discovery`, `suspend`, `ban`) with a reason code, scope, and duration.
- `POST /reports/:id/dismiss` — a moderator closes a report with no action.
- `POST /reports/:id/appeal` — the affected user appeals an *actioned* report.
- `POST /reports/:id/appeal/resolve` — a moderator upholds or denies the appeal.
- `GET /health`.

Every state transition is written to an `audit_events` table. Moderator
assignment/roles and a review queue UI are not yet implemented.

## Run

```bash
cd services/moderation
npm install
PORT=9002 node src/server.js
```

## Test

```bash
node --test
```
