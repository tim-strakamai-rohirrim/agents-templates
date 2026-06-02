---
name: angular-design-patterns
description: |
  Modern Angular design patterns and simplification strategies. Reference for CDK overlays,
  signals, state management, component architecture, and migration guidance.
  Triggers on "design pattern", "simplify", "best practice", "refactor architecture".
allowed-tools:
  - Read
  - Glob
  - Grep
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
  - WebSearch
---

# Angular Design Patterns & Simplification Guide

Deep-dive patterns beyond CLAUDE.md basics. Use context7 to verify current best practices.

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

### linkedSignal() (Angular 19+)
- Like `computed()` but writable — use for prefilled-but-editable values

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

## 5. Scrolling

### Router-Level Scroll
- Best approach for scroll-to-top: `scrollPositionRestoration: 'top'` in router config

### Scroll Containers
- `ViewportScroller` only handles main viewport — cannot target arbitrary elements
- For split-pane/panel scrolling: use `element.scrollTo()` directly
