# Android Client

Target stack:
- Kotlin
- Jetpack Compose
- maintained Matrix SDK bindings
- Android platform secure storage

Immediate sequence:
1. application shell;
2. Matrix session lifecycle;
3. secure credential persistence;
4. room list;
5. encrypted direct-room creation;
6. timeline;
7. send/receive text;
8. media and voice notes;
9. offline/restart integration tests.

Do not port Element X UI source into this module by default.
