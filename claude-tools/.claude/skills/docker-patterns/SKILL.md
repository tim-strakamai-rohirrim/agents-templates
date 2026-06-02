---
name: docker-patterns
description: |
  Docker and Docker Compose patterns for local dev and AKS deployment.
  Triggers on "docker", "container", "compose", "dockerfile", "aks deployment".
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Docker & Docker Compose Patterns

## Local Development

### Running the Stack
```bash
cd rohan-python-api
docker compose watch    # Starts backend + DB with live reload
docker compose exec backend bash  # Shell into running container
```

### Docker Compose Watch
`docker compose watch` syncs file changes into running containers without rebuild. Configured in `compose.yaml` under the `develop` key:
```yaml
services:
  backend:
    develop:
      watch:
        - action: sync
          path: ./backend
          target: /app/backend
        - action: rebuild
          path: ./backend/pyproject.toml
```
- `sync` — copies changed files (fast, for code changes)
- `rebuild` — rebuilds the image (for dependency changes)

## Dockerfile Best Practices

### Multi-Stage Builds
```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen --no-dev

FROM python:3.12-slim AS runtime
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY ./backend ./backend
USER nobody
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0"]
```

### Layer Caching
- Copy dependency files first (`package.json`, `pyproject.toml`), install, THEN copy source
- This caches the dependency layer and only rebuilds on dependency changes

### Security
- Run as non-root: `USER nobody` or `USER 1000:1000`
- Use `.dockerignore` to exclude `.env`, `.git`, `node_modules`, `__pycache__`
- Pin base image versions: `python:3.12.3-slim`, not `python:latest`
- Scan images: `docker scout cves <image>`

## Docker Compose Patterns

### Service Dependencies and Health Checks
```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    depends_on:
      db:
        condition: service_healthy
```

### Volume Mounts for Dev
```yaml
volumes:
  - ./backend:/app/backend        # Source code (live edit)
  - backend_venv:/app/.venv       # Persist virtualenv across restarts
  - postgres_data:/var/lib/postgresql/data
```

## AKS Deployment Considerations

### Health Probes
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 10
  periodSeconds: 15
readinessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 5
  periodSeconds: 5
```

### Resource Limits
Always set requests and limits to prevent noisy-neighbor issues:
```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

### Graceful Shutdown
- Handle `SIGTERM` in your application — close DB connections, finish in-flight requests
- Set `terminationGracePeriodSeconds` to match your app's shutdown time (default 30s)
- FastAPI: use lifespan events; NestJS: use `onApplicationShutdown` hook
