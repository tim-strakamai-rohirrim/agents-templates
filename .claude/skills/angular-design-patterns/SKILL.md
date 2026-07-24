---
name: angular-design-patterns
description: |
  Modern Angular 20+ design patterns and simplification strategies. Reference for CDK overlays,
  signals (resource/linkedSignal/httpResource), zoneless change detection, state management,
  component architecture, and migration guidance.
  Triggers on "design pattern", "simplify", "best practice", "refactor architecture".
allowed-tools:
  - Read
  - Glob
  - Grep
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
  - WebSearch
---

# Angular Design Patterns & Simplification Guide (Angular 20+)

Deep-dive patterns beyond CLAUDE.md basics. **Target: Angular 20+** (signals stable, zoneless,
resource/httpResource APIs, incremental hydration). Use context7 to verify current best practices.

> rohan_ui runs Angular 20.3. All patterns here are available in the codebase today.

---

## 1. CDK Overlay Best Practices

### Focus Management
- Use `cdkTrapFocus` on overlay containers for a11y Tab containment
- Use `afterNextRender` (NOT `queueMicrotask` or `setTimeout`) to set initial focus after overlay renders

### Escape Key
- `cdkConnectedOverlay` has built-in Escape close behavior
- For nested overlays: call `event.stopPropagation()` + `event.preventDefault()` before `close()` to prevent parent overlay dismissal

### Idempotent Open/Close
- Always guard `open()` with `if (this.isOpen()) return` and `close()` with `if (!this.isOpen()) return`
- Known Angular bug: [#30426](https://github.com/angular/components/issues/30426) — repeated open/close via `(backdropClick)` breaks responsiveness

### Scroll Strategy
- Use CDK `BlockScrollStrategy` for overlay scroll prevention
- Do NOT manually toggle `overflow: hidden` on body for overlays
- Manual `overflow: hidden` IS correct for layout constraints (split-pane, fixed-height viewers)

### ARIA
- Overlays need: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`
- Trigger buttons need: `aria-haspopup="listbox|dialog"`, `aria-expanded`

---

## 2. Angular Signals Deep Dive

### computed() Best Practices
- Must be pure functions — no side effects, no async, no DOM manipulation
- Lazily evaluated and cached — free to create many `computed()` signals
- Prefer `computed()` over `effect()` for ALL derived state

### effect() Anti-Patterns
- **Never** use `effect()` to propagate state changes (causes ExpressionChanged errors, infinite loops)
- Legitimate uses: logging/analytics, localStorage sync, third-party lib integration

### linkedSignal() (stable in v19, recommended in v20+)
- Like `computed()` but writable — use for prefilled-but-editable values
- Prefer the `{ source, computation, equal? }` form for explicit reset semantics

### Async data
- Use `HttpClient` (returns Observables). Consume with `async` pipe in templates, or `toSignal()`
  when the value is needed in the component class (e.g. as a `computed()` input).
- `resource()` / `rxResource()` / `httpResource()` are experimental — do not use.

### afterRenderEffect() (v20+)
- Use instead of `afterNextRender` when the work itself depends on signals and should re-run on
  signal changes after each render. Use `afterNextRender` for one-shot post-render work.

### Zoneless Change Detection (stable in v20)
- New apps should bootstrap with `provideZonelessChangeDetection()` and drop `zone.js` from
  `polyfills`. CD is driven by signals, events, and async pipe — NOT zone patching.
- Audit before going zoneless: `setTimeout`/`setInterval` callbacks that mutate state must wrap
  writes in a signal, or call `ChangeDetectorRef.markForCheck()` explicitly.
- Third-party libs that rely on zone.js (older charting libs, some Material animations on legacy
  versions) must be tested — check context7 for compatibility.

### Service Encapsulation
```typescript
// CORRECT: private writable + public readonly
private readonly _items = signal<Item[]>([]);
readonly items = this._items.asReadonly();
```

---

## 3. State Management Decision Matrix

| Complexity | Pattern | When |
|-----------|---------|------|
| Simple | `signal()` in component | Local UI state only |
| Medium | Service + signals | Shared state, 1 feature |
| Complex | NgRx Signal Store | Cross-feature state, many devs |

### Large Service Guidelines
- 600-800 lines is acceptable if domain is inherently coupled
- Extract **stateless mapping/transform functions** to `*.utils.ts`
- Do NOT split tightly coupled state across services

---

## 4. Component Architecture

### Smart vs Dumb
- **Smart**: injects services, manages state, orchestrates business logic
- **Dumb**: `input()` + `output()` only, no service injection, pure presentation

### When to Extract
- Extract when: same pattern repeated in 3+ places
- Don't extract: one-off layout concerns, single-use wrappers
- "Three similar lines of code is better than a premature abstraction"

---

## 5. Templates & Control Flow (v20+)

- Use built-in `@if` / `@for` / `@switch` exclusively. `*ngIf` / `*ngFor` / `*ngSwitch` are
  deprecated — run `ng generate @angular/core:control-flow` on legacy files.
- `@for` requires `track` — prefer a stable id over `$index`.
- `@let` declarations let you alias expressions in templates without a wrapper component.
- Self-closing tags are supported for components with no content: `<app-foo [x]="y" />`.
- Untagged template literals (backticks) are usable in template expressions in v20+.

## 6. Component Authoring (v20+)

- **Standalone is the default.** `standalone: true` no longer needs to be specified; only set
  `standalone: false` when intentionally registering with an NgModule (e.g. rohan_ui today).
- Prefer `input()` / `input.required()` / `model()` / `output()` over `@Input` / `@Output`
  decorators. Use `viewChild()` / `contentChild()` (signal queries) over `@ViewChild` /
  `@ContentChild`.
- Use `ChangeDetectionStrategy.OnPush` always. With zoneless, OnPush is implicit but keep it
  explicit for clarity.
- Host bindings: prefer the `host: { ... }` metadata block over `@HostBinding` / `@HostListener`.

## 7. Scrolling

### Router-Level Scroll
- Best approach for scroll-to-top: `scrollPositionRestoration: 'top'` in router config

### Scroll Containers
- `ViewportScroller` only handles main viewport — cannot target arbitrary elements
- For split-pane/panel scrolling: use `element.scrollTo()` directly
