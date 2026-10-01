# Relay Web — Matrix vertical slice

This is the first client that uses a real Matrix SDK rather than sample chat data.

## Current scope

- password login against a configurable Matrix homeserver;
- registration: claim a stable `@handle` and create a matching Matrix account (`m.login.dummy`), then register the handle with the Relay identity service;
- session restoration across browser restarts;
- Rust crypto initialization through `matrix-js-sdk`;
- Matrix sync;
- joined room list;
- encrypted direct-room creation;
- encrypted group creation (multiple invitees + room name);
- real text send/receive;
- images and arbitrary file attachments (uploaded via the Matrix content repository);
- voice notes recorded in-browser with `MediaRecorder`;
- an offline outbox: text messages that fail to send while offline are persisted in `localStorage` and automatically retried when the browser comes back online;
- foreground push notifications via the Notifications API (no push server yet — see limitations);
- reporting a message's sender to the Relay moderation service;
- local echo / retry behavior supplied by the Matrix SDK.

## Configuration

Set these as Vite env vars (e.g. in `apps/web/.env.local`):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_MATRIX_HOMESERVER_URL` | `http://localhost:8008` | Default homeserver shown on the login/register forms |
| `VITE_RELAY_IDENTITY_URL` | `http://localhost:9001` | Stable-username service (`services/identity`) |
| `VITE_RELAY_MODERATION_URL` | `http://localhost:9002` | Report intake service (`services/moderation`) |

## Run

```bash
npm install
npm run dev
```

Set the homeserver with:

```bash
VITE_MATRIX_HOMESERVER_URL=http://localhost:8008 npm run dev
```

## Security status

This is a development milestone. The access token is currently persisted in browser `localStorage` to exercise restart/session restoration. Do **not** call this production credential storage.

Before public beta, harden credential storage and complete CSP/XSS, device verification, recovery, cross-signing, and secret-storage work.

Push notifications in this milestone only fire while the browser tab/process is open (the Notifications API, not a real push subscription). There is no push-registration backend; closed-browser delivery is a future milestone.

The SDK crypto store is initialized through `initRustCrypto()`.

## Acceptance test

Use two independent browser profiles and two Matrix test accounts:

1. sign in as User A;
2. sign in as User B in a separate profile;
3. User A creates an encrypted direct room with User B;
4. both clients sync;
5. exchange messages;
6. close both browsers;
7. reopen;
8. confirm session restoration and room history.

Do not mark this milestone complete until that has actually been executed.
