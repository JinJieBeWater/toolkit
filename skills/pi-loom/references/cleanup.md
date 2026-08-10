# Close persistent helpers

Use after integrating a child report, reaching terminal workstream state, or finding a stale pane. **Retirement** releases a helper lease only after its responsibility and unique context have ended.

## Classify

Record pane ownership when created. A pane is workflow-owned when this skill or one of its descendants created it for current contribution. Existing user or external panes require explicit current permission before closure.

A pane is retirable only when every condition holds:

- agent state is `idle` or `done`, confirmed with current Herdr state and recent transcript;
- parent verified and integrated the terminal result;
- issue, file, commit, artifact, or handoff preserves every needed result;
- no pending approval, user input, queued follow-up, running service, or unresolved blocker remains;
- every descendant reported and is retired or explicitly retained;
- pane has no named reuse role;
- pane is neither caller pane nor foreground pane.

`idle` alone is not a retirement signal. Classification completes when each condition has evidence or the pane remains open with one recorded reason.

## Select one executor

- For a helper bound by `loom_start`, call `loom_close` with integration, durable evidence, descendant settlement, pending-work, running-service, keep, and execute decisions. Preserve a reconcile result for inspection.
- For reuse, pass `keep: true`; Pi Loom retains the live helper without closing it.
- A borrowed checkout closes only the helper pane. An owned worktree is removed with `force=false` only when the helper is its sole pane; dirty, shared, or identity-mismatched worktrees remain for inspection.
- Otherwise use manual leaf-first closure below.

Selection completes when exactly one executor owns the retirement attempt.

## Manual leaf-first closure

1. Re-read affected panes and layout immediately before mutation.
2. Close retirable descendants before their parent through the loaded `herdr` authority, targeting the exact workflow-owned pane and preserving foreground context.
3. After each closure, verify success and re-read panes, tabs, and affected layout. A skill-created tab may disappear when its final pane closes.
4. Report closed pane IDs/labels and every retained pane with reason.

Standing authorization covers automatic closure only for workflow-owned panes satisfying every condition. Retirement completes when all eligible panes are absent, live agents retain prior states, and remaining panes have usable geometry.
