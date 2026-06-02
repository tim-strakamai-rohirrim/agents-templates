---
name: python-patterns
description: |
  Python idioms and patterns for FastAPI development.
  Triggers on "fastapi", "pydantic", "python pattern", "async python", "dependency injection".
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Python Patterns for FastAPI

## Type Hints
Type hints on every function signature, return type, and non-trivial variable:
```python
async def get_proposal(proposal_id: UUID, db: AsyncSession) -> Proposal:
    ...

items: list[ProposalResponse] = []
cache: dict[str, Any] = {}
```

## Pydantic Models

### Field Validators
```python
class CreateRunRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be blank")
        return v.strip()
```

### Discriminated Unions
```python
class TextBlock(BaseModel):
    type: Literal["text"] = "text"
    content: str

class ImageBlock(BaseModel):
    type: Literal["image"] = "image"
    url: HttpUrl

ContentBlock = Annotated[TextBlock | ImageBlock, Field(discriminator="type")]
```

## FastAPI Patterns

### Dependency Injection
```python
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    ...

@router.get("/proposals/{id}")
async def get_proposal(
    id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProposalResponse:
    ...
```

### Background Tasks
```python
@router.post("/runs", status_code=201)
async def create_run(
    request: CreateRunRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> RunResponse:
    run = await create_run_record(db, request)
    background_tasks.add_task(execute_run, run.id)
    return RunResponse.model_validate(run)
```

### Lifespan Events
```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await init_db()
    yield
    await close_db_connections()

app = FastAPI(lifespan=lifespan)
```

## Async Best Practices
- Never call blocking I/O in async endpoints (file reads, synchronous HTTP, CPU-bound work)
- Use `asyncio.gather()` for parallel I/O operations
- Use `run_in_executor()` for unavoidable blocking calls
- All database operations through async SQLAlchemy sessions

## SQLAlchemy 2.0 Style
```python
class Proposal(Base):
    __tablename__ = "proposals"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[ProposalStatus] = mapped_column(default=ProposalStatus.DRAFT)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    sections: Mapped[list["Section"]] = relationship(back_populates="proposal")
```

### Querying
```python
stmt = (
    select(Proposal)
    .options(selectinload(Proposal.sections))
    .where(Proposal.organization_id == org_id)
    .order_by(Proposal.created_at.desc())
    .limit(25)
)
result = await session.execute(stmt)
proposals = result.scalars().all()
```

## Error Handling
```python
class ProposalNotFoundError(Exception):
    def __init__(self, proposal_id: UUID):
        self.proposal_id = proposal_id

@app.exception_handler(ProposalNotFoundError)
async def proposal_not_found_handler(request: Request, exc: ProposalNotFoundError):
    return JSONResponse(
        status_code=404,
        content={"statusCode": 404, "message": f"Proposal {exc.proposal_id} not found"},
    )
```
