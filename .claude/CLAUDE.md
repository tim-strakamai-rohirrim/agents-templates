# CLAUDE.md - Rohan Platform Workspace

## System Overview

**Rohan** is an AI-powered document processing and proposal management platform serving two sides of U.S. federal government acquisition:

1. **Commercial/Proposal side** - GenAI tools for proposal managers competing for government contracts (writing, managing, submitting proposals)
2. **Government/Acquisitions side** - Tools for government acquisitions officers publishing opportunities and evaluating vendor submissions

Both products share the same platform and codebase. The system processes documents through ingestion pipelines, extracts structured content, generates vector embeddings for semantic search, and uses LLMs (OpenAI/Azure OpenAI) for content generation, classification, and compliance checking.

### Deployment Model

Each enterprise customer gets a **fully isolated environment**: dedicated Azure subscription, resource group, AKS cluster, PostgreSQL database, Auth0/Okta tenant, and blob storage. This per-customer isolation is a hard requirement driven by defense/aerospace/government data security needs. There are **40+ customer deployments** across Azure commercial and Azure US Government clouds.

---

## Repository Map

| Repo | Stack | Purpose |
|------|-------|---------|
| `rohan_api/` | NestJS + Fastify, TypeScript | Core backend API - HTTP traffic from UI, TypeORM for PostgreSQL, LLM orchestration |
| `rohan_ui/` | Angular 19, TypeScript | Frontend SPA with dual auth (Auth0/Okta), Office.js Word add-in |
| `rohan-python-api/` | FastAPI, Python 3.13 | Document processing (Docling), tagging pipeline, visualizer, shredding |
| `Database/` | SQL (PostgreSQL) | Centralized schema scripts - 50+ tables, RBAC, migrations, seed data |
| `ingest-connector/` | Python microservices | ETL pipeline (6 services) - document ingestion from SharePoint/GDrive/S3/SFTP into PgVector |
| `LocalDev/` | Docker Compose | Local dev environment - PostgreSQL/pgvector, Weaviate, MinIO |
| `devops-automation/` | PowerShell, GitHub Actions | Fleet Compiler (GitOps manifest generation), CI/CD, cluster provisioning |

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
                       │
                       └── Blob Storage (Azure Blob / MinIO)

ingest-connector (6 K8s Jobs):
  discover → load → extract → detect → index → synthesize
  All driven by PostgreSQL status transitions, writing to pgvector
```

### Key Communication Patterns

- **UI to API**: HTTP with JWT Bearer tokens (Auth0 or Okta)
- **rohan_api to rohan-python-api**: HTTP calls via `RfpPythonServerService` (`rohan_api/src/utils/rfp-python-server/`) + Azure Service Bus topics/queues
- **Service Bus queues**: `rohan-rfp-queue` (rohan_api sends, rohan-python-api receives)
- **Service Bus topics**: `rohan-rfp-topic` (rohan-python-api publishes completions, rohan_api subscribes)
- **Message types**: `AutoTag` (tagging pipeline), `Shredding` (document analysis)
- **Dev queue isolation**: `SERVICEBUS_DEV_SUFFIX` env var appends to queue/subscription names per developer
- **Claim-check pattern**: Payloads >240KB offloaded to blob storage with presigned URLs
- **ingest-connector**: Database-driven state machine - each service polls PostgreSQL for work items using `FOR UPDATE SKIP LOCKED`

---

## Critical Conventions & Gotchas

### SQL Must Be Idempotent
Merges to `main` auto-deploy to staging. All SQL scripts in `Database/` must use `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, etc. See `Database/rohan_api/scripts/sql/init_organizations.sql` for canonical examples.

### Air-Gapped / Restricted Network Environments
Several customers have firewalls blocking outbound traffic. **All package/model downloads must happen at Docker build time, never runtime.**
- **Tiktoken**: Pre-cached in Dockerfiles (`cl100k_base.tiktoken`, `o200k_base.tiktoken`) with SHA1 hashes
- **Docling models**: `docling-tools models download` in Dockerfile, cached at `/root/.cache/docling/models`
- **spaCy**: `en_core_web_md` model verified at build time
- See `rohan_api/Dockerfile`, `rohan-python-api/backend/Dockerfile`, `ingest-connector/ingest-index/Dockerfile`

