---
name: api-design
description: |
  REST API design patterns for consistency across NestJS and FastAPI services.
  Triggers on "api design", "endpoint", "rest api", "dto", "request validation", "response shape".
allowed-tools:
  - Read
  - Glob
  - Grep
---

# REST API Design Patterns

## URL Conventions
- Plural nouns: `/organizations`, `/proposals`, `/runs`
- Kebab-case: `/compliance-matrices`, `/evaluation-criteria`
- Nested resources: `/organizations/:orgId/proposals/:proposalId`
- Actions as sub-resources: `/proposals/:id/submit`, `/runs/:id/cancel`
- No verbs in paths (use HTTP methods instead)

## Pagination

### Cursor-Based (Preferred)
```json
{
  "data": [...],
  "meta": {
    "cursor": "eyJpZCI6MTAwfQ==",
    "hasMore": true,
    "limit": 25
  }
}
```

### Offset-Based (Acceptable)
```json
{
  "data": [...],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 25,
    "totalPages": 6
  }
}
```

## Error Response Shape
Consistent across both APIs:
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "must be a valid email address" }
  ]
}
```

### HTTP Status Guide
| Status | Meaning | When |
|--------|---------|------|
| 200 | OK | Successful GET, PUT, PATCH |
| 201 | Created | Successful POST that creates a resource |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Validation failure, malformed input |
| 401 | Unauthorized | Missing or invalid JWT |
| 403 | Forbidden | Valid JWT but insufficient permissions |
| 404 | Not Found | Resource does not exist |
| 409 | Conflict | Duplicate resource, state conflict |
| 422 | Unprocessable | Semantically invalid (valid shape, bad data) |
| 500 | Server Error | Unhandled exception |

## Request Validation

### NestJS (class-validator + class-transformer)
```typescript
export class CreateProposalDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsEnum(ProposalStatus)
  status: ProposalStatus;
}
```

### FastAPI (Pydantic)
```python
class CreateProposalRequest(BaseModel):
    title: str = Field(..., min_length=1)
    organization_id: UUID | None = None
    status: ProposalStatus
```

## Response Shaping
- Exclude internal fields (`password_hash`, `internal_notes`, `deleted_at`)
- Use ISO 8601 for all dates: `2024-01-15T10:30:00Z`
- Return IDs as strings (UUIDs), not integers
- Nested objects: include minimal representation (id + display name), not full entities

## Auth Patterns
- JWT Bearer token in `Authorization: Bearer <token>` header
- NestJS: `@UseGuards(AuthGuard, PermissionsGuard)` with `@Permissions()` decorator
- FastAPI: `Depends(get_current_user)` dependency injection

## Cross-Service Communication
rohan_api calls rohan-python-api via the `RfpPythonServer` client:
- Located in `rohan_api/src/utils/rfp-python-server/`
- JWT-authenticated HTTP calls
- Async operations queued via Azure Service Bus
- Results stored in MinIO and PostgreSQL
