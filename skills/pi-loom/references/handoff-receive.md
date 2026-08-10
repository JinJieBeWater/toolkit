# Receive ownership

Use when current Pi starts with transferred ownership. Attached `@file` content is already in the first user message.

## Restore

- Restore state from the handoff without re-planning completed work.
- Apply transfer controls supplied by the launch prompt.
- Verify source-applied successor workstream/role presentation from live current state. If labels are absent because manual tooling was unavailable, compare-and-set `current` before task continuation; preserve conflicts and reconcile uncertainty.
- Treat recorded verification as transfer evidence; durable files, issues, and Git remain authority for future work.
- Treat source closure, `[转生改绑完成]`, and `[HITL重现完成]` as transfer control rather than product work.
- When child evidence is pending, follow [active-child rebind](rebind.md) under the prompt's Ready/Continue behavior.

## Continue or Ready

| Behavior     | Action                                                                                     | Completion                                |
| ------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Continue** | Start `Exact next action` immediately; load only authorities that action requires          | Exact next action starts                  |
| **Ready**    | Close source when authorized, report restored context once, then wait for user instruction | Restored context is reported and Pi waits |

Receive completes when Continue starts its exact next action, or Ready reports restored and waits, with source closure and rebind control resolved.
