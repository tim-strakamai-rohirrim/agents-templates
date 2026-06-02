---
name: python-testing
description: |
  Python testing patterns with pytest for FastAPI and SQLAlchemy.
  Triggers on "pytest", "python test", "test fixture", "mock", "test coverage".
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Python Testing Patterns (pytest)

## Running Tests
```bash
cd rohan-python-api/backend
uv run bash scripts/test.sh          # Full suite with coverage → htmlcov/
uv run pytest path/to/test_file.py   # Single file
uv run pytest -k "test_create"       # By name pattern
uv run pytest -x                     # Stop on first failure
```

## Test Organization
Mirror source structure:
```text
backend/
  app/
    routers/proposals.py
    services/proposal_service.py
  tests/
    routers/test_proposals.py
    services/test_proposal_service.py
    conftest.py
```

## Fixtures

### Scope Management
```python
@pytest.fixture(scope="session")
async def engine():
    engine = create_async_engine(TEST_DATABASE_URL)
    yield engine
    await engine.dispose()

@pytest.fixture(scope="function")
async def db_session(engine):
    async with AsyncSession(engine) as session:
        async with session.begin():
            yield session
            await session.rollback()
```

### Factory Fixtures
```python
@pytest.fixture
async def make_proposal(db_session):
    async def _make(title: str = "Test Proposal", **kwargs) -> Proposal:
        proposal = Proposal(title=title, **kwargs)
        db_session.add(proposal)
        await db_session.flush()
        return proposal
    return _make

async def test_get_proposal(client, make_proposal):
    proposal = await make_proposal(title="My Proposal")
    response = await client.get(f"/proposals/{proposal.id}")
    assert response.status_code == 200
```

## FastAPI Testing

### Async Client with Dependency Override
```python
@pytest.fixture
async def client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
```

### Testing Auth
```python
@pytest.fixture
def auth_headers():
    token = create_test_jwt(user_id="test-user", org_id="test-org")
    return {"Authorization": f"Bearer {token}"}

async def test_protected_endpoint(client, auth_headers):
    response = await client.get("/proposals", headers=auth_headers)
    assert response.status_code == 200
```

## Mocking

### unittest.mock
```python
from unittest.mock import AsyncMock, patch

@patch("app.services.proposal_service.send_notification", new_callable=AsyncMock)
async def test_create_sends_notification(mock_send, client):
    response = await client.post("/proposals", json={"title": "New"})
    assert response.status_code == 201
    mock_send.assert_called_once()
```

### Patching External Services
```python
@pytest.fixture
def mock_storage(monkeypatch):
    mock = AsyncMock()
    mock.upload.return_value = "https://storage/file.pdf"
    monkeypatch.setattr("app.services.storage.client", mock)
    return mock
```

## Database Testing
- Use transaction rollback pattern: begin transaction in fixture, rollback after each test
- Never commit in tests — use `flush()` to get IDs without persisting
- Use a separate test database, never run tests against dev/staging

## Assertions
- Be specific: `assert response.status_code == 201` not `assert response.ok`
- Check response body: `assert data["title"] == "Expected"` not just `assert "title" in data`
- Use `pytest.raises` for expected exceptions:
```python
with pytest.raises(ProposalNotFoundError):
    await get_proposal(uuid4(), db_session)
```

## Coverage
- Target 80%+ line coverage
- Check `htmlcov/index.html` after running `scripts/test.sh`
- Focus coverage on business logic and edge cases, not boilerplate
