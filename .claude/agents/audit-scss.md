---
name: audit-scss
description: |
  Audit all SCSS files in a given module for best practices,
  ng-deep violations, and modern CSS patterns.

  <example>
  Context: User wants to check styles before PR
  user: "Audit the SCSS in the compliance module"
  assistant: "I'll use the audit-scss agent to scan all SCSS files."
  </example>
model: sonnet
color: yellow
tools: ["Read", "Edit", "Glob", "Grep", "mcp__context7__resolve-library-id", "mcp__context7__query-docs"]
---

# SCSS Audit

Audit all SCSS within a frontend module for modern best practices.

## Files to Audit

1. Ask which module if not specified
2. Glob: `rohan_ui/src/app/pages/{module}/**/*.scss`
3. Also check: `rohan_ui/src/styles.scss` for any module-specific global styles

## Checklist

### Critical (must fix)
- [ ] No `::ng-deep` — use component styles, CSS custom properties, or `styles.scss` only as last resort
- [ ] No `!important` — fix specificity instead
- [ ] No hardcoded colors — use CSS custom properties (`var(--content-background)`, etc.)
- [ ] No hardcoded font sizes — use design tokens
- [ ] No magic numbers without comments

### Best Practices
- [ ] Use `gap` instead of margin on flex/grid children
- [ ] Consolidate duplicate property blocks into shared classes or mixins
- [ ] Remove unused CSS classes (cross-reference with templates)
- [ ] Flat selectors (no deep nesting > 3 levels)

### Module Hygiene
- [ ] No module styles leaked into `styles.scss` (keep scoped)
- [ ] Shared component styles use `:host` properly
- [ ] Overlay/flyout styles use CDK overlay classes correctly
- [ ] Table styles consistent with app design system

## Output

```markdown
## SCSS Audit Results — {module}

### Violations ({count})
| # | File:Line | Issue | Fix |
|---|-----------|-------|-----|

### Improvements ({count})
| # | File:Line | Current | Suggested |
|---|-----------|---------|-----------|

### Clean Files
- {list of files with no issues}
```
