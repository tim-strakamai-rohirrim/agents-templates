---
name: jira-ticket
description: |
  Create Jira tickets under an epic with consistent formatting.
  Triggers on "create jira", "new ticket", "add jira task".
allowed-tools:
  - Read
  - mcp__atlassian__createJiraIssue
  - mcp__atlassian__getVisibleJiraProjects
  - mcp__atlassian__getJiraProjectIssueTypesMetadata
  - mcp__atlassian__searchJiraIssuesUsingJql
  - mcp__atlassian__lookupJiraAccountId
---

# Create Jira Ticket

Create consistently formatted Jira tickets under an epic.

## Process

1. **Ask for**: epic key (or search for it), ticket title, description, assignee
2. **Look up**: project metadata, issue types, account IDs
3. **Create ticket** with:
   - Summary: concise title
   - Description: acceptance criteria in checkbox format
   - Issue type: Story (default), Task, or Bug
   - Epic link: parent epic key
   - Labels: frontend, backend, or both

## Ticket Format

```
### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

### Technical Notes
- Relevant file paths or API endpoints
- Dependencies on other tickets
```
