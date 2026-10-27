# 我的 Pi 扩展清单

这份清单记录我日常使用的 Pi packages、资源过滤、Skills 和本地 integrations，供选型和手动恢复参考。它不是完整配置备份，也不建议全部安装；Pi package 可以执行代码，安装前应检查源码。

更新于 2026-10-27，只展示配置选择与使用方式，不记录安装版本。当前配置 **29 个 package**；以用户主目录为 cwd，资源加载器发现 **38 个扩展入口、89 个 Skills**。项目目录还可能带入额外资源。入口数量不等于 package 数量，也不代表外部服务、宿主功能都已激活。

## Pi packages

下表覆盖 `settings.json.packages` 的全部条目，资源类型来自 package manifest。加载方式分为：

- **原生**：由 Pi 直接加载 package 声明的资源。
- **适配/direct**、**适配/deferred**：package 的 `extensions` 设为 `[]`，但本地 `deferred-tools` 适配层仍加载上游工具，分别直接公开或按需发现；不等于功能被禁用。

| Package                                                | 资源                       | 加载方式                    | 用途                                            |
| ------------------------------------------------------ | -------------------------- | --------------------------- | ----------------------------------------------- |
| `npm:@geminixiang/pi-simplify`                         | Extension                  | 适配/deferred               | 检查变更的复用、质量和效率                      |
| `npm:@ogulcancelik/pi-herdr`                           | Extension                  | 原生                        | 控制 Herdr workspace、tab、pane 和 agent        |
| `npm:@upstash/context7-pi`                             | Extension + Skill + Prompt | 工具适配/deferred，其余原生 | 查询 library 文档和示例                         |
| `npm:@gotgenes/pi-permission-system`                   | Extension                  | 原生                        | 对工具调用执行权限策略                          |
| `npm:@howaboua/pi-cache-hit-predictor`                 | Extension                  | 原生                        | 预测模型或 reasoning 切换后的 prompt cache 命中 |
| `git:github.com/angristan/pi-extensions`               | Extension collection       | 原生，仅 12 项              | TUI 渲染、通知和统计                            |
| `npm:@howaboua/pi-codex-conversion`                    | Extension                  | 原生                        | 为 Codex 模型调整工具与 prompt 契约             |
| `npm:@furbyhaxx/pi-session-naming`                     | Extension                  | 原生                        | 自动命名、浏览和管理 sessions                   |
| `npm:@howaboua/pi-auto-trees`                          | Extension                  | 原生                        | 通过 `/marker`、`/end` 推进增量长任务           |
| `npm:@howaboua/pi-ask`                                 | Extension                  | 原生                        | 交互决策、review 分流和 handoff                 |
| `npm:@howaboua/pi-smart-btw`                           | Extension                  | 原生                        | 异步侧会话提问，再显式注入主会话                |
| `npm:@howaboua/pi-skill-adversarial-qa`                | Skill                      | 原生                        | 用可执行反例验证边界、回归和不变量              |
| `npm:@howaboua/pi-skill-agents-md`                     | Skill                      | 原生                        | 编写和维护分层 AGENTS.md                        |
| `npm:@howaboua/pi-skill-anti-ai-copy`                  | Skill                      | 原生                        | 保留作者语气，减少空泛文案                      |
| `npm:@howaboua/pi-skill-skill-creator`                 | Skill                      | 原生                        | 创建、验证和维护 Skills                         |
| `git:github.com/DietrichGebert/ponytail`               | Extension + Skill          | 原生，Skill 白名单          | 最小实现模式与 `ponytail-review`                |
| `npm:@juicesharp/rpiv-todo`                            | Extension                  | 适配/direct                 | 持久 todo 与实时 overlay                        |
| `npm:pi-web-access`                                    | Extension                  | 原生                        | 多 provider Web search、fetch、PDF 和视频分析   |
| `~/my/tools/pi-skill-manager`                          | Extension                  | 适配/deferred               | 管理可复用 Skills，不加载 memory 子系统         |
| `npm:pi-autoresearch`                                  | Extension + Skill          | 原生                        | 运行、测量并保留或丢弃实验                      |
| `npm:@howaboua/pi-codex-web-run`                       | Extension                  | 原生                        | Codex Web 搜索与导航                            |
| `npm:@howaboua/pi-codex-imagegen`                      | Extension                  | 适配/deferred               | Codex 图像生成与编辑                            |
| `npm:@howaboua/pi-shepherdr`                           | Extension                  | 原生                        | 持久、阻塞式或异步 Pi 子 agent                  |
| `~/my/tools/pi-evals`                                  | Skill                      | 原生                        | 设计、审计和迭代 evals                          |
| `npm:@howaboua/pi-browser`                             | Extension                  | 原生，2 个入口              | 检查和控制已登录浏览器                          |
| `npm:@howaboua/pi-skill-harness-and-agent-engineering` | Skill                      | 原生                        | Agent 工具、扩展、指令和缓存工作流              |
| `npm:@howaboua/pi-agent-board`                         | Extension                  | 原生，2 个入口              | Agent 消息板与只读浏览器查看器                  |
| `~/my/tools/pi-lovely-mermaid`                         | Extension                  | 原生                        | 在 Pi 中渲染 Mermaid                            |
| `npm:@howaboua/pi-notes-compaction`                    | Extension                  | 原生，2 个入口              | 持久 notes 与 notes 引导的上下文换窗            |

