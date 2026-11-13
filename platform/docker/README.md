# Platform Docker deployment

All commands below are run from `platform/`.

## Compose (recommended)

```bash
docker compose -f docker/compose.yaml up -d --build
```

Open `http://localhost:3000`. The SQLite database is retained in the named
Docker volume `platform-data`, so recreating the container does not remove
reports or paired devices.

Useful commands:

```bash
docker compose -f docker/compose.yaml logs -f
docker compose -f docker/compose.yaml down
```

`down` retains the data volume. To deliberately remove all Platform data:

```bash
docker compose -f docker/compose.yaml down -v
```

## Docker image only

```bash
docker build -f docker/Dockerfile -t agent-control-plane .
docker run -d --name agent-control-plane -p 3000:3000 -v platform-data:/app/data agent-control-plane
```

For a local demo database, add `-e SEED_DEMO=true` only for the first launch
of an empty volume. Do not enable it for an existing deployment.

## Deployment notes

- The image runs as the unprivileged `node` user.
- Persist `/app/data`; it contains the SQLite database and is required for
  reports, device pairings, and notification/read state to survive upgrades.
- Change the host side of `3000:3000` when the port is already in use, for
  example `8080:3000`.
