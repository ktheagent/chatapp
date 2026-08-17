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
- Matrix SDK integration: interface prepared; SDK package not installed in this environment
- Matrix homeserver: configuration prepared; not started here because Docker is unavailable
- Android/iOS builds: not yet compiled
- E2EE milestone: not yet validated
- Physical-device testing: not performed

## Run the prototype

From the repository root:

```bash
python3 -m http.server 8080 --directory apps/web-prototype
```

Then open `http://localhost:8080`.

The prototype intentionally uses local sample data. It demonstrates UX and product behavior only.

## Validate foundation

```bash
python3 -m unittest discover -s tests -v
```

## Architecture direction

The intended production path is an **original client** using Matrix SDKs rather than copying the Element X UI.

See:

- `docs/ARCHITECTURE.md`
- `docs/LICENSE_REVIEW.md`
- `docs/SECURITY.md`
- `docs/ROADMAP.md`
