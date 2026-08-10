# Place Herdr workstreams

Use before creating or reorganizing Pi panes. Optimize for **workstream locality**: related agents stay together; independent workstreams receive separate viewports.

A usable agent pane is at least 80 columns by 24 rows unless the user chooses denser layout.

## Checkout affinity

Canonicalize each Git checkout with exact checkout realpath. Same repository with a different worktree is a different checkout.

Use explicit Herdr worktree checkout identity when present. For an ordinary workspace, resolve each available pane `foreground_cwd` or `cwd` through Git top-level and realpath; accept the workspace only when all resolvable panes identify one checkout. Ignore panes without a usable Git cwd. Require exactly one workspace for the target checkout; reject missing, mixed-checkout, or duplicate matches before mutation. Do not match by repository identity.

`current` and `existing` checkout leases are borrowed. A `worktree` lease is owned by Pi Loom: Herdr creates its workspace without focus, and Loom starts the helper in the confirmed root pane.

- same checkout and same workstream: sibling pane;
- same checkout and independent workstream: new tab in that checkout workspace;
- different checkout helper: new tab in the matching workspace;
- managed worktree helper: confirmed root pane in the newly created workspace;
- current owner continuing persistent work in a different checkout: Transfer;
- no unique exact workspace match: stop before layout mutation, open or disambiguate the target checkout through loaded `herdr`, then retry.

Never create a target-checkout tab in the caller workspace when checkout affinity differs.

## Snapshot and name

1. Read caller context, workspace, tabs, panes, and affected layouts once. Record each pane's label, agent state, workstream, rectangle, and foreground context.
2. Classify blank, numeric/default, duplicate, and work-contradicting labels as ambiguous.
3. Use hierarchy instead of repetition: workspace carries project, tab carries workstream, pane carries role or tool. Prefer one-word child labels and cap routine labels at two words.
4. Resolve workstream labels in order: explicit task scope, inherited workstream, then clear live tab label. Preserve a different clear user-owned label unless the mutation supplies that exact live value as its expected label. Rename the coordinator's current tab and workflow-owned ambiguous contexts:
   - workspace: project or durable scope;
   - tab: workstream;
   - pane: role or tool, such as `reviewer` or `lazygit`.
5. Derive names from durable task or issue, not executable, model, transient state, or terminal title. Keep human-owned labels stable as terminal titles evolve.

Pi Loom applies workflow-owned labels during launch. Manual labeling uses loaded `herdr`, preserves clear user labels, and verifies the returned pane/tab identity before prompting.

Retain an ambiguous external context whose ownership is unclear and report its reason. Naming completes when every coordinator/workflow-owned context has a clear label and every retained ambiguity has one ownership reason.

## Plan before mutation

1. Assign every created or moved pane to one workstream. Parent and descendants form one workstream unless the user requests another topology.
2. Choose complete target topology before mutation:
   - coordinator plus immediate helper: same tab, normally side by side;
   - parent plus descendant: same tab, normally side by side;
   - independent workstreams: separate labeled tabs;
   - 2×2 grid only when all panes remain usable.
3. Split a pane already belonging to the workstream. Place each additional independent workstream in its own tab.

Planning completes when every involved pane has one target tab, neighbor, and predicted usable rectangle.

## Build or reflow

1. Apply normal topology through `loom_start`; otherwise use loaded `herdr` authority while preserving foreground context. Ask before moving the foreground pane.
2. Read identities from mutation responses and treat them as opaque.
3. When the existing split tree cannot express the target, rebuild the related workstream in a fresh background tab rather than disturbing unrelated panes.
4. Keep parent pane available until every descendant result is integrated.
5. Tell a Pi that may add descendants to preserve workstream locality and apply this reference before splitting.

Reflow completes when every intended mutation succeeds and each running process retains session and state.

## Verify

Re-read affected tab lists, pane lists, and layouts. Confirm:

- related panes are neighbors in one workstream tab;
- independent workstreams occupy separate tabs;
- every agent TUI is usable;
- labels, cwd, and agent states survived;
- foreground tab/pane matches recorded context.

Repair failed checks before reporting completion. Report final grouping, not only mutation commands.
