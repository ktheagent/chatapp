# Synapse development infrastructure

Relay's development homeserver uses the official Synapse Docker image.

The Docker image requires a generated `/data/homeserver.yaml`; environment variables alone are not a replacement for a config file.

## Generate local config

From the repository root:

```bash
mkdir -p infrastructure/synapse-data

docker run --rm \
  -v "$PWD/infrastructure/synapse-data:/data" \
  -e SYNAPSE_SERVER_NAME=localhost \
  -e SYNAPSE_REPORT_STATS=no \
  matrixdotorg/synapse:v1.158.0 generate
```

Then start the compose stack:

```bash
docker compose -f infrastructure/docker-compose.yml up -d
```

For local-only test user creation and open-registration configuration, use a dedicated development config. Do not expose an open-registration development server to the public internet.

## CI

 `.github/workflows/matrix-smoke.yml` independently generates a fresh Synapse config, starts Synapse, and requires `/_matrix/client/versions` to answer successfully.

This smoke test proves the homeserver starts. It does not prove Relay's two-user E2EE acceptance test.
