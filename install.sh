#!/usr/bin/env bash
# dsh-ai-mind 一键安装脚本
# 用法：curl -fsSL <install.sh 地址> | bash -s -- [profile]
# 可选环境变量：AIM_VERSION（默认 0.1.14）
set -euo pipefail

VERSION="${AIM_VERSION:-0.1.14}"
PROFILE="${1:-web}"
ASSET="dsh-ai-mind-${VERSION}-fnos-release.zip"
BASE="https://github.com/magicindex/dsh-ai-mind/releases/download/v${VERSION}"

for cmd in dsh curl unzip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "缺少命令：$cmd。请先安装后再执行。" >&2
    exit 1
  fi
done

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "下载 dsh-ai-mind ${VERSION}..."
if ! curl -fsSL --retry 2 --connect-timeout 10 \
  -o "$TMP_DIR/$ASSET" "$BASE/$ASSET"; then
  echo "下载失败：$BASE/$ASSET" >&2
  echo "请检查网络，或配置代理/镜像加速后重试。" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1 &&
  curl -fsSL --connect-timeout 10 -o "$TMP_DIR/SHA256SUMS" "$BASE/SHA256SUMS"; then
  expected="$(cd "$TMP_DIR" && grep "  ${ASSET}$" SHA256SUMS || true)"
  if [ -n "$expected" ]; then
    actual="$(sha256sum "$TMP_DIR/$ASSET" | awk '{print $1}')"
    if [ "$actual" != "${expected%% *}" ]; then
      echo "安装包 SHA256 校验失败，已停止。" >&2
      exit 1
    fi
  fi
fi

unzip -q "$TMP_DIR/$ASSET" -d "$TMP_DIR"
PKG_DIR="$TMP_DIR/dsh-ai-mind-${VERSION}"
chmod +x "$PKG_DIR/install.sh"
"$PKG_DIR/install.sh" "$PROFILE"
