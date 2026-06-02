---
name: qa-session
description: |
  Execute a QA test plan on a live Chrome browser using Chrome DevTools MCP.
  Blitz mode completes flows in under 60 seconds.
  Triggers on "QA session", "run QA", "test the app", "blitz test", "run test plan".
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__click
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__fill
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__type_text
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__press_key
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_pages
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__select_page
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__wait_for
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__resize_page
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__emulate
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_console_messages
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_network_requests
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_network_request
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_snapshot
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__upload_file
  - mcp__plugin_chrome-devtools-mcp_chrome-devtools__lighthouse_audit
---

# QA Session — Chrome DevTools MCP Executor

Execute a QA test plan against a live Chrome browser using Chrome DevTools MCP.

> **Prerequisite**: Chrome DevTools MCP must be installed as a Claude Code plugin.
> Docs: https://github.com/nicobailon/chrome-devtools-mcp

## Tool Prefix

All tools use: `mcp__plugin_chrome-devtools-mcp_chrome-devtools__`

Shorthand → full name:
- `click` → `...click` (params: `uid`)
- `fill` → `...fill` (params: `uid`, `value`)
- `type_text` → `...type_text` (params: `text`, `submitKey?`)
- `press_key` → `...press_key` (params: `key`)
- `navigate_page` → `...navigate_page` (params: `url`, `type?`, `timeout?`)
- `wait_for` → `...wait_for` (params: `text[]`, `timeout?`)
- `evaluate_script` → `...evaluate_script` (params: `function`, `args?`)
- `take_screenshot` → `...take_screenshot` (params: `uid?`, `filePath?`, `fullPage?`)
- `take_snapshot` → `...take_snapshot` (params: `verbose?`, `filePath?`)
- `list_pages` → `...list_pages`
- `select_page` → `...select_page`
- `list_console_messages` → `...list_console_messages` (params: `types?[]`)
- `list_network_requests` → `...list_network_requests` (params: `resourceTypes?[]`)
- `get_network_request` → `...get_network_request` (params: `reqid`)
- `lighthouse_audit` → `...lighthouse_audit` (params: `device?`, `mode?`)
- `resize_page` → `...resize_page` (params: `width`, `height`)
- `emulate` → `...emulate` (params: `viewport?`, `colorScheme?`, `networkConditions?`)

## Critical: How Element Interaction Works

Chrome DevTools MCP uses **accessibility tree UIDs**, NOT CSS selectors.

**Workflow for every click/fill/hover:**
1. Call `take_snapshot()` → get the page's a11y tree with UIDs (e.g. `@e20`, `@e45`)
2. Read the test plan step's element hint (CSS selector, text, ARIA label)
3. Match the hint to the correct UID in the snapshot
4. Call `click(uid="@e20")` or `fill(uid="@e20", value="...")`

**Workflow for wait_for:**
- `wait_for` takes a `text` parameter — an **array of strings**
- It waits for ANY of those text strings to appear on the page
- Example: `wait_for(text=["Loading complete", "Results found"])`
- It does NOT accept CSS selectors

**Workflow for evaluate_script:**
- Takes a `function` parameter — a **JavaScript function declaration**
- Must return a JSON-serializable value
- Example: `evaluate_script(function="() => !!document.querySelector('[testid=\"answer\"]')")`

## Speed Rules (CRITICAL for Blitz Mode)

1. **Reuse snapshots** — don't take a new snapshot before every action. Take one snapshot, use it for multiple consecutive steps on the same page state. Take a new snapshot only after navigation or a state change (click, fill).
2. **Use `wait_for` with visible text** — faster than evaluate_script for simple "did it load?" checks
3. **Skip screenshots** — use evaluate_script for assertions in blitz mode
4. **Skip optional/edge-case flows** in blitz mode
5. **Budget: ~3s per step, 20 steps max = 60s**
6. **No a11y/lighthouse in blitz** — those go in comprehensive mode
7. **Batch-read the plan** — read the whole plan file once, don't re-read per step

## Execution Protocol

### Phase 0: Setup
1. `list_pages` → see what's open in Chrome
2. Look for the test plan file: `{feature}-qa-test-plan.md` from repo root
   - If the argument is a file path (e.g. `compliance-qa-test-plan.md`), read that directly
   - If the argument is a feature name, look for `{feature}-qa-test-plan.md`
   - **If no test plan exists**: tell the user to run `/qa-test-plan {feature}` first, then re-run `/qa-session`
