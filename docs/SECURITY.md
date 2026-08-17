# Security Baseline

## Non-negotiables

- Never invent encryption algorithms.
- Never log decrypted private-message bodies.
- Never commit secrets.
- Use OS-backed secure credential/key storage.
- Treat device changes as security-sensitive events.
- Verify payment-provider webhooks.
- Rate-limit OTP, registration, login, search, invitations and reports.
- Audit privileged admin actions.
- Keep AI disabled for private content unless the user explicitly invokes it and the data path is explained.

## Threat model areas

1. account takeover;
2. SIM swap;
3. malicious linked device;
4. stolen unlocked phone;
5. server compromise;
6. mass reporting;
7. spam automation;
8. malicious media;
9. payment callback forgery;
10. recovery-flow abuse;
11. metadata leakage;
12. insider/admin abuse.

## Release gates

Before public beta:
- dependency scanning;
- secret scanning;
- mobile secure-storage review;
- E2EE multi-device integration tests;
- recovery tests;
- lost-device revocation tests;
- rate-limit tests;
- report/appeal abuse tests.


Before commercial launch:
- independent security assessment;
- privacy review;
- incident response runbook;
- backup restore exercise;
- production key rotation exercise.
