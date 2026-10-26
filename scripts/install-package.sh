#!/usr/bin/env bash
# 完整发布包内的安装脚本：安装 dsh-better-sidebar（如尚未安装）与 dsh-ai-mind。
# 用法：./install.sh [profile]
set -euo pipefail

PROFILE="${1:-web}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDEBAR_TGZ="$DIR/vendor/dsh-better-sidebar-0.26.0.tgz"
AI_MIND_TGZ="$(find "$DIR" -maxdepth 1 -name 'dsh-ai-mind-*.tgz' -print -quit)"

if ! command -v dsh >/dev/null 2>&1; then
  echo "未找到 dsh 命令。请先确保 DSH CLI 在 PATH 中。" >&2
  exit 1
fi

if [ -z "$AI_MIND_TGZ" ]; then
  echo "发布包内缺少 dsh-ai-mind-*.tgz。" >&2
  exit 1
fi

if dsh plugin --profile "$PROFILE" list dsh-better-sidebar 2>/dev/null |
  grep -q 'dsh-better-sidebar@'; then
  echo "[1/2] 已检测到 dsh-better-sidebar，跳过安装，避免降级。"
else
  echo "[1/2] 安装 dsh-better-sidebar 0.26.0 ..."
  dsh plugin --profile "$PROFILE" add "$SIDEBAR_TGZ"
fi

echo "[2/2] 安装 $(basename "$AI_MIND_TGZ") ..."
dsh plugin --profile "$PROFILE" add "$AI_MIND_TGZ"

cat <<'MSG'

安装完成。

请重启 DSH 使插件生效，例如：
  dsh web

重启后打开一个已有会话，右侧栏会自动出现「AI 心流」。
如果被关闭，可从右侧栏的 + 菜单重新打开。
MSG
