# Architecture

## Decision

Use an original Relay client and design system on top of Matrix-compatible SDKs.

## Why

Matrix supplies mature sync, room state, identity primitives, federation, and established end-to-end-encryption implementations through maintained SDKs. Relay should invest in its differentiated product layer rather than inventing a messaging protocol or cryptography.

## Client strategy

### Android
Target: Kotlin + Jetpack Compose.

Planned SDK direction: Matrix Rust SDK through maintained Kotlin/FFI bindings.

### iOS
Target: Swift + SwiftUI.

Planned SDK direction: Matrix Rust SDK through maintained Swift/FFI bindings.

### Web
Target: TypeScript.

The dependency-free web prototype is a UX harness, not the final Matrix client.

## Backend boundaries

```text
Mobile/Web Clients
        |
        +--> Matrix Homeserver
        |      - rooms
        |      - sync
        |      - encrypted events
        |      - device/session state
        |
        +--> Relay API
               - stable public usernames
               - business profiles
               - moderation cases + appeals
               - premium entitlements
               - payments abstraction
               - admin/audit services
```

## Stable identity

Relay exposes a stable public handle such as `@ama`. Phone numbers are optional, replaceable identity attributes.

## Low-data architecture

- media presets
- thumbnail-first rendering
- download-on-demand
- resumable uploads
- offline outbound queue
- network-quality observation
- adaptive calling bitrate

## Trust and moderation

Reports are evidence signals, not automatic proof. Every restriction has a reason category, scope, start time, duration, policy reference, and appeal state.

## Calls

Target MatrixRTC-compatible calling rather than creating a proprietary signalling protocol.
