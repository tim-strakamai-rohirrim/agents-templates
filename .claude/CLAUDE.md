# CLAUDE.md - Rohan Platform Workspace

## System Overview

**Rohan** is an AI-powered document processing and proposal management platform for U.S. federal government acquisition — both the commercial/proposal side (writing RFPs) and the government/acquisitions side (publishing opportunities, evaluating vendors).

Each enterprise customer gets a **fully isolated environment**: dedicated Azure subscription, AKS cluster, PostgreSQL, Auth0/Okta tenant, and blob storage. **40+ deployments** across Azure commercial and Azure US Government clouds.

---

## Repository Map

| Repo | Stack | Purpose |
|------|-------|---------|
| `rohan_api/` | NestJS + Fastify, TypeScript | Core backend API, TypeORM/PostgreSQL, LLM orchestration |
| `rohan_ui/` | Angular 20.3, TypeScript | Frontend SPA, dual auth (Auth0/Okta), Office.js Word add-in |
| `rohan-python-api/` | FastAPI, Python 3.12 | Document processing (Docling), tagging pipeline, shredding |
| `Database/` | SQL (PostgreSQL) | Schema scripts - 50+ tables, RBAC, migrations, seed data |
| `ingest-connector/` | Python microservices | ETL pipeline (6 services) - SharePoint/GDrive/S3/Azure Blob → PgVector |
| `LocalDev/` | Docker Compose | Local dev - PostgreSQL/pgvector, Weaviate, MinIO |
| `devops-automation/` | PowerShell, GitHub Actions | Fleet Compiler (GitOps), CI/CD, cluster provisioning |

---

## Inter-Service Communication

```
rohan_ui ──HTTP──> rohan_api ──HTTP──> rohan-python-api
                       │                      │
                       │    Azure Service Bus  │
                       │  (topics & queues)    │
                       └──────────────────────>┘
                       │
                       ├── TypeORM ──> PostgreSQL (pgvector)
                       └── Blob Storage (Azure Blob / MinIO)

ingest-connector (6 K8s Jobs):
  discover → load → extract → detect → index → synthesize
  All driven by PostgreSQL status transitions, writing to pgvector
```

- **Service Bus queues**: `rohan-rfp-queue` (rohan_api → python-api). Topics: `rohan-rfp-topic` (python-api → rohan_api)
- **Message types**: `AutoTag` (tagging pipeline), `Shredding` (document analysis)
- **Dev queue isolation**: `SERVICEBUS_DEV_SUFFIX` env var appends to queue/subscription names per developer
- **Claim-check pattern**: Payloads >240KB offloaded to blob storage with presigned URLs

---

## Critical Conventions

### SQL Must Be Idempotent
Merges to `main` auto-deploy to staging. All SQL in `Database/` must use `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`. See `Database/rohan_api/scripts/sql/init_organizations.sql`.

### Air-Gapped Environments
All package/model downloads must happen at **Docker build time, never runtime**.
- Tiktoken pre-cached in Dockerfiles (`cl100k_base.tiktoken`, `o200k_base.tiktoken`)
- Docling models: `docling-tools models download` in Dockerfile
- spaCy: `en_core_web_md` verified at build time

### LLM Must Support Three Providers
All LLM code must work with: **commercial OpenAI**, **Azure OpenAI**, **Azure Government OpenAI** (.us endpoints).
- Detection in rohan_api: `Settings.getUseOpenAi()` (from `OPENAI_BASE_PATH` / `USE_OPENAI` env)
- Detection in Python: check base path for "azure.com" or "azure.us"

### Auth: Okta OR Auth0 (Never Both)
Per-customer; code must handle both. rohan_api: `jwt.strategy.ts` auto-detects via `OKTA_ISSUER_DOMAIN`.

### Package Managers
- **npm + Volta** (Node 22.14.0) for `rohan_api` and `rohan_ui`
- **uv** for all Python projects — **never use pip**

### Cloud-Agnostic Goal
Currently Azure-only, moving toward cloud-agnostic. Minimize new Azure-specific dependencies.

---

## Legacy / Deprecated (Do Not Extend)

| Item | Location | Status |
|------|----------|--------|
| **Weaviate** | `rohan_api/src/utils/weaviate/`, LocalDev | Being replaced by PgVector. Nearly complete. |
| **Perplexity module** | `rohan_api/src/utils/perplexity/` | Dead code. Will be removed. |
| **Python child processes** | `rohan_api/src/utils/python/python.service.ts` | Legacy. Replaced by rohan-python-api calls. |
| **Answer Engine v1** | `rohan_api/src/answer-engine/`, `rohan_ui/.../answer-engine/` | Superseded by v2. |

---

## Database Access Patterns

| Service | ORM/Driver | Connection Env Vars |
|---------|-----------|---------------------|
| rohan_api | TypeORM | `POSTGRES_HOST/PORT/USER/PASSWORD/DB` |
| rohan-python-api | SQLModel + Alembic | `POSTGRES_SERVER/PORT/USER/PASSWORD/DB` |
| ingest-connector | psycopg2 | `DB_HOST/PORT/USER/NAME/PASS` |
| Database (schema) | psql CLI | `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` |

---

## Key Files

| Area | File |
|------|------|
| Auth strategy (Auth0/Okta) | `rohan_api/src/auth/jwt.strategy.ts` |
| RBAC permissions guard | `rohan_api/src/auth/permissions/permissions.guard.ts` |
| LLM provider switching | `rohan_api/src/utils/llm/azure.service.ts` |
| RBAC schema | `Database/rohan_api/scripts/sql/init_organizations.sql` |
| Fleet Compiler | `devops-automation/Pipelines/Deployments/FleetCompiler/compile.ps1` |
