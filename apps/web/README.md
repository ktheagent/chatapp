# Relay Web — Matrix vertical slice

This is the first client that uses a real Matrix SDK rather than sample chat data.

## Current scope

- password login against a configurable Matrix homeserver;
- session restoration across browser restarts;
- Rust crypto initialization through `matrix-js-sdk`;
- Matrix sync;
- joined room list;
- encrypted direct-room creation;
- real text send/receive;
- local echo / retry behavior supplied by the Matrix SDK.

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
