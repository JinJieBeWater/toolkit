# Manual return channel and local HITL

Use only for the manual persistent branch; `loom_start` embeds the compiled contract. **Return channel** sends child terminal state to direct parent without polling. **Local HITL** keeps user decisions in the child pane that needs them.

## Bind at launch

Parent gives child:

- stable task ID and bounded outcome;
- direct parent pane ID as primary report target;
- coordinator pane ID as fallback when different;
- durable result location or expected artifact;
- local HITL ownership;
- this return contract.

Nested delegation forms a chain: each child reports to direct parent; each parent verifies descendants, aggregates their result, then reports its own terminal state upstream.

Binding completes when the child prompt contains explicit target pane IDs, report schema, and local HITL ownership.

## Keep HITL local

When progress needs a user decision, child asks the complete question in its own pane and remains blocked there. Explanations, options, and answer stay in that pane.

Ordinary user decisions produce no parent/coordinator status message. Child resumes only from input in its own pane; terminal completion and operational blockers use the return channel below.

Local HITL completes when the question is visible in child pane and child remains available for the answer.

## Report terminal state

With Loom tools available, child calls `loom_report` once after durable output and verification. Keep `summary`, pointers, changed files, checks, and next action short. For a review, investigation, or other long result, pass up to 1 MiB of complete non-empty Markdown as optional `details`; the extension writes it to a unique private directory under the system temporary directory as `report.md`, adds its absolute path to durable pointers, then delivers the short canonical report. Short status reports omit `details` and retain the existing inline behavior.

The artifact directory has mode `0700`; `report.md` has mode `0600`. If artifact creation or writing fails, `loom_report` throws, sends no report, and permits a retry. If delivery fails after writing, the extension removes only that writer-owned directory and permits a retry. A successful tool result includes the artifact path in both structured details and visible content so the child pane retains a recovery pointer.

Manual fallback calls `herdr_agent` with action `prompt`, bound parent target, report as `prompt`, and `wait=false` as final tool action before final response. Before launching a manual helper expected to return a long result, parent allocates a mode `0700` temporary directory and private Markdown path. Child writes a sibling temporary file with mode `0600`, renames it atomically to that path, and sends only short status plus the absolute path. Report exactly once for each transition to `COMPLETED` or parent-action `BLOCKED`:

```text
[Herdr child report][<task-id>][COMPLETED|BLOCKED]
Outcome: <one bounded result or blocker>
Durable pointers: <issue, file, commit, artifact, or transcript>
Changed: <files/refs, or none>
Verification: <checks and result>
Need/next: <required input or parent action>
Child pane: <pane-id> (<role>; workstream: <workstream>)
```

Read pane role and tab workstream labels live at report time. Inherited launch labels are fallback only when live presentation is absent or unreadable.

Use `BLOCKED` for a blocker requiring parent action. User decisions stay local. Send an operational blocker after identifying exact parent action, then remain available. After resuming, send one `COMPLETED` report when its criterion is met. Child final response is transcript, not an upstream report.

## Delivery fallback

Send to primary once. If target is missing, send the same report to coordinator fallback. If structured tools are unavailable but shell exists, use the loaded `herdr` authority's CLI fallback. If both targets are missing, preserve the short report and artifact path in child transcript and final response.

Keep child pane open until parent integrates result. Delivery completes when Herdr accepts the report, or the intact child transcript preserves it for reconciliation.
