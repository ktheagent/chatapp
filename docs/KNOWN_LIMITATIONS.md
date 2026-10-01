# Known Limitations

1. The `apps/web-prototype` client is a UX-only harness using local sample data; `apps/web` is the real Matrix client.
2. `apps/web` now implements login, registration, encrypted 1:1 rooms, groups, text, images/files, voice notes, an offline send queue, foreground push notifications, and reporting — but none of it has been exercised against a live homeserver in this environment (see below).
3. The development homeserver could not be started in this sandboxed environment: Docker Desktop requires nested virtualization, which is unavailable here ("A hypervisor has been detected" / Docker Desktop fails to start). `infrastructure/docker-compose.yml` and the Synapse config instructions are unchanged and should work on a normal workstation or in GitHub Actions (see `.github/workflows/matrix-smoke.yml`).
4. Because no homeserver could be started here, the acceptance test in `apps/web/README.md` (two real accounts, restart/persistence) has not been executed. The identity and moderation services' own test suites (`node --test`) do pass in this environment.
5. Android and iOS applications have not yet been compiled (no Xcode/Android Studio in this environment); `apps/android` and `apps/ios` remain placeholders.
6. E2EE has not yet passed the two-account live milestone (blocked on item 3).
7. Calling (MatrixRTC) is not yet integrated.
8. No physical mobile-device testing has been performed.
9. Push notifications are foreground-only (the Notifications API fires while the browser process is open); there is no push-registration/service-worker backend yet, so backgrounded/closed-browser delivery does not work.
10. `services/business` remains an unimplemented bounded-context stub; it was out of scope for the current messaging-alpha pass.
11. Production legal review of third-party licenses remains required.
