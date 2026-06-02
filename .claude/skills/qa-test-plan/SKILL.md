---
name: qa-test-plan
description: |
  Generate a QA test plan from OpenSpec specs or Angular module code.
  Outputs a markdown file with Chrome DevTools MCP steps the qa-session skill executes.
  Default mode: comprehensive (2-3 hours, every flow/state/input exhaustively tested).
  Simple mode: happy-path blitz (≤20 steps, <60s).
  Triggers on "test plan", "QA plan", "generate test plan", "create QA plan".
  Arguments: `:simple` for blitz-only plan; no argument = comprehensive (default).
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Bash
---

# QA Test Plan Generator

Generate machine-executable QA test plans for the `qa-session` skill to run
against a live Chrome browser via Chrome DevTools MCP.

> Tool reference: https://github.com/nicobailon/chrome-devtools-mcp

## Modes

| Invocation | Mode | Coverage | Target Time |
|------------|------|----------|-------------|
| `/qa-test-plan` | **Comprehensive** (default) | Every flow, every state, every input, every route. Full CRUD. State matrix. Data variation. Keyboard. A11y. Security. Performance per-page. | **2–3 hours** |
| `/qa-test-plan:simple` | **Simple** (blitz) | Happy-path only, ≤20 steps | < 60s |

Parse the argument to determine mode. No argument = comprehensive.

---

## How Chrome DevTools MCP Actually Works

The qa-session executor uses an **accessibility tree** to interact with the page.
Test plans provide **hints** (CSS selectors, text content, ARIA labels) that the
executor maps to UIDs at runtime via `take_snapshot()`.

### Actual Tool Signatures (use these, not CSS selectors)

| Tool | Actual Parameters | What the Plan Should Specify |
|------|-------------------|------------------------------|
| `navigate_page` | `url`, `type?` ("url"\|"back"\|"forward"\|"reload"), `timeout?` | The URL to navigate to |
| `click` | `uid` (from a11y tree snapshot) | Element hint: CSS selector, text content, or ARIA label |
| `fill` | `uid`, `value` | Element hint + the value to type |
| `type_text` | `text`, `submitKey?` | Raw text to type into focused element |
| `press_key` | `key` | Key name: "Enter", "Escape", "Tab", "Control+A" |
| `wait_for` | `text[]` (array of strings), `timeout?` | **Text strings** to wait for (NOT selectors) |
| `evaluate_script` | `function` (JS function declaration), `args?` | JS function returning JSON-serializable value |
| `take_snapshot` | `verbose?`, `filePath?` | When to capture a11y tree (for a11y checks) |
| `take_screenshot` | `uid?`, `filePath?`, `fullPage?`, `format?` | When to capture visual state |
| `list_console_messages` | `types?` (e.g. ["error","warn"]), `pageSize?` | Filter for error/warning types |
| `list_network_requests` | `resourceTypes?` (e.g. ["fetch","xhr"]), `pageSize?` | Which request types to inspect |
| `get_network_request` | `reqid` | Specific request ID for deep inspection |
| `lighthouse_audit` | `device?` ("desktop"\|"mobile"), `mode?` ("navigation"\|"snapshot") | Device + mode for audit |
| `resize_page` | `width`, `height` | Viewport dimensions |
| `emulate` | `viewport?`, `colorScheme?`, `networkConditions?` | Device/network emulation |

### Key Difference: `wait_for` uses TEXT not selectors

```markdown
## WRONG
- tool: wait_for
- selector: "app-question"

## CORRECT
- tool: wait_for
- text: ["Loading...", "Thinking..."]
- timeout: 10000
```

### Key Difference: `evaluate_script` uses function declarations

```markdown
## WRONG
- expression: "!!document.querySelector('[testid=\"answer\"]')"

## CORRECT
- function: "() => !!document.querySelector('[testid=\"answer\"]')"
```

---

## Step 1 — Gather Context (read-only)

### From OpenSpec (if spec path provided)

