# Identity Service

Responsibilities:
- stable Relay public username;
- optional phone identities;
- username lookup;
- phone-number visibility policy;
- controlled number migration;
- business identity link.

Phone country code must not be used as a negative trust signal by itself.

## Implementation status

A working development implementation lives in `src/server.js`. It uses
Node's built-in `node:http` and `node:sqlite` (no external dependencies)
and exposes:

- `POST /usernames/check` — `{ username }` → availability.
- `POST /usernames/register` — `{ username, matrixUserId, phoneE164?, phoneVisible? }` → claims a stable handle.
- `GET /usernames/:username` — resolves a handle to its current Matrix user id (and phone, only if the owner opted in to visibility).
- `POST /usernames/migrate` — `{ username, newMatrixUserId }` → repoints a handle at a new Matrix account.
- `GET /health`.

CORS is permissive by default (`Access-Control-Allow-Origin: *`) so the
browser-based web client can call this service directly. Set
`RELAY_CORS_ORIGIN` to a specific origin before production.

Usernames are validated against a reserved word list and a
`[a-z][a-z0-9_]{2,31}` pattern, and basic per-IP rate limiting guards the
check/register/lookup routes. Business identity linking is not yet
implemented (depends on the Business Service).

## Run

```bash
cd services/identity
npm install   # no dependencies today, but keeps the lockfile consistent
PORT=9001 node src/server.js
```

## Test

```bash
node --test
```