### LLM Code Must Support Three Providers
All LLM code must work with: **commercial OpenAI**, **Azure OpenAI**, and **Azure Government OpenAI** (.us endpoints).
- **rohan_api**: `src/utils/openai/openai.helpers.service.ts` switches based on `Settings.getUseOpenAi()` boolean (derived from `OPENAI_BASE_PATH` or `USE_OPENAI` env)
- **rohan_api LLM module**: `src/utils/llm/azure.service.ts` (AzureChatOpenAI with model fallback, cron refresh) and `src/utils/llm/openai.service.ts` (direct OpenAI)
- **rohan-python-api**: `backend/app/domains/shared/openAI/model_Client.py` detects Azure by checking base path for "azure.com" or "azure.us"
- **ingest-connector**: `shared/oai/client_config.py` - same Azure detection pattern

### Cloud-Agnostic Goal
Currently Azure-only, but moving toward cloud-agnostic. Minimize new Azure-specific dependencies. Future contracts may require AWS or GCP.

### Authentication: Okta OR Auth0 (Never Both)
Per-customer environments use one auth provider. Code must handle both:
- **rohan_api**: `src/auth/jwt.strategy.ts` auto-detects based on `OKTA_ISSUER_DOMAIN` env var
- **rohan_ui**: `src/app/app.module.ts` conditionally imports Auth0 or Okta modules based on `RohanSettings.AUTH_PROVIDER`
- Several customers have SAML IDP integrations

### Package Managers
- **npm + Volta** (Node 22.14.0) for `rohan_api` and `rohan_ui`
- **uv** for all Python projects (`rohan-python-api`, `ingest-connector`) - **never use pip**

---

## Legacy / Deprecated (Do Not Extend)

| Item | Location | Status |
|------|----------|--------|
| **Weaviate** | `rohan_api/src/utils/weaviate/`, LocalDev compose | Being replaced by PgVector. Nearly complete removal. |
| **Perplexity module** | `rohan_api/src/utils/perplexity/` | Dead code, unused by UI. Will be removed. |
| **Python child processes** | `rohan_api/src/utils/python/python.service.ts` | Legacy - being replaced by rohan-python-api HTTP/Service Bus calls |
| **Answer Engine v1** | `rohan_api/src/answer-engine/`, `rohan_ui/src/app/pages/answer-engine/` | Superseded by Answer Engine v2 |

---

## rohan_api (NestJS Backend)

### Quick Reference
```bash
cd rohan_api
npm install                          # Volta pins Node 22.14.0
npm run start:watch                  # Dev server with auto-restart
npm run test                         # Jest unit tests
npm run test -- path/to/test.spec.ts # Single test file
npm run test:e2e:ci                  # E2E (Docker + DB setup)
npm run lint && npm run format       # Lint + format
```

### Architecture
- **Entry point**: `src/main.ts` (Fastify adapter, Swagger config)
- **Root module**: `src/app.module.ts` imports 45+ feature modules
- **Runtime**: Fastify (not Express)
- **ORM**: TypeORM with PostgreSQL, 50+ entity definitions
- **Config**: `src/utils/settings.ts` - Azure Key Vault integration with `.env` fallback
- **Logging**: `RohanLogger` (injected via DI, set context in constructor)

### Module Structure (`src/`)

**Core:**
- `auth/` - JWT strategy (Auth0/Okta auto-detection), permissions guard (383 lines of hierarchical RBAC), features guard
- `admin/` - RBAC CRUD: users, roles, groups, organizations, invitations (30+ endpoints)
- `settings/` - Global settings, audit trails, metrics

**Feature Modules:**
- `answer-engine-v2/` - RAG Q&A with threads, streaming, file uploads (current)
- `proposal-writer/` - RFP proposal generation with events & listeners
- `procurement-writer/` - Procurement/toolkit document generation
- `compliance/` - Compliance checking & evidence tracking
- `template-generator/` - Template creation with auto-tagging
- `tagging/` - Event-driven auto-tagging
- `graphics-engine/` - Visual content generation
- `connectors/` - External data source integrations (SharePoint, OneDrive)
- `collaboration/` - Real-time collaboration
- `public-api/` - External API with API keys

