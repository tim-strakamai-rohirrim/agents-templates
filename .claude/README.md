# .claude — Shared Agents, Skills & Commands

Shared [Claude Code](https://docs.anthropic.com/en/docs/claude-code) configuration for the Rohan monorepo. This repo is symlinked (or copied) into the root of the working directory as `.claude/` so that every developer gets the same agents, skills, slash commands, and plugin settings out of the box.

## Monorepo structure

```
www/                              # monorepo root
├── .claude/          <── this repo
│   ├── agents/                   # Subagents for complex multi-step tasks
│   ├── commands/                 # Slash commands (OPSX workflow)
│   ├── skills/                   # Skills invoked with /skill-name
│   ├── settings.json             # Plugin config (Chrome DevTools, Figma, etc.)
│   └── launch.json               # Dev server launch configs
├── rohan_ui/                     # Angular 19 frontend
├── rohan_api/                    # NestJS backend
├── rohan-python-api/             # FastAPI (LLM/AI services)
├── Database/                     # SQL migrations and seed scripts
└── LocalDev/                     # Docker compose for local dev
```

## Setup

**Option A — Symlink (recommended)**

```bash
cd ~/www
ln -s /path/to/this/repo .claude
```

**Option B — Git submodule**

```bash
cd ~/www
git submodule add https://github.com/rohancapture/.claude.git .claude
```

After either option, restart Claude Code. It auto-discovers `.claude/` in the working directory.

---

## What's included

### Skills

Skills are slash commands that load specialized prompts into your conversation.

#### Project-Specific Skills

| Skill                | Trigger                      | What it does                                                                         |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `/context-bootstrap` | `bootstrap`, `load context`  | Loads spec files + backend module + frontend overview for a feature                  |
| `/wire-backend`      | `wire backend`, `sync api`   | Compares backend API changes against frontend types and updates to match             |
| `/orchestrate`       | `orchestrate`, `multi-agent` | Launches multi-agent implementation loops (implementer + quality-gate + test-runner) |
| `/jira-ticket`       | `create jira`, `new ticket`  | Creates Jira tickets under an epic with consistent formatting                        |
| `/azure-logs`        | `azure logs`, `staging logs` | Pulls live logs from any service in any AKS environment                              |
| `/minio-client`      | `minio`, `object storage`    | Connects to MinIO via AKS port-forward to browse/manage buckets                      |

#### Planning Pipeline Skills

A complete plan-to-PR workflow. Use these in sequence for structured feature implementation.

| Skill                | Trigger                               | What it does                                                                  |
| -------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `/planner-architect` | `plan`, `architect`, `create a plan`  | Produces `PLAN.md` + `contracts.md` with phased implementation metadata       |
| `/implement-phase`   | `implement phase`, `do phase N`       | Picks up a phase from the plan, implements step-by-step, verifies, commits    |
| `/stacked-branches`  | `create phase branch`, `stack status` | Manages `{user}/{ticket}/phase-{N}` branch stacks with rebase support         |
| `/git-commit`        | `commit`, `save changes`              | Drafts a commit message from the diff and commits across multi-repo workspace |

#### PR Skills

| Skill        | Trigger                         | What it does                                                                                          |
| ------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/create-pr` | `create PR`, `PR for phase`     | **Creates** a GitHub PR for a completed phase branch with plan compliance + security review gates     |
| `/pr-review` | `pr review`, `resolve comments` | **Responds to** comments on an existing PR — triages, fixes valid issues, pushes back on invalid ones |

Use `/create-pr` when you've finished implementing a phase and need to open the PR. Use `/pr-review` when a PR already exists and has reviewer comments that need to be addressed.

#### QA Skills

| Skill           | Trigger                  | What it does                                                          |
| --------------- | ------------------------ | --------------------------------------------------------------------- |
| `/qa-test-plan` | `test plan`, `QA plan`   | Generates comprehensive or blitz test plans from specs + Angular code |
| `/qa-session`   | `run QA`, `test the app` | Executes a test plan against Chrome via DevTools MCP                  |

#### Angular Skills

| Skill                      | Trigger                           | What it does                                                     |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `/angular-templates`       | `create component`, `add service` | Quick-reference Angular 19+ component and service patterns       |
| `/angular-design-patterns` | `design pattern`, `simplify`      | Modern Angular patterns: CDK overlays, signals, state management |
| `/rxjs-patterns`           | `observables`, `subscriptions`    | RxJS patterns for Angular: subscriptions, async data, streaming  |

#### Reference Skills (ECC-inspired)

Best-practice reference guides adapted from [everything-claude-code](https://github.com/affaan-m/everything-claude-code) for the project's stack.

| Skill                  | Trigger                                   | What it does                                                             |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `/postgres-patterns`   | `query optimization`, `pgvector`, `index` | PostgreSQL + pgvector optimization: indexing, query tuning, ORM patterns |
| `/database-migrations` | `migration`, `alembic`, `schema change`   | Safe migration patterns for Alembic and TypeORM                          |
| `/api-design`          | `api design`, `endpoint`, `pagination`    | REST API design consistency across NestJS and FastAPI                    |
| `/coding-standards`    | `coding standards`, `style guide`         | Universal coding standards: types, naming, error handling, comments      |
| `/e2e-testing`         | `e2e`, `playwright`, `page object`        | Playwright E2E patterns: Page Object Model, fixtures, selectors          |
| `/docker-patterns`     | `docker`, `compose`, `container`          | Docker and Compose patterns for local dev and AKS deployment             |
| `/python-patterns`     | `python`, `fastapi`, `pydantic`           | Python idioms for FastAPI: type hints, Pydantic, async, SQLAlchemy 2.0   |
| `/python-testing`      | `pytest`, `python test`, `fixtures`       | pytest patterns: fixtures, mocking, FastAPI TestClient, coverage         |

#### Process Skills (ECC-inspired)

| Skill                | Trigger                         | What it does                                                      |
| -------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `/verification-loop` | `verify`, `run tests`, `lint`   | Structured lint → build → test loop with repo-specific commands   |
| `/strategic-compact` | `compact`, `context management` | When and how to compact context in long sessions                  |
| `/search-first`      | `search first`, `research`      | Research-before-coding discipline: search codebase before writing |

### Agents

Agents are subprocesses spawned by Claude Code for isolated, multi-step tasks.

#### Implementation Agents

| Agent               | When to use                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `orchestrator`      | Multi-agent implementation with quality loops (implementer → quality-gate → test-runner) |
| `implementer`       | Write Angular code from requirements (spawned by orchestrator)                           |
| `bug-fixer`         | Read bug list, cross-reference with spec, plan and execute fixes                         |
| `plan-orchestrator` | Tim's autonomous multi-phase plan execution (assess → implement → review → PR per phase) |

See the [Common Workflows](#common-workflows) section for more details on the different orchestrators.

#### Review Agents

| Agent                 | When to use                                                                       |
| --------------------- | --------------------------------------------------------------------------------- |
| `quality-gate`        | Code review — STRICT mode for loops, ADVISORY for general review                  |
| `typescript-reviewer` | Dedicated TypeScript review for NestJS + Angular (type safety, patterns, hygiene) |
| `python-reviewer`     | Dedicated Python review for FastAPI + SQLAlchemy (type hints, async, Pydantic)    |
| `database-reviewer`   | PostgreSQL + pgvector review (N+1 detection, index analysis, migration safety)    |
| `security-reviewer`   | Security-focused review (injection, auth bypass, secrets, SSRF, XSS)              |

#### Utility Agents

| Agent                   | When to use                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `build-error-resolver`  | Diagnose and fix build errors across all repos (npm, uv, Docker)      |
| `refactor-cleaner`      | Find and remove dead code, unused imports, orphaned files             |
| `test-runner`           | Run tests and analyze results in isolation                            |
| `angular-explorer`      | Explore component hierarchies, service dependencies, module structure |
| `figma-analyzer`        | Analyze Figma designs and translate to Angular components             |
| `accessibility-checker` | Validate WCAG compliance using Axe + Context7                         |
| `audit-scss`            | Audit SCSS files for best practices, ng-deep violations, modern CSS   |

### Commands (`/opsx:*`)

OPSX slash commands for the OpenSpec workflow:

| Command         | What it does                                                    |
| --------------- | --------------------------------------------------------------- |
| `/opsx:propose` | Propose a new change — generate all artifacts in one step       |
| `/opsx:apply`   | Implement tasks from an OpenSpec change                         |
| `/opsx:explore` | Think through ideas, investigate problems, clarify requirements |
| `/opsx:archive` | Archive a completed change                                      |

### Plugins (settings.json)

Pre-configured plugins that agents and skills depend on:

| Plugin                    | Used by                        |
| ------------------------- | ------------------------------ |
| `chrome-devtools-mcp`     | `/qa-session`, `/qa-test-plan` |
| `frontend-design` (Figma) | `figma-analyzer` agent         |
| `GitHub`                  | `/create-pr`, `/pr-review`     |
| `typescript-lsp`          | `quality-gate`, `implementer`  |
| `serena`                  | Code navigation                |

---

## Common workflows

### Plan and implement a feature phase-by-phase (manual) (Tim's approach to full-stack work)

```
/planner-architect PRCR-1234       # produces PLAN.md + contracts.md
/implement-phase 1                 # implements phase 1, verifies, commits
/create-pr 1                       # creates PR with review gates
/implement-phase 2                 # implements phase 2 (stacked on phase 1)
/create-pr 2                       # creates stacked PR
```

### Plan and implement a feature all at once (autonomous)

Same pipeline as above, but the `plan-orchestrator` agent drives the entire loop for you — it implements each phase, runs parallel reviews, and creates the PR before moving on to the next one.

```
/planner-architect PRCR-1300       # produces PLAN.md + contracts.md
Run the plan                       # plan-orchestrator takes over
```

```
plan-orchestrator (per phase, automatically):
  ├── assess phase status (branches + PRs)
  ├── implement-phase skill → codes, tests, commits on stacked branch
  ├── plan compliance review → verifies vs acceptance criteria    ┐ parallel
  ├── security-reviewer → scans for vulnerabilities               ┘
  └── create-pr skill → pushes branch, creates stacked PR
```

You can also target specific phases: `"Implement phase 3"` or a range: `"Run phases 2 through 5"`.

### QA a feature

```
/qa-test-plan compliance module     # generates compliance-qa-test-plan.md
/qa-session compliance-qa-test-plan.md  # executes against Chrome
```

### Implement a feature with quality loops (Anees's approach for front-end work)

```
/orchestrate build the rubric editor component
```

This spawns implementer → quality-gate → test-runner in cycles until the code passes review.

### Wire up a backend PR

```
/wire-backend PR #1705
```

Analyzes the backend changes, compares against frontend types/services, and updates the frontend to match.

### Review code

```
# General review
invoke typescript-reviewer on the changes in src/compliance/

# Database-focused review
invoke database-reviewer on the migration and query changes

# Security review
invoke security-reviewer on the diff
```

### Start a new feature from scratch

```
/opsx:propose       # propose a change with design, specs, and tasks
/opsx:apply         # implement the tasks
/opsx:archive       # archive when done
```

### Debug a live environment

```
/azure-logs staging rohan-api     # tail API logs from staging
/minio-client                     # browse object storage
```

### Verify changes

```
/verification-loop                # runs lint → build → test for the affected repo
```

---

## Adding new skills or agents

**Skill**: Create `skills/{name}/SKILL.md` with YAML frontmatter (`name`, `description`, `allowed-tools`) followed by the skill prompt.

**Agent**: Create `agents/{name}.md` with YAML frontmatter (`name`, `description`, `model`, `color`, `tools`) followed by the agent prompt.

**Command**: Create `commands/{name}.md` with YAML frontmatter (`description`) followed by the command prompt.

See existing files for examples of the frontmatter format.

---

## Origins

- **Project-specific skills** (planning pipeline, Angular, QA, Azure, MinIO, wire-backend): Built in-house for the Rohan project's multi-repo workflow.
- **Reference and review skills/agents** (postgres-patterns, database-migrations, api-design, coding-standards, e2e-testing, docker-patterns, python-patterns, python-testing, strategic-compact, search-first, verification-loop, typescript-reviewer, python-reviewer, database-reviewer, build-error-resolver, security-reviewer, refactor-cleaner): Inspired by [everything-claude-code](https://github.com/affaan-m/everything-claude-code) and adapted for the project's stack.
