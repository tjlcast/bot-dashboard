# GitHub Actions deployment

The workflow entrypoint is [`.github/workflows/platform-deploy.yml`](../../.github/workflows/platform-deploy.yml), as required by GitHub Actions. Its deployment assets live in this directory.

On every push to the `deploy` branch, the workflow:

1. builds the Platform Docker image;
2. saves and compresses it as an image archive;
3. transfers the archive and server Compose file to Alibaba Cloud over SSH;
4. loads the image on the server, starts or updates the Compose service, and waits for its Docker health check.

The server needs Docker Engine plus the Docker Compose plugin. It does not need the repository checked out.

## Required GitHub Actions secrets

| Secret | Purpose |
| --- | --- |
| `ALIYUN_SSH_HOST` | Alibaba Cloud server hostname or IP address. |
| `ALIYUN_SSH_USER` | SSH deployment user. This user must be allowed to run Docker. |
| `ALIYUN_SSH_PASSWORD` | Password for the deployment user. |

`ALIYUN_SSH_PORT` is optional; leave it empty to use port `22`.

## Optional GitHub Actions variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ALIYUN_DEPLOY_PATH` | `/opt/agent-control-plane` | Directory on the server for the incoming image archive and Compose file. |
| `PLATFORM_PORT` | `3000` | Host port exposed by the Platform container. |

Before the first deployment, make sure SSH password authentication is enabled
on the server, and that the deployment user can create `ALIYUN_DEPLOY_PATH`
and access Docker without interactive `sudo`. The workflow does not validate
the server SSH host key.
