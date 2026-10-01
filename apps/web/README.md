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
- local echo / retry behavior supplied by the Matrix SDK;
- **low-data mode** ("data saver"): images, voice notes and files render as a tap-to-load placeholder (showing the file size) instead of downloading automatically, on by default — see "Low-data mode" below;
- **multi-language UI**: English, Kiswahili, Français, Hausa, Yorùbá and Nigerian Pidgin, selectable from a language switcher on every screen — see "Language support" below;
- **recovery key / cross-signing setup**: a user-triggered "🔐 Security" flow to bootstrap cross-signing and secret storage so encrypted message history can be restored on a new device — see "Recovery keys" below.

## Low-data mode

Many of Relay's target markets have slow or metered mobile data. Low-data mode (on by default, toggleable from the "Data saver" button in the sidebar) renders a lightweight "tap to load/download" placeholder — showing the media type and byte size — instead of eagerly downloading images, voice notes and files. Tapping a placeholder reveals that one piece of media for the current browser session only; revealed media is intentionally **not** persisted, so reopening the app never silently re-spends data. This implements the "thumbnail-first / download-on-demand" guidance from `docs/ARCHITECTURE.md`'s low-data architecture section.

## Language support

A language switcher (`<select>`) appears on the login, registration and main screens. The selected language is persisted in `localStorage` and used for all static UI chrome. Supported languages today: English, Kiswahili, Français, Hausa, Yorùbá, and Naijá (Nigerian Pidgin). Translations live in `src/i18n.js`; add a new locale by adding an entry to `SUPPORTED_LANGUAGES` and a matching key set to `STRINGS`.

## Recovery keys

Open "🔐 Security" from the sidebar to check recovery-key status. "Set up recovery key" bootstraps cross-signing (re-confirming your account password) and secret storage, then displays a one-time recovery key to save somewhere safe — Relay cannot recover it for you. On a new device, Relay silently attempts to unlock existing secret storage on first sync; if that fails (or to retry manually), use "Unlock with recovery key" from the same dialog, which prompts for the saved recovery key. This implements the roadmap's "recovery hardening" milestone using `matrix-js-sdk`'s documented `bootstrapCrossSigning`/`bootstrapSecretStorage` crypto APIs. **Not yet exercised against a live two-account homeserver in CI** — see `docs/KNOWN_LIMITATIONS.md`.

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

Before public beta, harden credential storage and complete CSP/XSS and device verification work. Cross-signing/secret-storage (recovery keys) is implemented — see "Recovery keys" above — but has not yet been exercised against a live homeserver in automated CI.

Push notifications in this milestone only fire while the browser tab/process is open (the Notifications API, not a real push subscription). There is no push-registration backend; closed-browser delivery is a future milestone.

The SDK crypto store is initialized through `initRustCrypto()`.

## Tests

Pure-function unit tests (`src/utils.js`, `src/i18n.js`) run with Node's built-in test runner:

```bash
npm test
```

The real two-account end-to-end encryption acceptance test is separate — see `npm run test:e2ee-browser` and `.github/workflows/matrix-e2ee-browser.yml`.

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