安装源未锁定依赖，安装时会获取当时可用的包。三个 `~/my/tools/` 条目是独立本地项目，不随本仓库分发。

`pi-notes-compaction` 是单独安装的配套包，不是 `pi-codex-conversion` 的第二个入口。Notes、Browser、Agent Board 各自声明了 changelog 和功能入口，因此不能把 38 个入口当作 38 项独立能力。

## 资源过滤与工具适配

### 精选 TUI 子扩展

`angristan/pi-extensions` 只加载以下 12 项。用这个对象替换 `packages` 中对应的 source 条目，不要用它覆盖整个 `packages` 列表：

```json
{
  "source": "git:github.com/angristan/pi-extensions",
  "extensions": [
    "extensions/accent-color/index.ts",
    "extensions/auto-session-title/index.ts",
    "extensions/better-native-pi/index.ts",
    "extensions/cached-line-resets/index.ts",
    "extensions/code-blocks/index.ts",
    "extensions/context-inspector/index.ts",
    "extensions/herdr-tab-title/index.ts",
    "extensions/notifications/index.ts",
    "extensions/reload-all/index.ts",
    "extensions/turn-stats/index.ts",
    "extensions/hyperlinks/index.ts",
    "extensions/working-timer/index.ts"
  ]
}
```

`footer`、`image-store`、`prevent-sleep` 等 25 个独立入口不在白名单中；上游源码整体保留。未启用入口不等于目录未被复用，例如 `better-native-pi` 仍引用 `background-jobs/service.ts` 和 `image-store` 的辅助函数，不能直接删除这些目录。

### 其他 package filters

以下也是 `packages` 内的条目片段。`extensions: []` 只过滤 extension，不关闭 package 自带的 Skills 或 prompts：

```json
[
  { "source": "npm:@geminixiang/pi-simplify", "extensions": [] },
  { "source": "npm:@upstash/context7-pi", "extensions": [] },
  { "source": "npm:@juicesharp/rpiv-todo", "extensions": [] },
  { "source": "../../my/tools/pi-skill-manager", "extensions": [] },
  { "source": "npm:@howaboua/pi-codex-imagegen", "extensions": [] },
  {
    "source": "git:github.com/DietrichGebert/ponytail",
    "skills": ["skills/ponytail-review/SKILL.md"]
  }
]
```

本地 source 相对 `~/.pi/agent/` 解析，换机器时需调整。Ponytail 保留 extension，只从 package 加载 `ponytail-review` Skill。

适配层位于 `~/.pi/agent/startup-optimization/deferred-tools.ts`，注册表为同目录的 `deferred-tools.json`：

| 上游 package            | 工具                                                            | Exposure |
| ----------------------- | --------------------------------------------------------------- | -------- |
| `rpiv-todo`             | `todo`                                                          | direct   |
| `pi-simplify`           | `simplify_candidates`、`code_smell_scan`、`code_smell_findings` | deferred |
| `context7-pi`           | `resolve-library-id`、`query-docs`                              | deferred |
| `pi-codex-imagegen`     | `imagegen`                                                      | deferred |
| 本地 `pi-skill-manager` | `skill_manage`                                                  | deferred |

这里记录的是注册策略，不保证每种执行模式都能发现工具；PCC Code/TS 会调整工具目录和原生搜索入口，当前组合尚未完成真实会话的发现与调用验证。

适配层未随本仓库分发。没有该适配层时，不要照抄这五个 package 的空 extension filter，否则工具不会加载；应保留其原生 extension。这里通过配置调用上游入口，不修改上游源码。

## Skills 来源

89 个 Skills 由 **71 个通用 Skills、2 个 Pi 专属 Skills、16 个 package Skills** 组成。数量表示发现的资源，不代表每项都会自动向模型公开；本地 `skill-advertisement.ts` 提供按需 `skill_search`。

- 通用目录：`~/.agents/skills/`。不在本次清单中复制第三方或私有 Skill 正文。
- Pi 专属目录：`~/.pi/agent/skills/`，当前为 `multi-agent-review`、`show-me`。共享目录下的另一份 `show-me` 已通过路径 filter 排除。
- 项目私有 Skills 随项目维护；额外的项目资源不计入上述用户级快照。

