---
name: "pi-loom"
description: "Ownership routing across Pi contexts. Use when delegating, finding or reusing persistent Pi contexts, integrating a child COMPLETED/BLOCKED report, or transferring through `转生`."
---

# Pi Loom（Pi 织序）

**Ownership** stays explicit: current Pi works directly until responsibility crosses a context boundary, then exactly one owner remains accountable for the final result.

When Herdr mechanics are needed, load and follow `herdr` before acting.

## Route by ownership

| Situation                                                                            | Route                                                                             | Completion                                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Task needs no separate result, persistent context, or ownership transfer             | **Direct:** continue locally                                                      | Current Pi delivers the final result                             |
| Current Pi keeps final responsibility but needs a bounded result or separate context | **Contribute:** read [helpers.md](references/helpers.md) and select one form      | Contribution is verified and integrated by current Pi            |
| A child returns `COMPLETED` or `BLOCKED`                                             | **Contribute:** resume the selected helper branch                                 | Result is integrated, or the exact blocker action stays recorded |
| Final responsibility moves to another Pi, or current Pi starts from transferred work | **Transfer:** read [handoff.md](references/handoff.md) and select Send or Receive | Selected criterion leaves exactly one current owner              |

## Durable authority

Durable files and Git remain truth. Pi preserves reasoning, Herdr execution, and handoff transfer state.

Pi Loom chooses ownership, workstream, and role, then places persistent helpers. Herdr owns live agent and pane lifecycle; handoff owns Transfer artifacts.

Persistent helper launch: `existing-helper` means reuse or rename; `DISCOVERY_UNAVAILABLE` means no mutation.

Before persistent reuse or closure, use `loom_status`: it discovers named and unnamed live Pi contexts across whole Herdr session without exposing identities. `owned` is `current-session` exact binding; `external` stays outside local control; `missing` is local lease without live owned context.
