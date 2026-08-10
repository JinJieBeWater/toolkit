---
name: "moshi-herdr-remote"
description: "Moshi + Herdr Android 手机远程：通过 EasyTier 私网连接 macOS，持续操作 Pi 或其他受支持 CLI Agent。"
---

# Moshi + Herdr Android 手机远程

目标链路：手机 → EasyTier 私网 → Moshi SSH/Mosh → Herdr 持久 pane → Agent。

默认配置 Pi：命令、Herdr integration 和 Moshi target 都是 `pi`。用户指定其他 Agent 时，分别从 `herdr agent` 和 `moshi-hook install --help` 读取两边接受的名称；任一不支持则停止完整配置并说明缺失项。

## Procedure

### 1. 收集输入并检查 Mac

自动读取 Mac 用户和名称，再确认其余输入：

```bash
id -un
scutil --get ComputerName 2>/dev/null || hostname -s
```

- macOS 已安装 Homebrew；默认安装 Pi 时需要 Node.js 22.19+。
- Moshi Pro 可用；Mosh 传输和 Herdr session picker 属于 Pro 功能。
- 目标 Agent，默认 `pi`。
- 用户可操作 Android 10+ 手机，安装 EasyTier 与 Moshi，并完成配对。

完成标准：已记录 `<MAC_USER>`、`<MAC_NAME>`、`<AGENT_COMMAND>`、`<HERDR_AGENT>` 和 `<MOSHI_AGENT>`；依赖与 Moshi Pro 齐全；两项 integration 都支持目标 Agent。

### 2. 安装主机工具

只安装缺失项：

```bash
brew install herdr
brew tap rjyo/moshi
brew trust rjyo/moshi
brew install rjyo/moshi/moshi-hook
brew install mosh

# 默认 Agent
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

用户选择其他 Agent 时，用其官方安装方式替换最后一条。认证必须由用户在目标 Agent 官方登录流程中完成。

完成标准：`herdr --version`、`moshi-hook version`、`mosh-server --version` 和目标 Agent 的版本命令均成功。

### 3. 建立 EasyTier 私网

读取并执行 [EasyTier 组网](references/easytier.md)。记录 Mac 虚拟 IP 为 `<MAC_EASYTIER_IP>`。EasyTier 设备密钥只进入配置或系统凭据。

完成标准：`easytier-cli -p 127.0.0.1:15888 peer` 能看到 Mac 和手机，并已记录 `<MAC_EASYTIER_IP>`。

### 4. 配置 Moshi

Moshi 有两次独立配对。先配 SSH/Mosh 主机入口：

```bash
moshi-hook host enable-ssh
moshi-hook host setup \
  --host <MAC_EASYTIER_IP> \
  --port 22 \
  --user <MAC_USER> \
  --name "<MAC_NAME> via EasyTier"
```

`host setup` 提示时暂停，让用户在 Moshi App 完成 Easy Pair。再配 Agent hook bridge：从 App 的 Integrations 获取 pairing token，通过隐藏输入传给 CLI。

```zsh
(
set -e
read -rs "MOSHI_PAIRING_TOKEN?Moshi pairing token: " && printf '\n'
trap 'unset MOSHI_PAIRING_TOKEN' EXIT
moshi-hook pair --token "$MOSHI_PAIRING_TOKEN"
moshi-hook install --target <MOSHI_AGENT>
brew services start moshi-hook
)
```

Easy Pair QR 是临时 SSH 访问凭据；只在用户准备扫码时生成，不进入截图、日志或聊天。

完成标准：手机能通过 `<MAC_EASYTIER_IP>:22` 建立终端，`moshi-hook host list` 有该主机，`moshi-hook status` 显示 paired、daemon 可达、目标 Agent hook 为 current。

### 5. 配置 Herdr

```bash
brew services start herdr
herdr integration install <HERDR_AGENT>
herdr integration status
herdr status server
```

让用户运行 `herdr`，创建 pane 并运行 `<AGENT_COMMAND>`。Pi 首次启动时由用户完成 `/login`。

完成标准：Herdr integration 为 current；目标 Agent 在 pane 中可接收 prompt；退出 Herdr 客户端后 pane 进程仍在。

### 6. 手机端到端验收

1. 手机 EasyTier 开启 VPN，电池策略设为“不限制”。
2. Moshi 连接 `<MAC_NAME> via EasyTier`。
3. 进入 Herdr session，向目标 Agent 发送一次无副作用 prompt。
4. 手机断网后恢复，再进入同一 pane。

完成标准：手机可输入、查看输出和处理审批；断线重连后原 pane 与 Agent 仍在。`moshi-hook context` 在该 pane 中返回 `kind=herdr`。

任一步骤失败时，读取[分层排障](references/diagnostics.md)，从网络层向上停在首个失败。

## Security

- Moshi 保存并使用 EasyTier 虚拟 IP；路由器不做公网 22 端口转发。macOS Remote Login 仍可能从局域网及其他主机接口访问。
- EasyTier 设备密钥、Moshi pairing token、SSH 私钥和 Agent 凭据不进入仓库、日志摘录或 prompt。
- 每台 EasyTier 设备使用独立密钥；Easy Pair 只把手机生成的 SSH 公钥写入 Mac。
- 启用 hooks 前告知用户：通知摘要和少量 prompt/response/approval 文本会经过 Moshi 服务；源码、完整 transcript 和终端流量不经过该服务。
