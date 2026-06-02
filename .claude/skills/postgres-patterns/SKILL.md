---
name: postgres-patterns
description: |
  PostgreSQL + pgvector optimization patterns for query tuning, indexing, and ORM usage.
  Triggers on "query optimization", "pgvector", "database performance", "index", "N+1".
allowed-tools:
  - Read
  - Glob
  - Grep
---

# PostgreSQL + pgvector Patterns

## Query Optimization

### EXPLAIN ANALYZE
Always check query plans before and after optimization:
```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT ...;
```
Look for: sequential scans on large tables, nested loops with high row counts, sorts without indexes.

### Index Selection
| Index Type | Use Case |
|-----------|----------|
| B-tree | Equality, range, sorting (default) |
| GIN | JSONB containment, full-text search, array ops |
| GiST | Geometric, range types, nearest-neighbor |
| Partial | Filtered subset (e.g., `WHERE deleted_at IS NULL`) |

Prefer partial indexes for soft-delete patterns:
```sql
CREATE INDEX idx_active_users ON users (email) WHERE deleted_at IS NULL;
```

## pgvector

### Index Types
| Index | Build Speed | Query Speed | Recall | Memory |
|-------|------------|-------------|--------|--------|
| IVFFlat | Fast | Fast | ~95% with good `lists` | Low |
| HNSW | Slow | Fastest | ~99% | High |

Use HNSW for production search quality. Use IVFFlat for large datasets where build time matters.

### Distance Operators
| Operator | Distance | Use Case |
|----------|----------|----------|
| `<->` | L2 (Euclidean) | Default for most embeddings |
| `<=>` | Cosine | Normalized embeddings (OpenAI) |
| `<#>` | Inner product | When vectors are pre-normalized |

### Tuning
```sql
-- IVFFlat: set probes to sqrt(lists) as starting point
SET ivfflat.probes = 10;

-- HNSW: increase ef_search for better recall (default 40)
SET hnsw.ef_search = 100;
```

## Connection Pooling
- Use PgBouncer or built-in pool in SQLAlchemy/TypeORM
- Transaction mode for short-lived queries, session mode for prepared statements
- Set pool size to `(2 * cpu_cores) + effective_spindle_count` as baseline

## TypeORM (NestJS API)
- Use QueryBuilder for complex joins/subqueries; repository methods for simple CRUD
- Avoid `eager: true` on relations — load explicitly with `relations` option or QueryBuilder `.leftJoinAndSelect()`
- Use `select` to limit returned columns on heavy entities
- Watch for N+1: if iterating entities and accessing relations, use `createQueryBuilder` with joins

## SQLAlchemy (Python API)
- Use async sessions (`async_sessionmaker`) for FastAPI endpoints
- Scope sessions per-request via FastAPI dependency injection
- Use `selectinload()` or `joinedload()` to avoid lazy-load N+1
- Prefer `select()` statement style (2.0) over legacy `session.query()`

## Anti-Patterns
- **SELECT \***: Always specify columns, especially with vector columns (large payloads)
- **Missing WHERE on UPDATE/DELETE**: Use a linter or review checklist; always have a WHERE clause
- **N+1 in loops**: Load all related data in one query, not per-iteration
- **Unbounded queries**: Always use LIMIT or pagination; never return full tables
- **Indexing every column**: Indexes cost writes; only index columns used in WHERE, JOIN, ORDER BY
