# Contribute

Use while current Pi retains final ownership.

## Choose one form

| Situation                                                       | Form                            | Checkout and access                                                | Completion                                         |
| --------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| Bounded read-only investigation or review in current context    | Pi subagent                     | current                                                            | Result returns here and passes owner verification  |
| Bounded read-only result from another project                   | Pi subagent with explicit `cwd` | exact existing path                                                | Result returns here and passes owner verification  |
| Visible, interactive, or reusable context                       | persistent helper in Herdr      | `current` or `existing`; approved writes require one active writer | Report is integrated; helper is kept or closed     |
| Implementation concurrent with owner or another writer          | persistent helper in Herdr      | managed `worktree` with approved file boundary                     | Changes are verified and integrated; lease settles |
| Substantial cross-project contribution needing project context  | `subagent` `project.open`       | target project                                                     | Project result returns and is integrated           |
| Current owner continues persistent work in a different checkout | Transfer                        | target checkout                                                    | Transfer criterion completes                       |

Exactly one form owns one bounded result. Owner work crossing checkout affinity uses Transfer; a helper contribution may use `loom_start` in the target checkout.

## Route the model

| Work                                          | Model                        | Thinking        |
| --------------------------------------------- | ---------------------------- | --------------- |
| Locate, gather, summarize                     | `deepseek/deepseek-v4-flash` | `high`          |
| Implement                                     | `openai-codex/gpt-5.6-terra` | `medium`        |
| Review                                        | `openai-codex/gpt-5.6-terra` | `high`          |
| Architecture, conflict, or high-risk decision | `openai-codex/gpt-5.6-sol`   | `high` or `max` |

Escalate Flash → Terra when evidence conflicts, validation fails, or scope gains writes. Escalate Terra → Sol after a second failed fix, reviewer conflict, or architecture/security/data-loss decision. Provider fallback handles availability, not quality.

## Bound the contribution

Define task, checkout, workstream, role, read/write access, allowed files, deliverable, and reuse choice. Omit checkout for current, use `existing` with an exact path, or use `worktree` with an explicit branch and optional base/path. Read-only work may start automatically, but a read-only persistent helper cannot launch descendants; ask its parent to route more work. Write access requires user approval naming task and file boundary; concurrent writers use managed worktrees. Pass the selected `model` and `thinking` to `loom_start`.

## Persistent helper branch

1. Read [layout.md](layout.md). If `loom_start` is available, call it once. It acquires the requested checkout, chooses its root pane or exact-affinity layout, starts Pi, binds return channel, and sends the task.
2. On `started`, end the turn. Wait for `loom_report`; do not poll.
3. Route the next child state:

   | State                            | Owner action                                                       | State completes when                                      |
   | -------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
   | Local HITL visible in child pane | Leave the decision with that child                                 | User answers there and child resumes                      |
   | `COMPLETED` report               | Verify durable evidence and integrate the bounded result           | Owner verification passes                                 |
   | `BLOCKED` report                 | Resolve its exact parent action while keeping the helper available | Child resumes, or the unresolved blocker remains recorded |

4. After terminal integration, read [cleanup.md](cleanup.md), classify every condition, then call `loom_close` once. `reconcile` stops mutation until live state is inspected.

If an `existing` checkout has no matching workspace, open it with loaded `herdr`, then retry once. Loom recognizes an ordinary workspace from its unambiguous pane Git cwd; mixed-checkout or duplicate matches must be disambiguated first. A rejection or pre-send failure may use the manual branch; ambiguous mutation stays reconcile.

## Manual persistent branch

Use only when Loom tools are unavailable or evidence proves no Loom mutation occurred. Read [reporting.md](reporting.md) and [layout.md](layout.md), then start and label one Pi through loaded `herdr`. Preserve target checkout affinity, foreground context, write approval, return channel, and event-driven wait. Finish through [cleanup.md](cleanup.md).

## Finite subagent branch

Start one read-only Pi subagent for the bounded result. Smoke or probe work passes `mission: false`; substantial work keeps its mission. Store artifacts in session scope. Limit one fan-out to `3` or `4` while global ceiling remains `12`. Flash gathers, Terra executes/reviews, Sol adjudicates after escalation evidence.

## Coordination status

Read finite work through `subagent` `status` and persistent work through `loom_status` in parallel. Record task ID; owner/form; role/model/thinking; checkout/access; elapsed time; tokens/cost; status/verification; deliverable. Unavailable metrics remain `unknown`.
