---
name: database-migrations
description: |
  Safe database migration patterns for Alembic and TypeORM.
  Triggers on "migration", "alembic", "schema change", "add column", "database change".
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Database Migration Patterns

## Alembic (rohan-python-api)

### Creating Migrations
```bash
cd rohan-python-api/backend
# Inside Docker container or with DB access:
alembic revision --autogenerate -m "add_status_column_to_runs"
alembic upgrade head
alembic downgrade -1
```

### Autogenerate Limitations
Autogenerate does NOT detect: column renames, table renames, changes to constraints without column changes. Write these manually.

### Data Migrations
Separate schema migrations from data migrations. For data backfills, use a dedicated migration:
```python
def upgrade():
    op.execute("UPDATE runs SET status = 'pending' WHERE status IS NULL")

def downgrade():
    op.execute("UPDATE runs SET status = NULL WHERE status = 'pending'")
```

## TypeORM (rohan_api)

### Creating Migrations
```bash
cd rohan_api-parent/rohan_api
npm run migration:generate -- src/migrations/AddStatusColumn
npm run migration:run
npm run migration:revert
```

## Zero-Downtime Patterns

### Add a Required Column
1. Add column as NULLABLE (no default needed)
2. Deploy code that writes to the new column
3. Backfill existing rows
4. Add NOT NULL constraint
5. Deploy code that reads from the new column

### Rename a Column
1. Add new column
2. Deploy code that writes to BOTH old and new columns
3. Backfill new column from old column
4. Deploy code that reads from new column only
5. Drop old column in a later migration

### Add an Index on a Large Table
```sql
CREATE INDEX CONCURRENTLY idx_name ON table (column);
```
Always use `CONCURRENTLY` to avoid locking the table. In Alembic, `CONCURRENTLY` cannot run inside a transaction — use `autocommit_block()`:
```python
from alembic import op

def upgrade():
    with op.get_context().autocommit_block():
        op.execute("CREATE INDEX CONCURRENTLY idx_name ON table (column)")
```

## Dangerous Operations Checklist

| Operation | Risk | Mitigation |
|-----------|------|------------|
| DROP COLUMN | Data loss | Ensure no code references it; keep backup |
| Column type change | Data loss / lock | Add new column, migrate data, drop old |
| ADD NOT NULL | Fails on existing NULLs | Backfill first, then add constraint |
| DROP TABLE | Irreversible | Rename to `_deprecated` first, drop later |
| Large table index | Table lock | Use `CONCURRENTLY` |

## Rollback Strategy
- Every `upgrade()` MUST have a working `downgrade()`
- Test the cycle: `upgrade head` → `downgrade -1` → `upgrade head`
- If a migration is not reversible (e.g., data destruction), document it explicitly in the migration file

## Testing Migrations
Before merging, verify:
1. `alembic upgrade head` succeeds from current production state
2. `alembic downgrade -1` succeeds
3. `alembic upgrade head` succeeds again (idempotent)
4. Application starts and passes health checks after migration