**Shared Utilities (`src/utils/`):**
- `openai/` - OpenAI helpers, commercial vs Azure switching
- `llm/` - LangChain integration, Azure OpenAI with model fallback
- `rfp-python-server/` - HTTP client to rohan-python-api
- `roh-azure-utils/` - Service Bus subscriber, message handlers
- `vector-db-postgres/` - PgVector entities (documents, paragraphs, images, tables)
- `blob-storage/`, `minio/` - Object storage clients
- `feature-flags/` - 31 feature flags
- `python/` - Legacy child process spawning (deprecated)
- `weaviate/` - Legacy vector DB (deprecated)
- `perplexity/` - Dead code (deprecated)

### RBAC Model
- **Permissions Guard** (`src/auth/permissions/permissions.guard.ts`): Extracts required permissions from `@Permissions()` decorator, checks admin bypass, then queries group/role/permission chain
- **Hierarchical resources**: Groups contain `resources_v2` (CategoriesMap tree structure) for data-level access control
- **Admin role**: Assigned directly to users (not via groups), protected by DB trigger preventing assignment to other roles
- **Feature gating**: `OrganizationFeaturesService` filters available permissions by org-enabled features

### Key Patterns
```typescript
// Standard controller pattern
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@Permissions('admin', 'feature-name')
@Post('/endpoint')
async handler(@Body() dto: SomeDTO, @GetUser() user: User) { }
```
- **Event-driven**: `@OnEvent('event.name')` listeners for async processing
- **Error classes**: Module-specific (ProposalError, UserError, GroupError, InvitationError)
- **DTOs**: class-validator for input validation
- **Tests**: `*.spec.ts` alongside source, E2E in `/test`

### Dockerfile (Multi-stage)
Three stages: Node 22 builder -> Node 22 provider -> Python 3.13 final. Pre-caches tiktoken encodings. Runs `setup_python.sh` for venv. Exposes port 3000.

### Helm Chart (`helm/`)
- 3 replicas default, HPA 2-100, CPU/Memory 80% targets
- ConfigMap: 66 env vars (auth, OpenAI, Postgres, Service Bus, blob storage, MinIO, feature flags, etc.)
- Node selector: `tier: standard`

---

## rohan_ui (Angular Frontend)

### Quick Reference
```bash
cd rohan_ui
npm install
npm start                            # Dev server on port 4200
npm test                             # Karma + Jasmine unit tests
npm run test:e2e:ci                  # Playwright E2E tests
npm run lint:fix && npm run format   # Lint + format
```

### Architecture
- **Angular 19.2.18** with standalone: false (traditional NgModules)
- **UI framework**: Angular Material 19, CKEditor 5 for rich text
- **State management**: Reactive services (RxJS BehaviorSubjects) - no NgRx/Redux
- **~107K lines TypeScript**, 142 page components, 62 shared components, 58 services

### Route Structure (`src/app/route-config.ts`)
All feature modules lazy-loaded via `loadChildren`:

| Route | Module | Guards |
|-------|--------|--------|
| `/overview` | OverviewModule | AuthGuard (default landing) |
| `/answer-engine-v2` | AnswerEngineV2Module | AuthGuard (default for Word users) |
| `/acquisition-center` | ProcurementWriterModule | AuthGuard, feature-gated |
| `/proposal-writer` | ProposalWriterModule | AuthGuard |
| `/compliance` | ComplianceModule | AuthGuard, feature-flagged |
| `/solutions-architect` | SolutionsArchitectModule | AuthGuard |
| `/settings` | SettingsModule | AuthGuard, RoleGuard (ADMIN, GROUP_LEADER) |
| `/data-ingestion` | SharepointDataIngestionModule | AuthGuard, RoleGuard (ADMIN) |
| `/graphics-lookbook` | GraphicsLookbookModule | AuthGuard |
| `/developer-tools` | DeveloperToolsModule | AuthGuard, feature-flagged |

### Key Services
- **`RequestService`** (`shared-services/request/`): Single HTTP entry point. Methods: `get()`, `post()`, `postStream()`, `postStreamEventSource()` (SSE with auto-reconnect), `uploadFile()`. Base URL from `RohanSettings.API_DOMAIN`.
- **`RohAuthService`** (`shared-services/auth/`): Facade switching Auth0/Okta at runtime
- **`AuthStateService`**: Centralized observable state (`authReady$`, `isAuthenticated$`, `userInfo$`, `features$`)
- **`FeatureBlockingService`**: Organization feature entitlements from `/admin/features`
- **`FeatureFlagsService`**: Database-backed feature flags (24+ flags)

