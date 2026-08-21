# 我的 Pi 扩展清单

这份清单记录我日常安装的 Pi packages、启用状态及其提供的 extensions、Skills 和 prompts，供选型和环境恢复参考。它不是推荐全部安装；Pi package 可执行代码或影响 agent 行为，安装前应检查源码。

快照环境：Pi `0.84.1`，更新于 2026-08-10。

## Pi packages

下表覆盖当前 `settings.json.packages` 中全部 28 个 package。资源类型来自 package manifest；“禁用”表示 package 已安装，但对应 extension 不加载。

| 分类       | Package                                     | 当前版本 | 资源                       | 状态           | 用途                                                        |
| ---------- | ------------------------------------------- | -------: | -------------------------- | -------------- | ----------------------------------------------------------- |
| 工具接入   | `npm:pi-mcp-adapter`                        |   2.21.2 | Extension + Skill          | 启用           | 接入 MCP server，并按需发现和调用工具                       |
| 输出控制   | `npm:pi-caveman`                            |    1.0.8 | Extension                  | 启用           | 压缩解释文字，保留技术信息                                  |
| 代码质量   | `npm:@geminixiang/pi-simplify`              |    0.1.2 | Extension                  | 启用           | 检查变更中的复用、质量和效率问题                            |
| Herdr      | `npm:@ogulcancelik/pi-herdr`                |    0.4.0 | Extension                  | 启用           | 从 Pi 控制 Herdr workspace、tab、pane 和 agent              |
| Web        | `npm:@juicesharp/rpiv-web-tools`            |    2.4.0 | Extension                  | 启用           | 提供多 provider Web search 和 fetch                         |
| Skill 参数 | `npm:@juicesharp/rpiv-args`                 |    2.4.0 | Extension                  | 启用           | 为 Skill 提供 `$1`、`$ARGUMENTS` 和 shell substitution      |
| 文档查询   | `npm:@upstash/context7-pi`                  |    0.1.2 | Extension + Skill + Prompt | 启用           | 查询最新 library 文档和示例                                 |
| Memory     | `npm:pi-hermes-memory@0.9.4`                |    0.9.4 | Extension                  | Extension 禁用 | 仅由本地 skills-only 适配层复用 procedural Skills           |
| 代码审查   | `npm:pi-diffwarden`                         |   0.28.0 | Extension                  | 启用           | 深度审查并修复 diff                                         |
| 权限       | `npm:@gotgenes/pi-permission-system@24.0.0` |   24.0.0 | Extension                  | 启用           | 对高风险工具调用执行权限策略                                |
| 缓存       | `npm:@howaboua/pi-cache-hit-predictor`      |    0.0.1 | Extension                  | 启用           | 预测模型或 reasoning 切换后的 prompt cache 命中             |
| TUI        | `git:github.com/angristan/pi-extensions`    |    0.1.0 | Extension collection       | 启用 12 项     | 页脚、代码块、通知、统计等 TUI 增强；仅启用下方列出的子扩展 |
| 桌面控制   | `npm:@injaneity/pi-computer-use`            |    0.5.0 | Extension                  | Extension 禁用 | 当前不从该 package 加载 Pi extension                        |
| Codex      | `npm:@howaboua/pi-codex-conversion`         |   3.0.12 | Extension                  | 启用           | 为 Codex 模型调整工具与 prompt 契约                         |
| Session    | `npm:@furbyhaxx/pi-session-naming`          |    0.2.1 | Extension                  | 启用           | 自动命名、浏览和管理 sessions                               |
| Reasoning  | `npm:@howaboua/pi-auto-reasoning-tool`      |   0.1.11 | Extension                  | 启用           | 允许 agent 按任务阶段调整 reasoning level                   |
| 长任务     | `npm:@howaboua/pi-auto-trees`               |   0.1.12 | Extension                  | 启用           | 为增量长任务提供 marker/end 控制                            |
| 人机协作   | `npm:@howaboua/pi-ask`                      |    0.0.4 | Extension                  | 启用           | 提供交互决策、review 分流和 handoff                         |
| 旁路提问   | `npm:@howaboua/pi-smart-btw`                |    0.2.6 | Extension                  | 启用           | 在异步侧会话中提问，再显式注入主会话                        |
| Workflow   | `npm:@howaboua/pi-markdown-workflows`       |   0.2.20 | Extension                  | 启用           | 管理 Markdown workflows 和子目录 AGENTS.md context          |
| 对抗验证   | `npm:@howaboua/pi-skill-adversarial-qa`     |    0.0.1 | Skill                      | 启用           | 用可执行反例验证边界、回归和不变量                          |
| Agent 文档 | `npm:@howaboua/pi-skill-agents-md`          |    0.0.4 | Skill                      | 启用           | 编写和维护分层 AGENTS.md                                    |
| 文案       | `npm:@howaboua/pi-skill-anti-ai-copy`       |    0.0.4 | Skill                      | 启用           | 保留作者语气并减少 AI 文案痕迹                              |
| 浏览器     | `npm:@howaboua/pi-skill-chrome-cdp`         |    0.0.4 | Skill                      | 启用           | 用 Chrome CDP 检查和控制浏览器                              |
| Skill 开发 | `npm:@howaboua/pi-skill-skill-creator`      |    0.0.5 | Skill                      | 启用           | 创建、验证和维护可复用 Skills                               |
| 简化模式   | `git:github.com/DietrichGebert/ponytail`    |    4.9.0 | Extension + Skill          | 启用           | 强制选择最小、原生、低复杂度实现                            |
| 自主目标   | `npm:@narumitw/pi-goal`                     |   0.49.7 | Extension                  | 启用           | 管理可持续推进直到完成的 `/goal`                            |
| 任务清单   | `npm:@juicesharp/rpiv-todo`                 |    2.4.0 | Extension                  | 启用           | 提供持久 todo 与实时 overlay                                |
| Subagents  | `npm:pi-subagents`                          |   0.45.1 | Extension + Skill + Prompt | 启用           | 单 agent、并行和脚本化 subagent 工作流                      |

