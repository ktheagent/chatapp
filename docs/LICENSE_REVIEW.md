# License Review

Checked: 2026-08-17

This is an engineering record, not legal advice.

## Current direction
Relay uses original product/UI code and established Matrix-compatible SDKs.

## Matrix Rust SDK
Previously observed license: Apache-2.0.
Before integration, verify the exact repository version/tag/commit and license again.

## Element X
Do not copy/fork Element X into Relay by default. Its licensing model may involve AGPL and/or commercial licensing depending on repository/version. Use only after explicit license review.

## Synapse
Production use requires review of the exact current license and deployment model before launch.

## Rule
For every significant third-party dependency:
1. record repository;
2. record exact version/commit;
3. record license;
4. preserve required notices;
5. review SaaS/distribution implications;
6. never assume open source means unrestricted proprietary use.