### Interceptors
1. **`RohAuthInterceptor`**: Bearer token injection (bypasses presigned S3/MinIO/Azure blob URLs)
2. **`InterceptorService`**: Error handling - 401 auto-logout, 403 redirect to `/no-access`

### Path Aliases (tsconfig.json)
`@shared-components/*`, `@shared-services/*`, `@shared-types/*`, `@shared-utilities/*`, `@pages/*`, `@environments/*`

### Office.js Integration
Word add-in support. Office.js loaded in `index.html`, custom history API restoration (Office.js nullifies pushState/replaceState). Word users default to `/answer-engine-v2`.

### Runtime Config Injection
Settings injected via `<script src="assets/scripts/settings.js">` generated at container startup from Helm ConfigMap values using `envsubst`. Template: `scripts/for-docker/settings-template.js`.

### Testing
- **Unit**: Karma + Jasmine (`*.spec.ts`)
- **E2E**: Playwright 1.56.1 with custom fixtures, page objects, visual regression (Percy)
- **CI**: GitHub Actions - `chromium-tests.yml`, `cross-browser-tests.yml`, `RBAC-tests.yml`

### Dockerfile
Nginx-based. Copies built `dist/rohan_ui/` to `/srv/rohan/`. Entry script runs `generate-settings.sh` and `generate-rohan-conf.sh` at startup for dynamic env injection.

---

## rohan-python-api (FastAPI Backend)

### Quick Reference
```bash
cd rohan-python-api/backend
uv sync                              # Install deps (uses uv, not pip)
uv run fastapi run --reload app/main.py  # Dev server on port 8000
uv run pytest                        # Tests
uv run ruff check && uv run black .  # Lint + format
uv run mypy                          # Type checking (strict)
```

### Architecture
- **FastAPI** with Pydantic v2, SQLModel (SQLAlchemy + Pydantic)
- **Entry point**: `backend/app/main.py` - Service Bus listener started as lifespan background task
- **Migrations**: Alembic (`backend/app/alembic/`)
- **Production**: Gunicorn with Uvicorn workers (3 workers, 120s timeout)

### API Endpoints (`backend/app/api/routes/`)

| Route | Purpose |
|-------|---------|
| `POST /api/v1/file/extract-file-content` | Document extraction via Docling |
| `POST /api/v1/tagging/snap-to-sentences` | Align offsets to sentence boundaries |
| `POST /api/v1/tagging/detect-sentences` | Detect sentence/block boundaries |
| `POST /api/v1/shredding/...` | Document shredding (triggered via Service Bus) |
| `POST /api/v1/langchain/...` | LLM chat endpoint |
| `POST /api/v1/visualizer/generate-custom-graphics` | PPTX generation |
| `POST /api/v1/json-transformations/...` | JSON to Excel |
| `GET /api/v1/utils/health-check/` | K8s liveness/readiness probe |

### Domain Modules (`backend/app/domains/`)

- **`extract_file_content/`**: Docling-based document conversion to HTML. `DoclingConverterFactory` (`domains/shared/docling/docling_factory.py`) creates converters for PDF, DOCX, PPTX, XLSX, HTML, images.
- **`tagging/`**: Full tagging pipeline orchestrator. Stages: segmentation (sentence/block/section via spaCy `en_core_web_md`) -> rule-based classification -> optional LLM classification (OpenAI structured outputs). Does NOT write to DB - rohan_api persists results.
- **`shredding/`**: Document analysis and classification.
- **`langchain/`**: ChatOpenAI wrapper with structured output.
- **`visualizer/`**: PPTX template filling, PNG conversion, branding.
- **`json_transformations/`**: JSON to Excel via xlsxwriter.

### Storage Abstraction (`domains/shared/storage/`)
- `AzureStorageClient` and `MinioTaggingClient` behind `StorageBackend` protocol
- Factory `get_storage_backend()` selects based on config

### Service Bus Integration (`azure_event_bus/`)
- **Queue listener** (`queue_service.py`): Background async task, reconnects with 5s backoff
- **Handler routing** (`queue_handler.py`): `AutoTag` -> tagging orchestrator, `Shredding` -> shredding service
- **Topic publisher** (`topic_service.py`): Sends completion messages back to rohan_api
- **Dead-lettering**: `PermanentFailureError` -> dead-letter queue

