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
- [ ] low-data chaos tests
- [x] groups (encrypted multi-invite rooms in the web client)
- [x] reports/appeals (`services/moderation`, wired into the web client)
- [ ] recovery hardening
