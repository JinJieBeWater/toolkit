# Pi Loom 领域模型

## 目标

跟进 Herdr 最新协议，提供聚焦的所有权路由和持久 helper mechanics。

## 权威边界

- Skill 决定所有权、workstream 语义和结果验收。
- Herdr 决定 agent 与 terminal 生命周期。
- 独立 `handoff` Skill 决定 Transfer 交接文件格式。
- 扩展只实现持久 helper 的启动、报告、状态和回收。

## 产品语言

- **Owner**：负责最终语义验收的 Pi。
- **Contribution**：当前 owner 保持责任，另一个 Pi 返回有边界的结果。
- **Helper**：Herdr 中保留上下文的 Pi。
- **Checkout lease**：helper 使用的 checkout；已有 checkout 为 borrowed，Loom 创建的 worktree 为 owned。
- **Pending lease**：worktree 已确认但 helper terminal identity 尚未确认；agent launch 前先持久化，直到 agent 完成改绑或 owned checkout 被安全回收。
- **Workstream**：同一 Herdr tab 中的一组相关工作。
- **Transfer**：所有权移动到另一个 Pi。
- **Reconcile**：mutation 可能已发生；重试前先检查 live state。

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

terminal report 保持短小；review、investigation 等长结果先写入私有临时 Markdown artifact，canonical report 只携带 durable pointer。artifact 写入失败时不得开始 delivery；delivery 失败时仅清理该次受控 artifact，并允许重试。
