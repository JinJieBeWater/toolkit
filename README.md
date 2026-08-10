# Spencer Agent Toolkit

个人 Agent 工具集合。目前包含 Pi Loom、Moshi + Herdr 移动端远程接入和 Lark Skill；另附[我的 Pi 扩展清单](docs/pi-extensions.md)，记录当前 packages、启用状态和恢复方式。

## 怎么选

| 需求                                                                     | 选择                 |
| ------------------------------------------------------------------------ | -------------------- |
| 在 Herdr 中让多个 Pi 分工，并保留辅助上下文                              | Pi Loom              |
| 从支持 EasyTier 私网与 Moshi 的移动设备持续操作 Mac 上的受支持 CLI Agent | `moshi-herdr-remote` |
| 操作飞书消息、文档、云盘、日历等工作区能力                               | `lark` Skill         |

安装工具无需手动 clone 仓库；安装命令会自行下载。

## Pi Loom

Pi Loom 在 Pi 与 Herdr 之间管理任务所有权和持久 helper：当前 Pi 可以继续负责最终结果，也可以启动另一个 Pi 贡献结果，或把所有权转移出去。

它由两部分组成，完整使用时两者都需要：

- **Pi Loom Skill**：决定直接执行、贡献或所有权转移。
- **Pi Loom 扩展**：启动、查看、保留和关闭 Herdr 中的持久 helper。

### 安装

需要 [Pi](https://pi.dev)、最新版 Herdr、Node.js 22.19+ 和 Bun。

```bash
# Herdr 操作能力
bunx skills add ogulcancelik/herdr --skill herdr -g

# Pi Loom Skill；安装时可选择目标 Agent
bunx skills add https://github.com/JinJieBeWater/toolkit --skill pi-loom -g

# Pi Loom 扩展
pi install git:github.com/JinJieBeWater/toolkit
```

重新启动 Herdr 中的 Pi。扩展只在 Herdr 环境中注册工具。

实现与开发说明见 [`packages/pi-loom/README.md`](packages/pi-loom/README.md)。

## Moshi + Herdr 移动端远程接入

`moshi-herdr-remote` 提供一条完整配置路径：安装主机工具、建立 EasyTier 私网、配对 Moshi、启用 Herdr 持久会话、启动受 Herdr 与 Moshi 支持的 CLI Agent，再从移动端完成断线重连验收。移动设备需支持 EasyTier 私网与 Moshi；仓库内的 Android 步骤仅是已验证的 EasyTier 客户端示例。默认 Agent 为 Pi。

```bash
bunx skills add https://github.com/JinJieBeWater/toolkit --skill moshi-herdr-remote -g
```

具体流程见 [`skills/moshi-herdr-remote/SKILL.md`](skills/moshi-herdr-remote/SKILL.md)。多 Agent 分工时再安装 Pi Loom。

## Lark Skill

封装官方 `larksuite/cli` Skills，通过 `lark-cli` 操作飞书/Lark 消息、文档、云盘、Wiki、Base、日历、任务等工作区能力。

```bash
bunx skills add https://github.com/JinJieBeWater/toolkit --skill lark -g
```

需要安装 `lark-cli` 并完成飞书/Lark 应用授权。首次使用会通过 `git` 联网同步官方指南；后续运行 `skills/lark/scripts/sync-upstream.sh` 可主动更新。

## 我的 Pi 扩展清单

[`docs/pi-extensions.md`](docs/pi-extensions.md) 记录我当前安装的 Pi packages、启用状态、bundled Skills、精选 TUI 子扩展和本地 integrations，并提供用途说明与手动恢复命令。清单用于公开参考，不包含模型配置、认证信息或 token；安装第三方 package 前应先检查源码。

## 开发

只有修改源码时才需要 clone：

```bash
git clone https://github.com/JinJieBeWater/toolkit.git
cd toolkit
bun install
bun run check
bun test
```

## 许可

仓库当前未声明开源许可证。阅读和本地试用不代表获得再分发授权。
