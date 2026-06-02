---
name: orchestrate
description: |
  Launch the multi-agent orchestrator for production-ready implementation.
  Triggers on "orchestrate", "multi-agent", "implement with review",
  "production-ready", "build with quality gate".
---

# Orchestrate

Launch the orchestrator agent to implement a feature with multi-agent quality loops.

Pass the user's full request as the prompt. The orchestrator handles:
- Requirements clarification (Phase 0)
- Task decomposition and planning (Phase 1)
- Implementation with quality-gate review loops (Phase 2)
- Test verification (Phase 3)
- Accessibility validation (Phase 4)
- Final review (Phase 5)

## Instructions

Spawn the orchestrator agent with the user's request:

```
Agent(
  description="Orchestrate: [short task summary]",
  prompt="[user's full request with any context]",
  subagent_type="orchestrator"
)
```