1. Read `specs/{feature}/spec.md` → extract:
   - User stories and acceptance scenarios (BDD: Given/When/Then)
   - Edge cases listed in the spec
   - Success criteria (SC-001, SC-002, etc.)
   - Out-of-scope items (don't test these)
2. Read `specs/{feature}/data-model.md` → extract:
   - Valid/invalid input ranges, field constraints
   - State transitions to verify
   - API contracts (request/response shapes)
3. Read `specs/{feature}/plan.md` → extract:
   - Entry points, routes, key components
   - Dependencies and integrations
4. Read `specs/{feature}/tasks.md` → extract:
   - Test-related tasks (T0xx with "test" or "validate" in description)

### From Angular Module (always)

1. Glob `rohan_ui/src/app/pages/{feature}/` → scan:
   - Routing module → entry URL / route path
   - Component templates → interactive elements, `[testid]` attributes, form controls
   - Services → API endpoints called
2. Grep for `testid` and `data-testid` in feature templates
3. Grep for `formControlName` in feature templates
4. Identify:
   - **Entry URL**: the route path from routing module
   - **User flows**: from spec acceptance criteria OR from component structure
   - **Interactive elements**: buttons, inputs, dropdowns, toggles, dialogs
   - **State transitions**: what changes after each action
   - **Wait indicators**: loading spinners, skeleton screens, status text
   - **Error states**: error messages, empty states, disabled states

---

## Step 2 — Extract Element Hints

For each interactive element, record the best identifier for the executor:

**Priority order** (executor uses `take_snapshot` then matches):
1. `[testid="..."]` or `[data-testid="..."]` — most stable
2. `[formControlName="..."]` — reliable for form fields
3. ARIA label or role — `aria-label="Submit"`, `role="dialog"`
4. Angular component tag — `app-chat-bar`, `mat-select`
5. Visible text content — `"Submit"`, `"Cancel"`, `"Save Changes"`

Record **both** the CSS selector hint AND the expected visible text for each
element. The executor needs both to reliably find the UID in the a11y tree.

---

## Step 3 — Write the Test Plan

Output file: `{feature}-qa-test-plan.md` in the repo root.

### Plan Header

```markdown
# {Feature Name} — QA Test Plan
<!-- Generated: {YYYY-MM-DD} | Mode: {simple|comprehensive} -->
<!-- Executor: qa-session skill via Chrome DevTools MCP -->
<!-- Input: {spec path or module path} -->

## Config
- base_url: http://localhost:4200/{route}
- viewport: 1440x900
- wait_default: 5000ms
- mode: {simple|comprehensive}
```

### Step Format

Every step must follow this exact format:

```markdown
### Step {N}: {action_description}
- tool: {tool_name}
- element: "{CSS selector hint}" | text: "{visible text hint}"
- value: "{text to type}" (fill/type_text only)
- text: ["{text1}", "{text2}"] (wait_for only — array of strings)
- function: "{JS function declaration}" (evaluate_script only)
- url: "{URL}" (navigate_page only)
- timeout: {ms} (wait_for / navigate_page only)
- expect: {expected outcome description}
```

### Step Rules

1. **One action per step** — never combine click + fill
2. **Provide element hints, not UIDs** — UIDs change every page load
3. **Use `wait_for` with TEXT strings** — not CSS selectors
4. **Use `evaluate_script` with function declarations** — `() => { return ... }`
5. **Start every flow with `navigate_page`**
6. **End every flow with a verification step** (evaluate_script or wait_for)
7. **Use visible text in wait_for** — text the user would see on screen

---

## Simple Mode Plan Structure

For `/qa-test-plan:simple` — generate ONLY this:

```markdown
## Flow: {primary_happy_path} (Blitz — {N} steps)

### Step 1: Navigate to {feature}
...
### Step N: Verify {final state}
...
```

**Constraints:**
- ≤ 20 steps total
- Happy path only — the single most important user flow
- No screenshots (executor uses evaluate_script for assertions)
- No a11y, security, or performance checks
- Budget ~3s per step = 60s total
- Timeouts: 5s default, 15s for streaming/AI responses

---

## Comprehensive Mode Plan Structure (2-3 hours)

For `/qa-test-plan` (default) — generate ALL of the following sections.

### KEY PRINCIPLE: DEPTH OVER BREADTH

The difference between a 10-minute QA and a 2-3 hour QA is **behavioral depth**.
Do NOT write "verify element exists" — write "interact with element in every
state it can be in." Every section below must test **behaviors**, not existence.

---

### Section 1: End-to-End Journeys (full lifecycle)

The most important section. Create a **fresh entity** and walk through the ENTIRE
lifecycle start to finish. This catches integration bugs that per-page testing misses.

```markdown
## E2E Journey: {lifecycle_name}
<!-- This journey creates real data and exercises the full state machine -->

### Phase 1: Setup
- Create a new entity from scratch (fill every field)
- Verify it appears in the list
- Verify API request was correct (list_network_requests + get_network_request)

### Phase 2: Progress through each state
- For each state transition in the state machine:
  - Perform the action that triggers the transition
  - Verify the UI updates (status badge, available actions, tab states)
  - Verify the API call was correct

### Phase 3: Complete & verify
- Reach the terminal state
- Verify all data persisted correctly
- Navigate away and back — verify state preserved

### Phase 4: Cleanup
- Delete/archive the entity
- Verify it moved to the correct section
- Verify it's gone from the active list
```

Generate one E2E journey for EACH major lifecycle the feature supports.
For example, compliance has:
- Project lifecycle: create → upload docs → verify items → upload responses → review → complete
- Response lifecycle: upload → run compliance → review checks → complete
- Compliance item lifecycle: auto-extracted → approve/reject → edit

Each journey should be **30-50 steps** with real data creation, not mock checks.

---

### Section 2: Per-Entity CRUD Exhaustion

For EVERY entity type the feature manages, generate a dedicated CRUD section:

```markdown
## CRUD: {EntityName}

### CREATE
- Create with all fields filled (happy path)
- Create with only required fields (minimal)
- Create with maximum length values in every field
- Create with unicode/emoji in text fields
- Create and verify it appears in the correct list
- Create and verify the API request payload matches expectations
- Attempt create with invalid data — verify each validation message

### READ
- View entity in list — verify all displayed fields match
- View entity detail — verify all fields rendered correctly
- View entity in different states — verify conditional UI per state
- Deep link directly to entity URL — verify it loads from URL params
- Refresh page — verify entity reloads correctly

### UPDATE
- Edit each editable field individually — verify save works
- Edit and cancel — verify no changes persisted
- Edit with invalid data — verify validation blocks save
- Edit and verify API PATCH request payload
- Edit and verify the list view updates to show new values

### DELETE
- Delete and verify confirmation dialog appears
- Cancel delete — verify entity still exists
- Confirm delete — verify entity removed from list
- Verify API DELETE request sent
- If soft delete: verify entity appears in archived/trash section
- If soft delete: verify restore works
```

---

### Section 3: State Transition Matrix

For EVERY state machine defined in the spec or derivable from the code, generate:

```markdown
## State Matrix: {EntityName}

### Current State: {state_A}
- Available actions: [list every button/action visible in this state]
- Disabled actions: [list every button/action that should be disabled]
- Tab/section accessibility: [which tabs are enabled/disabled]
- Status badge: verify correct label and color
- → Transition to {state_B}: perform action, verify new state
- → Attempt invalid transition to {state_C}: verify blocked with message

### Current State: {state_B}
...
```

Test EVERY valid transition. Test EVERY invalid transition (attempt to skip a state,
attempt to go backwards). Verify the UI correctly reflects which actions are available
in each state.

---

### Section 4: Per-Field Input Exhaustion

For EVERY form field in the feature, generate a complete validation matrix:

```markdown
## Field: {fieldName} ({formControlName}, {component})

| Input | Expected | Verification |
|-------|----------|--------------|
| Empty (required field) | Validation error: "{exact message from template}" | wait_for text |
| Empty (optional field) | Accepted, no error | evaluate_script |
| Single character "a" | Accepted | fill + verify |
| Exactly max length (N chars) | Accepted | fill + check value.length |
| Max length + 1 | Truncated or error: "{exact message}" | fill + verify |
| Unicode: "名前テスト" | Accepted | fill + verify rendered correctly |
| Emoji: "🎯 Test" | Accepted | fill + verify |
| RTL text: "مرحبا" | Accepted, no layout break | fill + evaluate_script |
| HTML: "<b>bold</b>" | Rendered as text, not HTML | fill + evaluate_script |
| XSS: "<script>alert(1)</script>" | Escaped, no execution | fill + verify |
| SQL: "'; DROP TABLE --" | Accepted as text | fill + verify |
| Whitespace only: "   " | Trimmed → empty → required error OR accepted | fill + verify |
| Leading/trailing spaces: " test " | Trimmed on save OR preserved | fill + save + verify |
| Paste long text (10000 chars) | Truncated or accepted | evaluate_script to set value |
| Clear and re-enter | Field clears, new value accepted | fill empty + fill new |
```

For DATE fields, additionally test:
| Input | Expected |
|-------|----------|
| Valid future date | Accepted |
| Today | Accepted |
| Yesterday | "cannot be in the past" |
| Far past (01/01/1900) | Error |
| Far future (12/31/2099) | Accepted |
| Invalid format "abc" | "Please enter a valid date" |
| Due date before start date | "must be on or after start date" |
| Same start and due date | Accepted |

For FILE UPLOAD fields, additionally test:
| Input | Expected |
|-------|----------|
| Single valid PDF | Accepted, appears in list |
| Single valid DOCX | Accepted |
| Single valid XLSX | Accepted |
| Multiple files at once | All accepted |
| Unsupported type (.txt, .jpg) | Rejected with message |
| Empty file (0 bytes) | Rejected or accepted (verify behavior) |
| Large file (>100MB) | Error with size limit |
| File with unicode name | Accepted, name displayed correctly |
| Drag and drop file | Accepted (verify drag-over state) |
| Folder upload via webkitdirectory | Creates one response per folder |

---

### Section 5: Filter, Sort, and Search Exhaustion

For EVERY list view with filters/sort/search, generate:

```markdown
## Filter/Sort: {ListName}

### Filter: {filterName}
- Select each option individually:
  - Option "A" → verify list shows only matching items
  - Option "B" → verify list shows only matching items
  - ... (every option)
- Verify counts match (if count shown)
- Clear filter → verify all items restored
- Apply filter with 0 results → verify empty state shown

### Sort: {sortField}
- Sort ascending → verify order correct (check first and last items)
- Sort descending → verify order correct
- Sort + filter combined → verify both applied

### Search: (if available)
- Search exact match → 1 result
- Search partial match → multiple results
- Search no match → empty state
- Search then clear → all items restored
- Search with special characters → no crash
- Search while typing (debounce) → verify no excessive API calls
```

---

### Section 6: User Acceptance Tests (from spec)

If an OpenSpec is provided, generate a UAT flow for **every** user story and
acceptance scenario. Each UAT must:

```markdown
## UAT: {user_story_title}
<!-- Maps to: {US1|US2|FR-001|SC-001|etc.} -->
<!-- Acceptance: {Given/When/Then from spec} -->
```

- **Execute the exact Given/When/Then** from the spec as literal steps
- **Verify each success criterion** with a dedicated assertion step
- **Cross-reference** every step to the spec requirement it validates
- **Test the negative case** for every acceptance criterion (what if it's NOT met?)
- If no spec: derive UATs from component I/O contracts and service API calls

---

### Section 7: Destructive QA (break the app)

Think like a hostile QA engineer. Generate **per-page** destructive tests, not generic ones.

```markdown
## Destructive QA

### DQA-PER-PAGE: {pageName} ({route})
For EACH route in the feature:
1. Navigate to the page
2. Build up state (fill forms, select items, open panels)
3. Refresh → verify recovery
4. Build up state again → navigate away → navigate back → verify recovery
5. Build up state → close browser tab → reopen URL → verify
6. Check list_console_messages after each recovery → zero errors

### DQA-EVERY-BUTTON: Double-click and rapid-fire
For EACH action button (not navigation):
1. Click normally → verify expected action
2. Double-click → verify only one action processed
3. Triple-click rapidly → verify debounce/disable
4. list_network_requests → verify no duplicate POST/PATCH/DELETE
5. Click while previous action is still processing → verify queued or blocked

### DQA-EVERY-FORM: Interrupt mid-form
For EACH form in the feature:
1. Fill 1 of N fields → navigate away → check for unsaved guard
2. Fill all fields → navigate away → check for unsaved guard
3. Fill all fields → refresh → verify form clears cleanly
4. Fill all fields → close dialog (if in dialog) → verify parent state clean
5. Start save → refresh mid-save → verify no corruption
6. Start save → navigate away mid-save → verify no orphaned state

### DQA-API-FAILURES: Per-endpoint error injection
For EACH API endpoint the feature calls (enumerate from service file):
1. Intercept with 500 → verify error handling (toast/modal/inline)
2. Intercept with 403 → verify auth error handling
3. Intercept with 404 → verify not-found handling
4. Intercept with timeout (30s delay) → verify loading state persists
5. Intercept with empty body {} → verify no TypeError
6. Intercept with null → verify no crash
7. list_console_messages after each → zero uncaught errors

### DQA-NAVIGATION-ABUSE
1. Use browser back/forward through EVERY route in sequence
2. Deep-link to every route directly (bookmark simulation)
3. Navigate between feature modules rapidly (compliance → proposal-writer → compliance)
4. Open same route in two tabs → interact in both → verify no conflict
```

---

### Section 8: Per-Page Accessibility

Run a11y checks on EVERY route, not just the landing page:

```markdown
## Accessibility: {route}

### Lighthouse Audit
- navigate to route
- lighthouse_audit device="desktop" mode="snapshot"
- expect: accessibility >= 90, best practices >= 90

### Full Keyboard Navigation
- Start from first focusable element
- press_key "Tab" through EVERY interactive element on the page
- After each Tab: evaluate_script to record document.activeElement tag + text
- Verify: logical order, no skipped elements, no trapped focus
- Verify: focus indicator visible on every focused element (outline/boxShadow)
- press_key "Shift+Tab" back through all elements — verify reverse order works

### Screen Reader Flow
- take_snapshot verbose=true
- Verify every interactive element has an accessible name
- Verify every image has alt text
- Verify form fields have associated labels (aria-labelledby or <label for>)
- Verify error messages are announced (role="alert" or aria-live)
- Verify status updates are announced (role="status" or aria-live="polite")

### ARIA Compliance
- Verify landmarks: main, navigation, banner, contentinfo
- Verify heading hierarchy: h1 → h2 → h3 (no skipped levels)
- Verify dialog has role="dialog" and aria-modal="true"
- Verify expandable elements have aria-expanded
- Verify disabled elements have aria-disabled or disabled attribute
- Verify selected elements have aria-selected or aria-pressed
- Verify progress bars have role="progressbar" + aria-valuenow/min/max

### Focus Management
- After dialog open → verify focus moved into dialog
- After dialog close → verify focus returned to trigger element
- After route navigation → verify focus on main content or h1
- After form error → verify focus on first invalid field
- After toast/notification → verify focus not stolen from current element
```

Repeat the above for EVERY route in the feature (not just landing page).

---

### Section 9: Security (deep)

```markdown
## Security

### XSS: Per-input exhaustion
For EVERY text input in the feature (enumerate from templates):
- fill with each of these 5 payloads:
  1. `<script>window.__xss=true</script>`
  2. `<img src=x onerror=alert(1)>`
  3. `"><script>alert(1)</script>`
  4. `javascript:alert(1)`
  5. `{{constructor.constructor('return this')()}}`
- After each: evaluate_script `() => !window.__xss`
- After each: verify the text is rendered as escaped text (not HTML)
- Submit the form → verify XSS doesn't trigger after server round-trip

### API Contract Validation
For EACH API endpoint called by the feature:
- list_network_requests after the call
- get_network_request for the specific request
- Verify: correct HTTP method (GET/POST/PATCH/DELETE)
- Verify: correct URL path
- Verify: request Content-Type header
- Verify: auth header present (Bearer token or cookie)
- Verify: response status code (200/201/204)
- Verify: response Content-Type is application/json
- Verify: no credentials in URL query string

### Authorization Boundary
- Navigate directly to a project URL that belongs to another user (if testable)
- Expect: 403 or redirect, NOT data from another user's project
- Modify URL params to invalid UUIDs → verify graceful error

### Console & Storage Audit
- After full session: list_console_messages types=["error","warn"]
- Verify: no auth tokens, no PII, no stack traces with internal paths
- evaluate_script to dump all localStorage + sessionStorage keys
- Verify: no plaintext passwords, secrets, or API keys
```

---

### Section 10: Performance (per-page)

```markdown
## Performance: {route}

### Lighthouse
- navigate_page to route
- lighthouse_audit device="desktop" mode="navigation"
- Record: performance score, LCP, CLS, TBT, FCP

### Network Analysis
- After navigation, list_network_requests
- Count: total requests, XHR/fetch requests, duplicate calls
- For each XHR/fetch: get_network_request → record response size
- Flag: any response > 500KB, any duplicate endpoint calls
- Verify: no failed requests (non-2xx, except expected ones)

### Timing
- evaluate_script: performance.getEntriesByType('navigation')[0]
- Record: domContentLoaded, loadComplete, TTFB
- Verify against spec targets (SC-001: <2s, SC-002: <500ms tab switch)

### Memory
- Before: evaluate_script performance.memory.usedJSHeapSize
- Interact: perform 10 typical user actions (navigate, click, fill, back)
- After: evaluate_script performance.memory.usedJSHeapSize
- Flag if growth > 30%
```

Repeat for EVERY route in the feature.

---

### Section 11: Desktop Layout (per-page)

Desktop-only application. No tablet or mobile.

```markdown
## Layout: {route}

### Viewport: 1440x900 (standard)
- resize_page 1440 900
- navigate to route
- evaluate_script: document.documentElement.scrollWidth <= 1440
- evaluate_script: verify no overflow or layout issues

### Viewport: 1280x720 (small desktop)
- resize_page 1280 720
- evaluate_script: no overflow
- evaluate_script: split-screen panels don't overlap (if applicable)
- evaluate_script: verify no overflow or layout issues

### Viewport: 1920x1080 (large monitor)
- resize_page 1920 1080
- evaluate_script: content has max-width or fills gracefully
- evaluate_script: verify no overflow or layout issues
```

Repeat for EVERY route in the feature.

---

## Screenshot Policy

**Only take screenshots on FAILURE.** When a step FAILs, take a screenshot immediately
for diagnosis. Do NOT take screenshots for passing steps, visual records, or state
documentation. This keeps the session fast and focused.

The qa-session executor should:
- On PASS: move to next step (no screenshot)
- On FAIL: `take_screenshot` → save to `{feature}-qa-screenshots/FAIL-{step-id}.png` → continue

---

## Step 4 — Validate Plan

### Simple Mode Checklist
- [ ] Total steps ≤ 20
- [ ] Every element hint maps to a real attribute in Angular templates
- [ ] `wait_for` steps use visible text strings, not CSS selectors
- [ ] `evaluate_script` steps use function declarations `() => ...`
- [ ] Flow starts with `navigate_page` and ends with verification
- [ ] Timeouts: 5s default, 15s for streaming/AI responses

### Comprehensive Mode Checklist
- [ ] **S1 E2E Journeys**: one journey per major lifecycle, each 30-50 steps, creates REAL data
- [ ] **S2 CRUD**: Create/Read/Update/Delete for EVERY entity type
- [ ] **S3 State Matrix**: every valid + invalid transition for every state machine
- [ ] **S4 Per-Field**: every form field × every input type (empty, max, unicode, XSS, dates, files)
- [ ] **S5 Filter/Sort/Search**: every option individually, combined, edge cases
- [ ] **S6 UAT**: every user story, every acceptance scenario, every success criterion
- [ ] **S7 Destructive QA**: per-page refresh, per-button double-click, per-form interrupt, per-endpoint error injection
- [ ] **S8 A11y**: lighthouse + keyboard + screen reader + ARIA on EVERY route
- [ ] **S9 Security**: per-input XSS, API contract validation, authorization boundaries
- [ ] **S10 Performance**: lighthouse + network + timing + memory on EVERY route
- [ ] **S11 Layout**: 1440/1280/1920 on EVERY route
- [ ] **Screenshots**: ONLY on failures (no visual records for passing steps)
- [ ] Total estimated steps: 300-600+ (2-3 hours at ~15-20s per step average)
- [ ] Every `wait_for` uses `text[]` (array of visible strings)
- [ ] Every `evaluate_script` uses `function` (JS function declaration)
- [ ] File saved to repo root as `{feature}-qa-test-plan.md`
