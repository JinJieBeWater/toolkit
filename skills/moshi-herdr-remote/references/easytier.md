# EasyTier 组网

本方案固定使用 EasyTier Pro 托管，覆盖无公网 IP、家庭宽带 NAT 和国内跨网场景。

## 1. EasyTier Pro 控制台

- 在 easytier.net 注册并创建网络；地址范围和区域使用控制台当前默认值或选择离设备最近的可用区域
- 设备管理：每台设备**独立密钥**（`etk_...`），Mac 与移动设备各一，勿共用
- 网络页**挂载设备**到网络

**完成标准**：控制台「已挂载实例」> 0，且每台设备显示「已授权」。

## 2. macOS（root LaunchDaemon）

```zsh
(
set -e
version=2.6.4 # 本方案已验证版本；升级时只改这里
case "$(uname -m)" in
  arm64)
    asset_arch=aarch64
    sha256=4be1882d1aa36d31c1d6ba0596f2cf8a097e371f8da124212324b2e0f8df7e4b
    ;;
  x86_64)
    asset_arch=x86_64
    sha256=89fc28a6e6995259d76ce3f11775220e8a21c760e94df91a6a9db30a69b6982e
    ;;
  *) echo "unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fL -o "$tmp/easytier.zip" \
  "https://github.com/EasyTier/EasyTier/releases/download/v${version}/easytier-macos-${asset_arch}-v${version}.zip"
echo "$sha256  $tmp/easytier.zip" | shasum -a 256 -c -
unzip -q "$tmp/easytier.zip" -d "$tmp"
install -m 0755 \
  "$tmp/easytier-macos-${asset_arch}/easytier-core" \
  "$tmp/easytier-macos-${asset_arch}/easytier-cli" \
  "$(brew --prefix)/bin/"
)
```

使用同 Skill 的三个 service assets。真实密钥只写入 root-only env 文件，不放进 plist 或进程参数：

```zsh
(
set -e
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp "<SKILL_DIR>/assets/com.easytier.moshi-net.plist" "$tmp/"
cp "<SKILL_DIR>/assets/moshi-net.env.example" "$tmp/moshi-net.env"
sed "s|__EASYTIER_CORE__|$(command -v easytier-core)|" \
  "<SKILL_DIR>/assets/moshi-net.sh" \
  > "$tmp/moshi-net.sh"
${EDITOR:-vi} "$tmp/moshi-net.env"
grep -Eq "^ET_CONFIG_SERVER='tcp://et-web\.console\.easytier\.net:22020/etk_[A-Za-z0-9]+'$" \
  "$tmp/moshi-net.env"
grep -Eq "^ET_HOSTNAME='[A-Za-z0-9.-]+'$" "$tmp/moshi-net.env"
grep -qx "ET_SECURE_MODE='true'" "$tmp/moshi-net.env"
plutil -lint "$tmp/com.easytier.moshi-net.plist"
sudo install -d -o root -g wheel -m 0700 "/Library/Application Support/EasyTier"
sudo install -o root -g wheel -m 0700 "$tmp/moshi-net.sh" \
  "/Library/Application Support/EasyTier/moshi-net.sh"
sudo install -o root -g wheel -m 0600 "$tmp/moshi-net.env" \
  "/Library/Application Support/EasyTier/moshi-net.env"
sudo install -o root -g wheel -m 0644 "$tmp/com.easytier.moshi-net.plist" \
  /Library/LaunchDaemons/com.easytier.moshi-net.plist
sudo launchctl bootout system/com.easytier.moshi-net 2>/dev/null || true
sudo launchctl bootstrap system /Library/LaunchDaemons/com.easytier.moshi-net.plist
)
```

编辑临时 env 文件时只替换 `__MAC_ETK__` 和 `__MAC_HOSTNAME__`；hostname 使用字母、数字、点或连字符。`HOME=/var/root` 必须保留，否则 root 会报 `failed to resolve machine id`。

**完成标准**：`launchctl print system/com.easytier.moshi-net` 显示 running；`easytier-cli -p 127.0.0.1:15888 peer` 有本机虚拟 IP，记为 `<MAC_EASYTIER_IP>`。

**用户态 LaunchAgent 不可行**：TUN 需 root，报 `tun device error: Operation not permitted (os error 1)`。

## 3. 移动端（Android 已验证示例）

移动设备需支持 EasyTier 私网与 Moshi。以下 EasyTier 客户端安装和排障步骤仅为 Android 已验证示例，不代表其他平台的具体支持或安装方式。

Android 从 [EasyTier v2.6.4 release](https://github.com/EasyTier/EasyTier/releases/tag/v2.6.4) 下载 `app-arm64-release.apk`，与 Mac 端保持同版本。下面是已验证的 EasyTier Pro Android 导入格式；导入后 App 自动补 `instance_name`、`instance_id` 和 `dhcp`：

```toml
hostname = "<PHONE_HOSTNAME>"
dhcp = true
listeners = ["tcp://0.0.0.0:11010", "udp://0.0.0.0:11010"]

[network_identity]
network_name = "easytier"
network_secret = "<PHONE_ETK>"
```

现有网络新增设备时，导入内容只有该设备的新 ETK 与上述最小 TOML；不复制 Mac 或其他设备配置中的 instance_id、虚拟 IP（`dhcp = true` 由网络自动分配）或本地 private key。

启动后：安卓设置把 EasyTier **电池/后台限制设为不限制**（杀后台 → mesh 掉线 → 终端报连接错误）。

**完成标准**：Mac 侧 `easytier-cli -p 127.0.0.1:15888 peer` 出现移动设备节点；`p2p ... udp` 表示打洞直连，`relay`/`https-udp` 表示兜底中继。

## Verification（最终）

1. `easytier-cli -p 127.0.0.1:15888 peer`：本机与移动设备节点都存在
2. `launchctl print system/com.easytier.moshi-net` running；重启 Mac 后自启
3. 移动设备重连后 peer 自动恢复。Android 已验证示例：App VPN 亮、电池不限制
