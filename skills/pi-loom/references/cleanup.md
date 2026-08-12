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

`COMPLETED` closes only the current assignment; it does not RELEASE the helper or workstream. `idle` alone is not a retirement signal. A write result awaiting human review or acceptance remains pending. Classification completes when each condition has evidence or the pane remains open with one recorded reason.

## Select one executor

- For a helper bound by current Pi `loom_start`, call `loom_close` with integration, durable evidence, descendant settlement, pending-work, running-service, keep, release, and execute decisions. Preserve `not-owned` or reconcile results for inspection.
- `loom_start keep:true` persists sticky retention across session reloads. `loom_close` retains that helper unless current user confirms review or interaction is finished and owner passes `release:true`; only then may normal retirement proceed.
- Per-call `loom_close keep:true` remains a retain override for compatibility.
- A borrowed checkout closes only the helper pane. An owned worktree is removed with `force=false` only when the helper is its sole pane; dirty, shared, or identity-mismatched worktrees remain for inspection.
- Otherwise use manual leaf-first closure below.

Selection completes when exactly one executor owns the retirement attempt.

## Manual leaf-first closure

1. Re-read affected panes and layout immediately before mutation.
2. Close retirable descendants before their parent through the loaded `herdr` authority, targeting the exact workflow-owned pane and preserving foreground context.
3. After each closure, verify success and re-read panes, tabs, and affected layout. A skill-created tab may disappear when its final pane closes.
4. Report closed pane IDs/labels and every retained pane with reason.

Standing authorization covers automatic closure only for workflow-owned panes satisfying every condition. Retirement completes when all eligible panes are absent, live agents retain prior states, and remaining panes have usable geometry.

## Remove temporary report artifacts

After owner verifies and integrates a report, remove its Pi Loom temporary artifact directory. If the result must outlive integration, first move the Markdown into a durable project or user-approved location, update the durable pointer, then remove the temporary directory. Do not retain system-temporary paths as long-term evidence.
