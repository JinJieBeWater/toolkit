# Send ownership

Use when current Pi relinquishes ownership. **One-pass** means each artifact, successor, prompt, and acceptance event is created once.

## Four gates

### 1. Select behavior and freeze

| User signal                                       | Behavior     | Successor completion                    |
| ------------------------------------------------- | ------------ | --------------------------------------- |
| Explicit continue, resume, or start intent        | **Continue** | Start `Exact next action` immediately   |
| Transfer-only, restore-only, wait, or bare `转生` | **Ready**    | Report restored context once, then wait |

Tell user the behavior in one sentence, then freeze task changes. Selection completes when one behavior is fixed.

### 2. Prepare once

In one parallel batch, load missing `handoff`/`herdr` authorities and capture only transfer-critical state absent from context:

- caller pane, cwd, and enough geometry for one replacement location;
- active child IDs and structured-HITL state;
- changed files/refs and last recorded verification.

Choose one same-cwd sibling split when both panes remain usable; otherwise use one same-cwd background tab in the same workstream. Preserve focus and choose successor workstream/role labels. Do not rename the source as a substitute; presentation applies to the live successor in gate 3.

In the next tool turn, create the successor-agnostic handoff and replacement context in parallel. Follow the independent `handoff` Skill's size and section contract. Preparation completes when the final handoff file and exact successor target both exist.

### 3. Start, present, then prompt

Start Pi once through loaded `herdr` authority with every resolved non-default model/thinking value, but no task prompt. After `agent.start` confirms the live successor alias, source applies and verifies successor pane role and tab workstream through loaded `herdr`. Preserve conflicts; treat unconfirmed label mutation as reconcile; do not send the handoff prompt.

After live successor presentation verifies, submit one atomic first user message with the handoff attachment:

```text
@<handoff-path> <transfer-prompt>
```

Use one Chinese prompt containing source pane ID and behavior.

**Continue:**

```text
附件是转生交接文件。按 Continue 快速接管：以交接记录为恢复证据，恢复阶段只处理 handoff、child 改绑与 source closure；立即执行“Exact next action”。Source pane: <source-id>。<closure instruction>
```

**Ready:**

```text
附件是转生交接文件。按 Ready 快速接管：以交接记录为恢复证据，恢复阶段只处理 handoff、child 改绑与 source closure；随后报告就绪并等待下一条用户指令。Source pane: <source-id>。<closure instruction>
```

Wait once for successor status `working`, `blocked`, `idle`, or `done`. Confirmed start, verified successor labels, prompt submission, and one recognized status prove acceptance. Acceptance completes without transcript inspection or task-completion wait.

### 4. Preserve channels and close source

| Source state    | Closure path                                                                                                                   | Completion                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| No active child | `<closure instruction>` authorizes successor to close the exact source pane through loaded `herdr` after accepting the handoff | Successor owns source closure                    |
| Active children | Read [active-child rebind](rebind.md) before writing `<closure instruction>`, then follow it after successor acceptance        | Every child meets the canonical rebind criterion |

Failure in artifact creation, launch, acceptance, or required rebind keeps source open with the exact failed gate reported. Otherwise successor owns source closure.

Send completes when successor accepted the attached handoff and every active child satisfies the canonical rebind criterion.
