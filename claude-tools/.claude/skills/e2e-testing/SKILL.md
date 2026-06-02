---
name: e2e-testing
description: |
  Playwright E2E testing patterns and page object model.
  Triggers on "e2e test", "playwright", "page object", "integration test", "test:e2e".
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Playwright E2E Testing Patterns

## Running E2E Tests
```bash
# rohan_api — spins up Docker DBs + runs Playwright
cd rohan_api-parent/rohan_api
npm run test:e2e:ci

# rohan_ui — spins up Docker DBs + API + Playwright
cd rohan_ui-parent/rohan_ui
npm run test:e2e:ci
```

## Page Object Model

One class per page or major component. Encapsulate selectors, expose semantic methods:

```typescript
export class ProposalListPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/proposals');
  }

  async getProposalCount(): Promise<number> {
    return this.page.getByTestId('proposal-row').count();
  }

  async clickProposal(title: string) {
    await this.page.getByRole('link', { name: title }).click();
  }

  async createProposal(title: string) {
    await this.page.getByTestId('create-proposal-btn').click();
    await this.page.getByLabel('Title').fill(title);
    await this.page.getByRole('button', { name: 'Create' }).click();
  }
}
```

## Test Organization
- Group by feature: `e2e/proposals/`, `e2e/auth/`, `e2e/settings/`
- Descriptive test names: `test('should display validation error when title is empty')`
- Tag tests: `test('create proposal @smoke', ...)` and `test('bulk export @regression', ...)`

## Selector Strategy (Priority Order)
1. `data-testid` — most stable, immune to UI refactors
2. Role-based: `getByRole('button', { name: 'Submit' })`
3. Label-based: `getByLabel('Email')`
4. Text-based: `getByText('Welcome')` (fragile to copy changes)
5. CSS selectors — last resort, avoid if possible

## Auth State Reuse
Store authenticated state to avoid login in every test:
```typescript
// global-setup.ts
const context = await browser.newContext();
const page = await context.newPage();
await loginAs(page, 'test-user@example.com');
await context.storageState({ path: 'e2e/.auth/user.json' });

// playwright.config.ts
use: {
  storageState: 'e2e/.auth/user.json',
}
```

## Waiting Patterns
- Prefer Playwright's auto-waiting (built into `click`, `fill`, `expect`)
- Use `page.waitForResponse()` when you need to wait for a specific API call
- Use `expect(locator).toBeVisible()` over manual `waitForSelector`
- Avoid `page.waitForTimeout()` — it's a test smell

## Fixture Patterns
```typescript
test.beforeEach(async ({ page }) => {
  await seedTestData();
  await page.goto('/proposals');
});

test.afterEach(async () => {
  await cleanupTestData();
});
```

## Cross-Browser
- Primary: Chromium (fastest, most used)
- CI: add Firefox and WebKit for coverage
- Configure in `playwright.config.ts` `projects` array
