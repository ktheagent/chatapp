# Relay Messenger — Foundation

Relay is the working codename for an Africa-first, globally competitive messaging product.

This repository is the **foundation package**, not a claim of a production-ready messenger. It contains:

- architecture and licensing decisions;
- an original dependency-free web UX prototype;
- a Matrix integration boundary;
- local infrastructure templates;
- CI configuration;
- moderation, privacy, low-data, and security requirements;
- automated tests for product-policy invariants.

## Current status

- Product foundation: prepared
- Architecture: documented
- Original UX prototype: runnable locally
- Policy tests: passing in this environment
- Matrix SDK integration: `apps/web` is a working client (login, registration, encrypted 1:1 + group rooms, text, images/files, voice notes, offline queue, foreground notifications, reporting)
- Identity service (stable usernames): implemented, tested (`services/identity`)
- Moderation service (reports/appeals/enforcement): implemented, tested (`services/moderation`)
- Matrix homeserver: configuration prepared; not started in this environment because nested virtualization (needed by Docker Desktop) is unavailable here
- Android/iOS builds: not yet compiled (no native build tooling in this environment)
- E2EE milestone: code path implemented end-to-end; not yet validated against a live homeserver (blocked on the point above)
- Physical-device testing: not performed

## Run the prototype

From the repository root:

```bash
python3 -m http.server 8080 --directory apps/web-prototype
```

Then open `http://localhost:8080`.

The prototype intentionally uses local sample data. It demonstrates UX and product behavior only.

## Run the real Matrix web client + backend services

1. Start a Matrix homeserver (`infrastructure/docker-compose.yml`, see `infrastructure/synapse/README.md`) — requires a machine where Docker can actually run.
2. Start the identity and moderation services:
   ```bash
   cd services/identity && PORT=9001 node src/server.js
   cd services/moderation && PORT=9002 node src/server.js
   ```
3. Start the web client:
   ```bash
   cd apps/web
   npm install
   npm run dev
   ```
   See `apps/web/README.md` for environment variables and the two-account acceptance test.

## Validate foundation

```bash
python3 -m unittest discover -s tests -v
```

Service unit tests:

```bash
cd services/identity && node --test
cd services/moderation && node --test
```

## Architecture direction

The intended production path is an **original client** using Matrix SDKs rather than copying the Element X UI.

See:

- `docs/ARCHITECTURE.md`
- `docs/LICENSE_REVIEW.md`
- `docs/SECURITY.md`
- `docs/ROADMAP.md`