### Dockerfile (Multi-stage)
Python 3.12 base. Installs Rust toolchain for thinc rebuild. Pre-fetches: tiktoken encodings, Docling models (`docling-tools models download`), spaCy `en_core_web_md`. Verifies spaCy model loads at build. Security patch for tarfile CVE.

### Helm Chart
6 replicas default, HPA 3-9, CPU target 50%. Memory limit 12Gi (heavy due to Docling/spaCy models). Liveness/readiness on `/api/v1/utils/health-check/`.

---

## Database (SQL Scripts)

### Quick Reference
```bash
cd Database
# Schema installed via Kubernetes Job (Helm chart)
# Local: psql -f rohan_api/scripts/run_all.sql
```

### Organization
- **`rohan_api/scripts/run_all.sql`**: Master orchestrator - executes 41 SQL scripts in order
- **`rohan_central/scripts/run_all.sql`**: Customer info and feature management (8 scripts)
- **Schema version**: Tracked in `versioning` table (current: ver=7)

### RBAC Schema (`rohan_api/scripts/sql/init_organizations.sql`)

```
organizations (id, organization_id, name, auth_provider [Okta|Auth0], language_locale)
    └── users (user_id, auth0_id, email, state [invited|accepted|deleted], organizationId FK)
         ├── users_roles_roles (M:N join)
         │    └── roles (role_id, name, group_role boolean, organizationId FK)
         │         └── roles_permissions_permissions (M:N join)
         │              └── permissions (permission_id, name, feature ENUM [11 features])
         └── user_group_relations (M:N join with leader boolean)
              └── groups (group_id, name, resources_v2 [hierarchical CategoriesMap], admin_resources_v2)
                   └── groups_roles_relations (M:N join to roles)
```

**Key rule**: Admin permission protected by trigger `prevent_admin_permission()` - cannot be assigned to any role except the system Admin role.

**11 permission features**: ADMIN_DASHBOARD, ANSWER_ENGINE, ANSWER_ENGINE_V2, SOLUTION_ARCHITECT, PROPOSAL_WRITER, ACQUISITION_CENTER, GRAPHICS_ENGINE, DEEP_RESEARCH, AC_DEEP_RESEARCH, KNOWLEDGE_MANAGEMENT, COMPLIANCE

### Major Table Groups

**Answer Engine**: `thread`, `question`, `answer`, `summaries`, `aggregates`, `upload_files`, `stream_chunks`

**Proposal Writer**: `proposals` (wizard_step 1-8, section L/M/C JSON), `proposal_documents`, `document_requirements`, `compliance_outlines`

**Procurement**: `procurements` (project_type: procurement|toolkit), `procurement_sections`, `procurement_questions`, `procurement_documents`, `procurement_templates`

**Compliance**: `compliance_projects`, `compliance_responses`, `compliance_documents`, `compliance_items`, `compliance_checks`, `compliance_item_evidence` (all UUID PKs)

**Tagging**: `taggable_documents` (product_code enum), `tag_configs` (segmentation_strategy, tag_schema JSONB, rule_pattern JSONB), `document_segments`, `document_tags`

**Data Ingestion**: `connectors` (type: sharepoint|google-drive|azure-blob-storage|s3), `ingest_requests`, `discovered_files`, `loaded_files`, `extracted_documents`, `extracted_images`, `detected_documents`, `detected_images`, `synthesize_requests`, `synthesized_documents`

**Search (PgVector)**: `searchable_documents` (description_pgv vector(1536), description_tsv tsvector), `searchable_paragraphs` (content_pgv vector(1536)), `searchable_tables`, `searchable_images` - all with HNSW cosine indexes

**Config**: `prompts` (441 prompt files), `feature_flags` (27 flags), `settings` (key-value), `token_count` (per-org usage)

**Audit**: `audit_log_dml` (DML changes via triggers), `audit_log_ddl` (DDL events)

