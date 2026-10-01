# Roadmap

## M0 — Foundation
- [x] GitHub repository
- [x] architecture decision
- [x] original design prototype
- [x] Matrix adapter boundary
- [x] infrastructure template
- [x] CI foundation
- [x] policy tests
- [ ] real Matrix SDK dependency installation
- [ ] development homeserver started

## M1 — Messaging Alpha
- [x] registration (web client registration screen + Matrix `m.login.dummy` account creation)
- [x] stable username service (`services/identity`)
- [x] encrypted 1:1 rooms
- [x] message timeline
- [x] send/receive text
- [x] images/files
- [x] voice notes
- [x] offline queue
- [x] push notifications (foreground-only web Notifications API; no push server yet)
- [ ] restart/persistence test (requires a running homeserver + two real accounts; not executed in this environment)

## M2 — Private Beta
- [ ] Android physical-device validation
- [ ] iOS physical-device validation
- [ ] 1:1 calls
- [x] low-data mode (download-on-demand media placeholders, on by default in the web client)
- [ ] low-data chaos tests (automated network-throttling test harness still needed)
- [x] groups (encrypted multi-invite rooms in the web client)
- [x] reports/appeals (`services/moderation`, wired into the web client)
- [x] recovery hardening (cross-signing + secret storage via `matrix-js-sdk`'s crypto API, user-triggered "Security" flow in the web client; not yet exercised against a live homeserver in CI)
- [x] multi-language UI (English, Kiswahili, Français, Hausa, Yorùbá, Nigerian Pidgin)
