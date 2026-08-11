# Pi Loom

Pi Loom 为 Herdr 中的多个 Pi 上下文提供所有权路由和持久 helper 生命周期。

它解决两件事：当前 Pi 是否继续负责最终结果，以及需要长期上下文的辅助 Pi 应放在哪里、如何回报、何时关闭。

## 责任边界

- Pi Loom Skill：选择 Direct、Contribute 或 Transfer，并验收语义结果。
- Pi Loom 扩展：启动、跟踪和回收持久 helper。
- Herdr：管理 agent、pane、tab 和 workspace 生命周期。
- 独立 `handoff` Skill：定义 Transfer 交接文件。
- 文件与 Git：保存最终事实。

完整领域模型见 [DESIGN.md](DESIGN.md)。

## 工具

| 工具          | 调用方 | 用途                                               |
| ------------- | ------ | -------------------------------------------------- |
| `loom_start`  | owner  | 在当前、已有或新建 worktree 中启动 helper          |
| `loom_report` | child  | 向直接 owner 返回一次短报告；长结果落私有 artifact |
| `loom_close`  | owner  | 验收后保留或显式释放 helper                        |
| `loom_status` | owner  | 查看 helper 状态，不向模型暴露 Herdr 身份          |

`loom_status` 覆盖整个 Herdr session：当前 session 启动的 helper，以及所有 live Pi context（包括未命名 context）。结果仅含 `name`、`state`、`relation`、`ownership`、`control`、`checkout`；不会暴露 pane、terminal、workspace、tab、socket、cwd 或 raw snapshot。`name` filter 只匹配命名 context。

`owned` 需要当前-session binding 与 live name、pane、terminal 全部精确匹配；失去 live match 的 binding 是 `missing` current-session-owned lease；其余 live context 是 `external`。`loom_start` 在任何 mutation 前检查全局同名 live helper，存在时返回 `existing-helper` 并要求 reuse 或改名；discovery 不可用时返回 `DISCOVERY_UNAVAILABLE` 且不启动。`loom_close` 只会回收当前 `current-session` 的 `owned` lease；`missing` 返回 `helper-live-identity-missing` reconcile，external 返回 `not-owned`，两者均不作 retirement。

`loom_start` 的 `checkout` 支持 `current`、`existing` 和 `worktree`；省略时使用当前 checkout。managed worktree 直接复用 Herdr 返回的 root pane，不创建空 tab：

```json
{
  "name": "auth-writer",
  "task": "修复认证过期问题并提交",
  "workstream": "auth-fix",
  "access": "write",
  "files": ["src/auth/**", "test/auth/**"],
  "writeApproved": true,
  "checkout": {
    "kind": "worktree",
    "branch": "fix/auth-expiry",
    "base": "origin/main"
  }
}
```

已有 checkout 是 borrowed，关闭 helper 时保留；Loom 创建的 worktree 是 owned，`loom_close` 验收后通过 `worktree.remove(force=false)` 回收。dirty、共享或身份不确定时保留现场并返回 `reconcile`。所有 mutation 不确定性都由 owner 检查 live state。

review、interactive 或 reusable helper 用 `loom_start keep:true`。该策略随 session binding 持久化；`COMPLETED` 后 `loom_close` 仍默认 retain，owner 仅在 workstream 真正释放时传 `release:true`。单次 `loom_close keep:true` 继续作为兼容的 retain override。

## 运行条件

- Node.js 22.19 或更高版本
- Pi
- 最新版 Herdr（Pi Loom 跟进其当前协议）
- `herdr` Skill

安装步骤见仓库根目录 [README](../../README.md#安装-pi-loom-扩展)。

## 开发

在本目录执行：

```bash
bun run check
bun run pack:check
```

在仓库根目录运行全部测试：

```bash
bun test
```

已连接 Herdr 时验证 live snapshot：

```bash
bun run verify:herdr-snapshot
```

临时加载扩展：

```bash
PI_LOOM_EXTENSION_PATH="$PWD" \
  pi --no-extensions -e "$PWD"
```

新启动的 Pi 才会加载修改后的扩展；普通测试不写入全局 Pi 配置。