### Idempotency Patterns
- `CREATE TABLE IF NOT EXISTS`, `ALTER TYPE ADD VALUE IF NOT EXISTS`
- `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- Conditional constraints via `DO $$ ... IF NOT EXISTS (SELECT FROM pg_constraint) ... $$`
- `ON CONFLICT DO NOTHING` / `ON CONFLICT DO UPDATE` for inserts
- Version-based migrations: `SELECT ver FROM versioning` to gate schema changes
- `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER` for trigger updates

### Deployment
Dockerfile based on postgres:16-alpine. Helm chart creates Kubernetes Job (post-install hook). Entrypoint patches SQL with org/user IDs via sed, runs with `ON_ERROR_STOP=1`, retry with exponential backoff (3 retries, 5s base).

---

## ingest-connector (ETL Pipeline)

### Architecture
Six Python microservices deployed as Kubernetes Deployments with **KEDA auto-scaling** (scale 0-to-N based on PostgreSQL row counts). Pipeline is a database-driven state machine:

```
ingest_requests (status='new')
  → ingest-discover: discovers files from data sources → discovered_files
    → ingest-load: downloads files to MinIO → loaded_files
      → ingest-extract: converts to markdown (Docling/LibreOffice/PyMuPDF) → extracted_documents
        → ingest-detect: classifies docs (source/resume/past_performance via LLM) → detected_documents
          → ingest-index: generates OpenAI embeddings, writes to PgVector → searchable_*
            → ingest-synthesize: clusters & synthesizes resumes/PP → synthesized_documents