Package 源码可通过 npm metadata 或对应 Git URL 查看。版本仅表示这份清单验证时的本地版本；未固定版本的安装源会获取当时最新版。

## 精选 TUI 子扩展

`angristan/pi-extensions` 没有全量启用，只加载：

- `accent-color`
- `better-native-pi`
- `cached-line-resets`
- `code-blocks`
- `context-inspector`
- `footer`
- `image-store`
- `notifications`
- `turn-stats`
- `turn-separator`
- `hyperlinks`
- `working-timer`

对应 `settings.json` filter：

```json
{
  "source": "git:github.com/angristan/pi-extensions",
  "extensions": [
    "extensions/accent-color/index.ts",
    "extensions/better-native-pi/index.ts",
    "extensions/cached-line-resets/index.ts",
    "extensions/code-blocks/index.ts",
    "extensions/context-inspector/index.ts",
    "extensions/footer/index.ts",
    "extensions/image-store/index.ts",
    "extensions/notifications/index.ts",
    "extensions/turn-stats/index.ts",
    "extensions/turn-separator/index.ts",
    "extensions/hyperlinks/index.ts",
    "extensions/working-timer/index.ts"
  ]
}
```

## 本地自动加载 extensions

这些文件位于 `~/.pi/agent/extensions/`。它们依赖个人偏好或外部应用，不属于通用恢复清单。

| Extension                      | 来源                                 | 可移植性                    |
| ------------------------------ | ------------------------------------ | --------------------------- |
| `00-filter-footer-statuses.ts` | 个人页脚过滤                         | 待打包；当前不建议复制      |
| `drop-current-session.ts`      | 个人 `/drop` 命令                    | 可独立打包，当前未发布      |
| `pi-hermes-skills-only.ts`     | 个人 `pi-hermes-memory@0.9.4` 适配层 | 绑定内部版本，不建议复制    |
| `herdr-agent-state.ts`         | Herdr integration 自动生成           | 通过 Herdr 重装 integration |
| `moshi-hooks.ts`               | Moshi 自动生成                       | 通过 Moshi 重装             |
| `orca-agent-status.ts`         | Orca 管理                            | 通过 Orca 重装              |
| `orca-prefill.ts`              | Orca 管理                            | 通过 Orca 重装              |
| `orca-titlebar-spinner.ts`     | Orca 管理                            | 通过 Orca 重装              |
| `superset-hooks.ts`            | Superset integration                 | 通过 Superset 重装          |

## 手动恢复

按需执行，不建议不加审查地全量复制：

```bash
pi install npm:pi-mcp-adapter
pi install npm:pi-caveman
pi install npm:@geminixiang/pi-simplify
pi install npm:@ogulcancelik/pi-herdr
pi install npm:@juicesharp/rpiv-web-tools
pi install npm:@juicesharp/rpiv-args
pi install npm:@upstash/context7-pi
pi install npm:pi-hermes-memory@0.9.4
pi install npm:pi-diffwarden
pi install npm:@gotgenes/pi-permission-system@24.0.0
pi install npm:@howaboua/pi-cache-hit-predictor
pi install git:github.com/angristan/pi-extensions
pi install npm:@injaneity/pi-computer-use
pi install npm:@howaboua/pi-codex-conversion
pi install npm:@furbyhaxx/pi-session-naming
pi install npm:@howaboua/pi-auto-reasoning-tool
pi install npm:@howaboua/pi-auto-trees
pi install npm:@howaboua/pi-ask
pi install npm:@howaboua/pi-smart-btw
pi install npm:@howaboua/pi-markdown-workflows
pi install npm:@howaboua/pi-skill-adversarial-qa
pi install npm:@howaboua/pi-skill-agents-md
pi install npm:@howaboua/pi-skill-anti-ai-copy
pi install npm:@howaboua/pi-skill-chrome-cdp
pi install npm:@howaboua/pi-skill-skill-creator
pi install git:github.com/DietrichGebert/ponytail
pi install npm:@narumitw/pi-goal
pi install npm:@juicesharp/rpiv-todo
pi install npm:pi-subagents
```

安装后运行 `pi config`：按上方 filter 只启用选定的 `angristan/pi-extensions` 资源，并关闭 `pi-hermes-memory` 与 `pi-computer-use` 的 package extensions。外部应用生成的本地 extensions 应由各自 integration 安装器恢复。

## 维护方式

更新清单前核对：

```bash
pi list
pi --version
```

同时检查 `~/.pi/agent/settings.json` 中的 package filters，以及 `~/.pi/agent/extensions/` 的自动加载文件。不要把 `settings.json`、`models.json`、`auth.json` 或任何 token 提交到仓库。
