#!/usr/bin/env bash
# dsh-ai-mind 一键安装脚本
# 用法：curl -fsSL <install.sh 地址> | bash -s -- [profile]
# 可选环境变量：AIM_VERSION（默认 0.1.10）、AIM_MIRROR（gitea|github，默认 gitea）
set -euo pipefail

VERSION="${AIM_VERSION:-0.1.10}"
PROFILE="${1:-web}"
MIRROR="${AIM_MIRROR:-gitea}"
ASSET="dsh-ai-mind-${VERSION}-fnos-release.zip"
GITEA_BASE="https://gitea.topzero.cn:10241/cyberzero/dsh-ai-mind/releases/download/v${VERSION}"
GITHUB_BASE="https://github.com/magicindex/dsh-ai-mind/releases/download/v${VERSION}"

case "$MIRROR" in
  gitea) BASE="$GITEA_BASE" ;;
  github) BASE="$GITHUB_BASE" ;;
  *)
    echo "AIM_MIRROR 只支持 gitea 或 github，当前为：$MIRROR" >&2
    exit 1
    ;;
esac

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

echo "下载 dsh-ai-mind ${VERSION}（${MIRROR}）..."
if ! curl -fsSL --retry 2 --connect-timeout 10 \
  -o "$TMP_DIR/$ASSET" "$BASE/$ASSET"; then
  echo "下载失败：$BASE/$ASSET" >&2
  echo "可改用另一个源重试，例如：... | AIM_MIRROR=github bash -s -- $PROFILE" >&2
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
