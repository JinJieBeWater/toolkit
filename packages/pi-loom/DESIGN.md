# Pi Loom 领域模型

## 目标

跟进 Herdr 最新协议，提供聚焦的所有权路由和持久 helper mechanics。

## 权威边界

- Skill 决定所有权、workstream 语义和结果验收。
- Herdr 决定 agent 与 terminal 生命周期。
- 独立 `handoff` Skill 决定 Transfer 交接文件格式。
- 扩展只实现持久 helper 的启动、报告、状态和回收。
- `access`、`files` 与 `writeApproved` 是 owner 对 agent 的协作合约，不是操作系统沙箱或不可伪造 capability。

## 产品语言

- **Owner**：负责最终语义验收的 Pi。
- **Contribution**：当前 owner 保持责任，另一个 Pi 返回有边界的结果。
- **Helper**：Herdr 中保留上下文的 Pi。
- **Checkout lease**：helper 使用的 checkout；已有 checkout 为 borrowed，Loom 创建的 worktree 为 owned。
- **Assignment**：单次 `loom_start` 派发的有界工作单元。首次启动的 Task ID 是 helper name；sticky helper 复用时以该次 `loom_start` 的 toolCallId 为 assignmentId。
- **Pending lease**：worktree 已确认但 helper terminal identity 尚未确认；agent launch 前先持久化，直到 agent 完成改绑或 owned checkout 被安全回收。
- **Workstream**：同一 Herdr tab 中的一组相关工作。
- **Sticky retention**：`loom_start keep:true` 持久化的复用策略；assignment 完成后继续保留 helper，直到 owner 显式 RELEASE。
- **Transfer**：所有权移动到另一个 Pi。
- **Reconcile**：mutation 可能已发生；重试前先检查 live state。
- **Global discovery**：当前 session binding 与整个 Herdr session 的 live Pi context 合并后的只读 roster；它是 status、launch preflight 与 close ownership check 的共同输入。

## 外部权威

以下文件不属于本仓库，保持只读：

- `~/.pi/agent/skills/handoff/SKILL.md`
- `~/.pi/agent/extensions/herdr-agent-state.ts`

## 产品 seams

1. 持久 helper launch compiler
2. checkout lease 获取、exact-checkout layout 与 launch executor
3. terminal report delivery
4. helper 与 owned checkout retirement
5. canonical `pi-loom` Skill

## Global discovery 与本地控制

`loom_status` 从当前 Pi session 的 `HelperDirectory` 和 Herdr `session.snapshot` 合并全部 live `agent: "pi"` context。命名与未命名 context 都显示；name filter 仅匹配命名 context。输出只含 name（可为 `null`）、state、relation、ownership、control 与 checkout category；本地 lease 的 ownership 值为 `current-session`，绝不泄漏 Herdr identity、socket、cwd 或 snapshot。

binding 加同名 live agent 的 pane/terminal 精确 identity 才是 `owned`。无匹配 live agent 的 binding 是 `missing` current-session-owned lease；任何未精确匹配的 live context 是 `external`。输出按公开字段稳定排序。

`loom_start` 在任何 mutation 前做全局同名 live preflight。符合原 role、resolved cwd、access、files 边界的 `idle`/`done` owned sticky helper 可接收新 assignment；显式 worktree、busy、legacy、边界不兼容或 external helper 返回 `existing-helper`。discovery 不可用时返回 `DISCOVERY_UNAVAILABLE`。Herdr 的全局 name uniqueness 仍是并发权威。

`loom_close` 只操作当前 session binding：external 或未绑定 name 返回 `not-owned`；普通 `missing` 返回 reconcile；无 terminal 的 pending managed worktree 可进入 identity-guarded retirement。

terminal report 保持短小；review、investigation 等长结果先写入私有临时 Markdown artifact，canonical report 只携带 durable pointer。artifact 写入失败时不得开始 delivery；delivery 失败时仅清理该次受控 artifact，并允许重试。

checkout workspace identity 优先使用 Herdr 显式 worktree checkout；普通 workspace 仅在其所有可解析 pane cwd 归一到同一 Git checkout 时采用 fallback。target checkout 必须唯一匹配一个 workspace，歧义时在 mutation 前拒绝。

`COMPLETED` 只结束当前 assignment，不释放 helper 或 workstream。sticky helper 的 session binding 保存 reuse role；`loom_close` 默认 retain，只有 `release:true` 才进入 retirement。`loom_report` 以 assignmentId+status 去重并用 assignmentId 作为交付 taskId。
