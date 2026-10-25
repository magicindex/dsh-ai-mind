# dsh-ai-mind · AI 心流

作者：**cyberzero** · MIT License

DSH 右侧栏插件：把当前会话里 AI 的**实时状态、思路、任务进度、思路导图、任务导图**折叠到一页。

## 预览

<p align="center">
  <img src="docs/preview-active-dark.png" width="49%" alt="运行中的深色面板">
  <img src="docs/preview-done-light.png" width="49%" alt="完成态的亮色面板">
</p>

左：执行操作中的深色面板；右：本轮完成后的亮色面板。

## 显示什么

- **实时阶段**：待命 / 等待响应 / 推理中 / 组织回答 / 执行操作 / 本轮完成 / 需要处理。
- **当前动作**：正在调用的工具、目标文件或命令、轮次、步骤、耗时、生成 token。
- **本轮目标**：最后一条真实用户消息。
- **当前思路**：模型可见的 reasoning 流；流式输出时实时追加并显示光标。
- **思路导图**：目标 → 思路 → 最近动作 → 输出，以放射状节点图呈现，当前动作高亮。
- **任务导图**：优先读取 `todo/write` 的任务清单与完成度；清单超过 40 步未刷新时自动退回真实工具轨迹，并把进度标为「执行进度」，避免展示过期计划。
- **实时进度条**：完成数 / 总数，执行中带流光动画。
- **亮色 / 暗色主题**：默认跟随 DSH 当前外观，也可在标题栏一键切换。

数据来自 `ctx.sessions` 的会话事件窗（durable event + `assistant/live-chunk`），不调用模型、不额外发请求、不在服务端落任何数据。

## 布局

右侧栏是一块固定的一屏 dashboard，页面本身不滚动：

- 顶部状态 hero：阶段、当前动作、四项指标、执行进度；
- 2×2 bento：左侧「本轮目标 + 当前思路」，右侧「思路导图 + 任务导图」；
- 卡片内部各自滚动，长思路、多任务不会把整页撑开；
- 用容器查询按**面板宽度**（不是浏览器视口）切换：小于 640px 时自动改为单列堆叠，仍然一屏展示全部区块。

## 主题

- 默认跟随 DSH 外观：DSH 是浅色时面板自动用亮色主题，DSH 切到深色时自动变暗；
- 标题栏右侧的太阳 / 月亮按钮可手动切换，选择写入 `localStorage`（`dsh-ai-mind:theme`），之后以手动选择为准；
- 亮色主题使用与深色版相同的布局和强调色体系，重新调过对比度，不会出现“白底灰字”。

## 跟随当前会话

- 打开有内容的会话时，标签自动出现在右侧，并随会话切换重新订阅 `scope.sessionId`，内容跟着对话走；
- 空白会话（首页 / New task）不自动打开，避免为了一个没有内容的 panel 挤占整个 DSH 布局；
- 如果从会话切回 New task，残留在空白会话里的「AI 心流」会自动收起，左侧栏目和顶部恢复原宽度；
- 手动关闭后，该会话不会再次自动打开；切到别的会话仍会正常出现。

## 下载

- [完整发布包（含 `dsh-better-sidebar`、安装脚本、文章与截图）](dist/dsh-ai-mind-0.1.4-fnos-release.zip) · 6.7 MB
- [纯插件包](dist/dsh-ai-mind-0.1.4.tgz) · 24.4 KB

SHA256：

```text
d20432953c40d029114bfa892a41c008337b3f1cb5a093f37312d1d185c0b467  dsh-ai-mind-0.1.4-fnos-release.zip
0acaf43c6b4e5d6e1a255e8ba27d0935691c7acae8e888632ecbce16654e99f2  dsh-ai-mind-0.1.4.tgz
```

## 安装

前置：DSH `0.2.0-rc.2` 左右版本。插件通过 `dsh-better-sidebar` 的公开 `registerTab` API 注册右侧页签，因此两者都要安装。

**推荐：使用发布包（已附带依赖）**

解压发布 zip 后执行：

```bash
./install.sh web
```

`install.sh` 会先安装随包附带的 `dsh-better-sidebar-0.26.0.tgz`，再安装 `dsh-ai-mind-0.1.4.tgz`。完成后重启 `dsh web`。

**手动安装**

```bash
dsh plugin --profile web add ./vendor/dsh-better-sidebar-0.26.0.tgz
dsh plugin --profile web add ./dsh-ai-mind-0.1.4.tgz
```

> `dsh-better-sidebar` 的传递依赖由 pnpm 从 npm 源补齐，因此首次安装需要联网。若目标机器无法联网，请先把依赖装好，或把完整 `node_modules` 一并同步。

安装后重启 `dsh web`。插件会：

1. 通过 `dsh.bundle.patch` 挂载宿主占位；
2. 由 `dsh.client` 加载浏览器半边；
3. 用 `ctx.betterSidebar.registerTab` 注册右侧栏页签 `AI 心流`；
4. 在当前会话首次挂载时自动打开；手动关闭后不会再次抢焦点。

也可以从右侧栏的 `+` 菜单里随时打开。

> 若 `dsh plugin add` 被 pnpm 的 `minimumReleaseAge` 策略拦住（本机出现过 `billion-context` 触发），可直接把本包加入 profile 的 `dependencies` 与 `dsh.profile.bundles`，再运行 `dsh --profile web --dump-config` 重新生成 `cordis.yml`。

## 打包分发

```bash
npm pack                 # 生成 dsh-ai-mind-0.1.4.tgz，prepack 会自动重建 lib/client.js
```

发布包（zip）还包含 `dsh-better-sidebar` 安装包、`install.sh`、文章和截图。包内只含 `lib/`、`cordis.patch.yml`、`README.md`、`LICENSE` 和 `package.json`；`src/`、测试不进入 npm 分发包。

## 开发

```bash
npm run build    # src/model.cjs + src/styles.css + src/client.js → lib/client.js
npm test         # 纯模型测试（node:test）
```

- `src/model.cjs`：纯函数折叠会话事件，无 React / 浏览器依赖。
- `src/client.js`：右侧栏 React 页，直接使用平台提供的 `react`。
- `src/styles.css`：全部样式以 `.aim-root` 作用域隔离，深色玻璃拟态 + 微动效。
- `lib/client.js`：构建产物，DSH 通过 `/plugins/dsh-ai-mind/client.js` 提供。

## 兼容性

- DSH `0.2.0-rc.2`
- `dsh-better-sidebar >= 0.26.0`（使用其公开的 `registerTab` API）
- 浏览器需支持 `color-mix()`；不支持时仅降低部分半透明层次，不影响功能。