Package 自带的 16 个 Skills：

| Package                                  | Skills                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `context7-pi`                            | `context7-docs`                                                                                                                        |
| `pi-skill-adversarial-qa`                | `adversarial-qa`                                                                                                                       |
| `pi-skill-agents-md`                     | `agents-md`                                                                                                                            |
| `pi-skill-anti-ai-copy`                  | `anti-ai-copy`                                                                                                                         |
| `pi-skill-skill-creator`                 | `skill-creator`                                                                                                                        |
| `ponytail`                               | `ponytail-review`                                                                                                                      |
| `pi-autoresearch`                        | `autoresearch-create`、`autoresearch-finalize`、`autoresearch-hooks`                                                                   |
| 本地 `pi-evals`                          | `pi-evals`                                                                                                                             |
| `pi-skill-harness-and-agent-engineering` | `agent-session-diagnostics`、`agent-tool-design`、`extension-design`、`harness-checklist`、`instruction-calibration`、`prompt-caching` |

## 原生规则与推理偏好

全局规则使用 Pi 原生入口 `~/.pi/agent/AGENTS.md`，当前保留 11 条。已移除自动注入 `~/.agents/AGENTS.md` 的 `shared-agent-context`；修改原生规则后需 reload 或重开会话。

子 agent 默认用 Shepherdr `agents`，用户明确指定 Herdr 与其他 harness 时才走 Herdr 原生入口。审查默认 `ponytail-review`，规范验收用 `code-review`；只有明确要求多 agent 独立复核时才用 `multi-agent-review`。

推理偏好仅给 Sol 使用 `max`，其余模型默认 `high`。以下是可手动合并到 `settings.json` 的偏好片段，不含 provider、endpoint 或凭据：

```json
{
  "defaultThinkingLevel": "high",
  "modelThinkingLevels": {
    "openai-codex/gpt-6.1-sol": "max"
  }
}
```

## 本地 extensions 与宿主 integrations

这些入口依赖个人配置或外部应用，不属于通用恢复清单：

| 位置                                                      | 用途                        | 恢复方式                          |
| --------------------------------------------------------- | --------------------------- | --------------------------------- |
| `~/.pi/agent/startup-optimization/skill-advertisement.ts` | 按需发现 Skills             | 个人扩展，未随本仓库分发          |
| `~/.pi/agent/startup-optimization/deferred-tools.ts`      | 调用上游工具并控制 exposure | 个人适配层，未随本仓库分发        |
| `~/.pi/agent/extensions/00-filter-footer-statuses.ts`     | 个人页脚过滤                | 未随本仓库分发                    |
| `~/.pi/agent/extensions/drop-current-session.ts`          | 个人 `/drop` 命令           | 未随本仓库分发                    |
| `~/.pi/agent/extensions/herdr-agent-state.ts`             | Herdr agent 状态对接        | 通过 Herdr integration 安装器恢复 |
| `~/.pi/agent/extensions/moshi-hooks.ts`                   | Moshi 宿主对接              | 通过 Moshi 安装器恢复             |

`~/.pi/agent/extensions/pi-permission-system/` 当前只有配置文件，不是额外的扩展入口。`pi-hermes-skills-only.ts`、`superset-hooks.ts`、`shared-agent-context.ts` 已不再加载。

Herdr 侧另有个人插件 `jinjiebewater.herdr`，不计入 Pi packages 或扩展入口数；其源码和宿主私有设置也未随本仓库分发。

## 手动恢复

1. 安装 Pi 后，按上表 source 选择需要的 package。npm 和 Git 源使用 `pi install`，例如：

```bash
pi install npm:@howaboua/pi-codex-conversion
pi install npm:@howaboua/pi-notes-compaction
pi install git:github.com/angristan/pi-extensions
```

2. 运行 `pi config` 或编辑原生配置，应用所需的资源 filters。不要在缺少适配层时关闭仍需使用的上游 extensions。
3. 本地项目、通用 Skills、个人扩展及宿主 integrations 分别从其原来源恢复；安装上面的 package 不能恢复这些内容。
4. 按需合并推理偏好，维护原生 `AGENTS.md`，再 reload 或重开会话。

这份清单没有锁定依赖，也不提供一键恢复脚本。

## 维护方式

更新清单前核对：

```bash
pi list
```

同时核对 package manifest、`~/.pi/agent/settings.json` 的 filters、适配层注册表，以及本地自动加载入口。本次只读资源检查为：扩展加载错误 0、Skills diagnostics 0、重复工具名 0；未对所有外部服务逐一发起请求。

只发布脱敏清单和必要片段，不要提交完整 `settings.json`、`models.json`、`auth.json`、token、会话或宿主私有配置。
