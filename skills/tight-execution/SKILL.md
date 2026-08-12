---
name: tight-execution
description: "Scope-controlled coding workflow. Use when the user says 先讨论再改, requests a minimal or lightweight change, reserves consequential decisions, delegates implementation under parent review, or requires artifact-level acceptance."
---

# Tight Execution

## Workflow

1. **Pin.** Infer one current mode from the latest user request: `DISCUSS`, `IMPLEMENT`, or `VERIFY`. Change mode only on user direction. Keep `DISCUSS` and `VERIFY` read-only: inspect and run non-mutating checks, but make no target or external changes. Record the requested outcome, confirmed scope, acceptance evidence, and unresolved user decisions. Ask once when mode or a load-bearing boundary remains ambiguous. Complete when mode and boundary support one next action.
2. **Diagnose.** For bugs or regressions, establish causal evidence before choosing a change. Trace the failing layer and compare working behavior when useful. Remain in `DISCUSS` when evidence cannot yet distinguish plausible causes. Complete when evidence explains the observed failure or the uncertainty is explicit.
3. **Choose.** Prefer the smallest cohesive solution that reuses existing seams and sources of truth. Compare alternatives only when they create materially different tradeoffs. Complete when one solution fits the confirmed outcome without unrelated architecture.
4. **Gate.** Before adding a dependency, module, public contract, schema migration, version change, cross-repository edit, or generalized mechanism beyond the confirmed solution, report the need, smallest alternative, and scope impact. Continue after the user decides. Complete when every consequential expansion is approved or removed.
5. **Execute.** In `IMPLEMENT`, make the confirmed change and keep new consequential decisions behind the gate. Run focused checks for changed behavior before reporting; implementation validation does not switch mode to `VERIFY`. In delegated work, give the implementer exact ownership and completion evidence; the parent reviews the diff and result. Complete when the scoped result exists and focused checks pass or their exact limits are reported.
6. **Verify.** In `VERIFY`, judge the existing result without reopening design. Run focused checks for every changed behavior. Inspect the real artifact or end-to-end path for rendered documents, UI, model output, webhooks, or other integration behavior. Complete when every material behavior and side effect is accounted for.
7. **Report.** State outcome, changed files or decisions, verification evidence, and `Scope expansion: none` or the approved expansions. Keep explanation concrete and decision-facing.

## Recovery

- New evidence invalidates the chosen solution: show the contradiction; choose another solution only in `DISCUSS` after the user changes mode.
- Verification fails: report the exact failure and evidence. Keep `VERIFY` read-only; diagnose or fix only after the user changes mode.
- User changes direction: repin mode, outcome, and scope before further action.