```

### Services

| Service | Entry Point | Polls | Writes | Resources |
|---------|------------|-------|--------|-----------|
| ingest-discover | `src/discover.py` | `ingest_requests` status=new | `discovered_files` | 256Mi-1Gi |
| ingest-load | `src/load.py` | `discovered_files` status=new | `loaded_files` (MinIO) | 256Mi-1Gi |
| ingest-extract | `src/extract.py` | `loaded_files` status=new | `extracted_documents`, images | 1Gi-8Gi (LibreOffice) |
| ingest-detect | `src/detect.py` | `extracted_documents` status=new | `detected_documents` | 512Mi-2Gi |
| ingest-index | `src/index_detected.py` | `detected_documents` status=new | `searchable_*` tables | 512Mi-2Gi |
| ingest-synthesize | `src/synthesize.py` | All detected docs | `synthesized_documents` | 512Mi-8Gi |

### Shared Utilities (`shared/`)
- **`database/helper.py`**: PostgreSQL connection with auto-reconnect, retry decorators, `FOR UPDATE SKIP LOCKED` for work stealing
- **`data_sources/`**: Pluggable accessor pattern - `DataSourceAccessorFactory.create_accessor(connector)` returns SharePoint/Google Drive/Azure Blob/S3 accessor
- **`extractors/`**: Registry of document extractors with priority ordering: Docling (highest) > Docx > Pptx > PyMuPDF > LibreOffice
- **`oai/`**: OpenAI client factory, vectorizer (`text-embedding-3-large`, 1536 dims), document describer, table summarizer, image describer
- **`aperture/`**: LLM-powered resume/past-performance detection from markdown sections
- **`minio_storage/helper.py`**: MinIO upload/download wrapper

### KEDA Scaling (`helm/ingest-connector/templates/scaledobject-*.yaml`)
Each service has a PostgreSQL trigger query. When matching rows > `targetQueryValue`, KEDA scales up from 0 replicas. When work is done, scales back to 0 (cost-effective).

### Key Patterns
- **Polling**: Configurable `POLL_INTERVAL` (default 30s), stale task recovery after 15 min
- **Concurrency control**: `MAX_CONCURRENT_OPENAI` semaphore for embedding calls
- **Batch embedding**: `EMBEDDING_BATCH_SIZE` (default 100) with fallback to individual on failure
- **Deduplication**: `searchable_document_ids` table provides stable IDs by filepath

---

## LocalDev (Local Development)

### Quick Reference
```bash
cd LocalDev/databases-runlocal
docker compose up -d                 # PostgreSQL (pgvector), Weaviate, MinIO
```

### Services Provisioned
1. **PostgreSQL + pgvector** (port 5432): `pgvector/pgvector:pg17`, credentials `postgres/postgres`
2. **Weaviate** (port 8080, 50051): `semitechnologies/weaviate:1.24.1` with OpenAI text2vec module
3. **MinIO** (port 9000 API, 9001 console): `quay.io/minio/minio`, credentials `minioadmin/minioadmin`, bucket `uploads`

### Data Restoration
- `run-local.sh`: Orchestrator that checks for existing data before restoring
- `import-pgvector.sh`: Downloads SQL backup from Azure Storage SAS URL
- `import-data.sh`: Restores Weaviate from ZIP backup
- `import-minio.sh`: Sets up MinIO bucket and restores data
- Force refresh by deleting `./data/weaviate/`, `./pgvector-backup.sql`, or `./minio-data/`

### Devcontainer
`.devcontainer/devcontainer.json`: Node 20 base, Azure CLI, Docker-in-Docker, Python 3.10, ports 4200/5432

---

## devops-automation (CI/CD & Infrastructure)

### Fleet Compiler (Core GitOps System)

**Location**: `Pipelines/Deployments/FleetCompiler/`

Converts declarative JSON configs into deterministic Flux GitOps manifests for all 40+ customer clusters.

**Inputs (3 JSON files):**
1. **`release.json`**: Chart metadata, image tags, ACR endpoints per release version
2. **`clusters.json`**: 40+ cluster definitions with cloud, region, release tag, Key Vault, deployment ring/cohort, and `conditionalVars` (e.g., `authProvider: AUTH0`)
3. **`chart-secrets.json`**: Data-driven Key Vault -> Helm value mappings with conditional secret sets (Auth0 vs Okta)

**Output**: Per-cluster Flux manifests (Namespace, OCIRepository, HelmRelease, ExternalSecret, Kustomization) committed to `devops-fleet-gitops` repo.

**10 PowerShell modules** in `Modules/`: Json, Yaml, FluxTemplates, ValuesGenerator, ACR, Charts, Secrets, Context, Logging, Compiler

### GitHub Actions Workflows (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `build-rohirrim.yml` | Manual | Multi-image Docker build (10+ services in parallel matrix) |
| `fleet-compiler.yml` | Push to main | Validates JSON, runs Fleet Compiler, syncs manifests to GitOps repo |
| `flux-bootstrap.yml` | Manual | Multi-cluster Flux v2.7.5 installation with Workload Identity |
| `release-notes.yml` | Manual | Automated release notes generation |

### Cluster Deployment Flow
1. `build-rohirrim.yml` builds Docker images -> Azure Container Registry
2. Update `release.json` with new image tags
3. `fleet-compiler.yml` generates Flux manifests -> `devops-fleet-gitops`
4. Flux reconciles manifests on each AKS cluster
5. External Secrets Operator fetches secrets from Azure Key Vault per `chart-secrets.json`
6. Staged rollout via deployment rings (ci -> staging -> prod cohorts)

### Customer Environment Provisioning
`RohanInstallAzureOpenAI/New-AzRohanInstall.ps1`: One-command customer setup - reads Key Vault config, enables KEDA, configures ACR auth, installs namespaces/MinIO/Weaviate via Helm.

### Operational Scripts (`PowerShell/`)
70+ scripts for ACR image management, Weaviate backup/restore, cluster management, certificate expiry detection, Auth0 user provisioning.

---

## Helm Charts Across Repos

All repos follow consistent Helm patterns:

| Repo | Chart Path | Type | Key Differences |
|------|-----------|------|-----------------|
| rohan_api | `helm/` | Deployment | HPA 2-100, port 3000 |
| rohan_ui | `helm/` | Deployment | Nginx, port 80, runtime env injection |
| rohan-python-api | `helm/` | Deployment | HPA 3-9, port 8000, 12Gi memory |
| Database | `helm/` | Job (post-install hook) | Runs SQL scripts, retry with backoff |
| ingest-connector | `helm/ingest-connector/` | 6 Deployments + KEDA ScaledObjects | Scale 0-to-N per service |

**Common patterns:**
- ACR: `rohanretail.azurecr.io` (commercial), gov ACR for government
- Node selector: `tier: standard`
- ConfigMap for non-sensitive env vars, Secrets for sensitive
- Image pull secret: `acr-auth`
- All use `values.yaml` with Helm templating

---

## Database Access Patterns

| Service | ORM/Driver | Connection |
|---------|-----------|------------|
| rohan_api | TypeORM (NestJS) | `POSTGRES_HOST/PORT/USER/PASSWORD/DB` |
| rohan-python-api | SQLModel (Alembic migrations) | `POSTGRES_SERVER/PORT/USER/PASSWORD/DB` |
| ingest-connector | psycopg2 (raw SQL) | `DB_HOST/PORT/USER/NAME/PASS` |
| Database (schema installer) | psql CLI | `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` |

---

## Feature Flags

Two systems:
1. **Database table** (`feature_flags`): 27+ flags managed via admin API. Key flags: `AEV2FileUpload`, `service_shredding`, `ProcurementWriter`, `ComplianceEnabled`, `DEVELOPER_TOOLS`
2. **Organization features** (`rohan_central.customer_features`): Per-customer feature enablement

Feature flags gate both API routes (via `FeaturesGuard` in rohan_api) and UI routes/components (via `FeatureFlagsService` in rohan_ui).

---

## Testing

| Repo | Unit | E2E | Framework |
|------|------|-----|-----------|
| rohan_api | Jest (`*.spec.ts`) | Supertest + Docker (`test/`) | `npm run test`, `npm run test:e2e:ci` |
| rohan_ui | Karma + Jasmine | Playwright 1.56.1 + Percy snapshots | `npm test`, `npm run test:e2e:ci` |
| rohan-python-api | pytest + pytest-asyncio | - | `uv run pytest` |
| ingest-connector | pytest (shared_tests/) | k3d integration tests | `python shared_tests/run_all_tests.py` |

---

## Key File Reference

### Configuration & Entry Points
- `rohan_api/src/main.ts` - NestJS bootstrap (Fastify)
- `rohan_api/src/app.module.ts` - Root module (45+ imports)
- `rohan_api/src/utils/settings.ts` - Key Vault + env config
- `rohan_ui/src/app/route-config.ts` - Dynamic route configuration
- `rohan_ui/src/app/app.module.ts` - Angular root module
- `rohan-python-api/backend/app/main.py` - FastAPI app + Service Bus lifespan
- `rohan-python-api/backend/app/core/config.py` - Pydantic settings

### Authentication & Authorization
- `rohan_api/src/auth/jwt.strategy.ts` - JWT validation (Auth0/Okta auto-detect)
- `rohan_api/src/auth/permissions/permissions.guard.ts` - Hierarchical RBAC (383 lines)
- `rohan_ui/src/app/shared-services/auth/roh-auth.service.ts` - Auth facade
- `Database/rohan_api/scripts/sql/init_organizations.sql` - RBAC schema (406 lines)

### LLM Integration
- `rohan_api/src/utils/openai/openai.helpers.service.ts` - Commercial vs Azure switching
- `rohan_api/src/utils/llm/azure.service.ts` - Azure OpenAI with model fallback
- `rohan-python-api/backend/app/domains/shared/openAI/model_Client.py` - Python OpenAI factory
- `ingest-connector/shared/oai/client_config.py` - Ingest OpenAI config
- `ingest-connector/shared/oai/vectorizer.py` - Embedding generation

### Service Bus / Messaging
- `rohan_api/src/utils/roh-azure-utils/serviceBusTopic.service.ts` - Topic subscriber
- `rohan-python-api/backend/app/azure_event_bus/queue_service.py` - Queue listener
- `rohan-python-api/backend/app/azure_event_bus/topic_service.py` - Topic publisher

### Document Processing
- `rohan-python-api/backend/app/domains/tagging/orchestrator.py` - Tagging pipeline
- `rohan-python-api/backend/app/domains/shared/docling/docling_factory.py` - Docling config
- `ingest-connector/shared/extractors/` - Multi-format extraction registry
- `ingest-connector/shared/aperture/aperture.py` - Resume/PP classification

### Deployment
- `devops-automation/Pipelines/Deployments/FleetCompiler/compile.ps1` - Fleet Compiler main
- `devops-automation/Pipelines/Deployments/FleetCompiler/release.json` - Release definitions
- `devops-automation/Pipelines/Deployments/FleetCompiler/clusters.json` - Cluster inventory

### Docker (Air-Gapped Patterns)
- `rohan_api/Dockerfile` - Tiktoken caching, Python venv
- `rohan-python-api/backend/Dockerfile` - Docling models, spaCy, tiktoken
- `ingest-connector/ingest-index/Dockerfile` - Tiktoken caching
- `ingest-connector/ingest-extract/Dockerfile` - Tesseract OCR, LibreOffice

### Prompts
- `Database/rohan_api/scripts/prompts/` - 441 prompt definition files loaded into `prompts` table