3. Determine mode from plan's `## Config` section:
   - `mode: simple` → blitz execution (happy path only)
   - `mode: comprehensive` → full execution (all sections)
4. Parse all steps into ordered list

### Phase 1: Execute Steps

**Navigate:**
```
→ navigate_page(url="http://localhost:4200/feature")
→ wait_for(text=["expected visible text"])
```

**Find element + interact:**
```
→ take_snapshot()              # get a11y tree with UIDs
→ click(uid="@e20")            # match element hint to UID, then click
```

**Fill text input:**
```
→ take_snapshot()              # if not already fresh
→ click(uid="@e20")            # focus the input
→ fill(uid="@e20", value="question text")
```

**Press key:**
```
→ press_key(key="Enter")       # no UID needed
```

**Wait for element/text:**
```
→ wait_for(text=["Results", "Loading complete"], timeout=10000)
```

**Assert via JavaScript:**
```
→ evaluate_script(function="() => !!document.querySelector('[testid=\"answer\"]')")
```

**Accessibility check (comprehensive only):**
```
→ take_snapshot(verbose=true)  # full a11y tree
→ lighthouse_audit(device="desktop", mode="snapshot")
```

**Network check (comprehensive only):**
```
→ list_network_requests(resourceTypes=["fetch", "xhr"])
→ get_network_request(reqid=5)  # deep inspect specific request
```

**Console check:**
```
→ list_console_messages(types=["error", "warn"])
```

### Phase 2: Report
After all steps complete, write `{feature}-qa-results.md`:

```markdown
# {Feature} — QA Results
<!-- Run: {timestamp} | Duration: {elapsed}s | Mode: {simple|comprehensive} -->

## Summary
- Steps: {total} | Passed: {pass} | Failed: {fail} | Skipped: {skip}
- Duration: {seconds}s
- Verdict: PASS / FAIL

## Results

| # | Section | Step | Result | Notes |
|---|---------|------|--------|-------|
| 1 | Flow: Happy Path | Navigate to /feature | PASS | Page loaded |
| 2 | Flow: Happy Path | Fill input | PASS | Text entered |
...

## Failures (if any)

### FAIL — Step {N}: {description}
- Section: {flow/edge-case/a11y/security/performance/responsive}
- Expected: {expect}
- Actual: {what happened}
- Screenshot: {path if taken}

## A11y Results (comprehensive only)
- Lighthouse accessibility: {score}/100
- Label check: {pass/fail} — {N} unlabeled elements
- Keyboard nav: {pass/fail}
- Focus trap: {pass/fail}

## Security Results (comprehensive only)
- XSS check: {pass/fail}
- Console leak check: {pass/fail}
- Network inspection: {pass/fail}
- Storage inspection: {pass/fail}

## Performance Results (comprehensive only)
- Lighthouse desktop: {score}/100
- Lighthouse mobile: {score}/100
- Network requests: {count}
- Largest payload: {size}

## Bugs Filed

| ID | Severity | Section | Description |
|----|----------|---------|-------------|
| BUG-001 | P1 | Flow | ... |
```

## Error Recovery

- **Element not found in snapshot**: Retake snapshot. If still missing after 2 attempts, FAIL and continue.
- **wait_for timeout**: FAIL the step, take a screenshot for diagnosis, continue.
- **Page not loaded**: Retry `navigate_page` once. If still not loaded, FAIL.
- **Unexpected dialog**: `handle_dialog(action="accept")` then continue.
- **Console errors**: Log them but don't stop execution — report in results.
- **Lighthouse fails to run**: Skip with SKIP status, note in results.

## Modes

### Blitz (simple plan)
- Execute only `## Flow:` sections
- No screenshots (evaluate_script for assertions)
- No a11y, security, performance, or responsive sections
- Target: < 60 seconds

### Comprehensive (default plan)
- Execute ALL sections in order: E2E Journeys → CRUD → State Matrix → Per-Field → Filters → UAT → Destructive → A11y → Security → Performance → Layout
- **Screenshots ONLY on failures** — on FAIL, take_screenshot for diagnosis then continue
- `lighthouse_audit` for a11y + performance on every route
- `take_snapshot(verbose=true)` for a11y tree inspection
- `list_console_messages` + `list_network_requests` throughout
- Target: 2–3 hours
