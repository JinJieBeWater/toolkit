# 分层排障

停在首个失败层；上层症状不作为根因。

1. **EasyTier service**：`launchctl print system/com.easytier.moshi-net` 应为 running；失败时读 `/var/log/easytier.log`。`--check-config` 会静默忽略未知 TOML 字段；`easytier-cli node config` 可看实际配置，但输出可能含密钥，不复制到聊天或日志摘录。
2. **Mesh**：执行 [EasyTier 组网](easytier.md)末尾验证，确认本机与移动设备节点都存在。Android 已验证示例：节点消失时先检查 VPN 和电池限制。
3. **SSH/Mosh**：从 EasyTier 网络测试 `<MAC_EASYTIER_IP>:22`。Android 已验证示例：TUN 可能不回 ICMP，ping 不能判定失败；Mosh 报 `os error 111` 时先确认移动设备仍在 peer 列表。
4. **Moshi hooks**：运行 `moshi-hook probe` 和 `moshi-hook status`；stale hook 按输出给出的单目标命令重装。
5. **Herdr**：运行 `herdr session list --json` 和 `herdr integration status`。
6. **Agent**：运行 `herdr agent list`；`unknown` 表示无法可靠识别，不表示完成。

完成标准：已定位首个失败层，并用该层命令得到可复现证据。
