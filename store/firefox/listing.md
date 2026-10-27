# Firefox AMO 提交信息

> 上传包：`release/tracing-paper-3.0.0-firefox.zip`
> 该包与 Chromium 版同源，manifest 已按 Firefox MV3 适配：`background.scripts` 事件页 +
> `browser_specific_settings.gecko`（含 `id`、`strict_min_version: 115.0`、`data_collection_permissions`）。

## 基本信息

| 字段 | 填写内容 |
| --- | --- |
| 名称 | 描图纸 Tracing Paper |
| 摘要 / Summary（≤250 字符） | 把设计稿描在网页上做视觉走查：多图层叠加、透明度与混合模式对比、像素级差异定位，差异报告可导出 JSON / Markdown / SARIF，直接交给 AI 或 CI。 |
| 类别 | Development（开发工具） |
| 标签 | design, ui, qa, pixel, diff, overlay |
| 默认语言 | 中文（简体），并提供 English |
| 图标 128×128 | `store/assets/icons/128.png` |
| 截图 1280×800 | `store/assets/screenshots/01-overlay.png`、`02-layers.png`、`03-diff.png`、`04-popup.png` |
| 支持网站 | https://github.com/bestv2/tracing-paper |
| 支持邮箱 | bestv2@163.com |
| 隐私政策 | https://bestv2.github.io/tracing-paper/ |
| 许可证 | MIT |
| 源码地址（可选） | https://github.com/bestv2/tracing-paper |
| 扩展 ID（已写入 manifest） | `tracing-paper@wangduo.dev` |
| 数据收集声明 | 无（`data_collection_permissions.required = ["none"]`） |

> 扩展 ID 首次发布后不可更改；如需换成自己的域名邮箱，请在**第一次提交前**改 `scripts/manifest.mjs`
> 里的 `GECKO_ID`，再重新 `npm run release`。

## 描述（中文，AMO 描述支持 Markdown）

把设计稿像描图纸一样盖在网页上：拖动、缩放、对齐，一边看一边改；差在哪里，交给像素比对说清楚。

### 核心能力

- **多图层叠加**：显隐、锁定、层级、复制、删除，一页对照多张设计稿
- **精确对位**：拖动移动、8 向缩放、滚轮等比缩放、方向键 1px / Shift 10px 微调
- **自动对齐**：按页面内容自动缩放定位，省掉手追像素
- **对比工具**：透明度、16 种混合模式（差值最适合找像素差）、闪烁对比、吸附对齐
- **像素比对**：截当前视口 → 裁到设计稿区域 → 逐像素比对，输出差异区域、命中元素、颜色 ΔE、SSIM、超阈比例与修改建议
- **基准自检**：先判断设计稿是否真的对齐页面，避免把错位读成差异；可一键对齐并重比
- **报告导出**：JSON / Markdown / SARIF / 差异图 PNG，一键复制 `report.json`，可直接交给 AI 或接进 CI
- **素材库与场景记忆**：设计稿存本地，按 URL 恢复图层、位置、尺寸、透明度
- 中文 / English 界面，浅色 / 深色主题

### 快捷键

`Alt + Shift + V` 开关工具 · `D` 比对 · `A` 自动对齐 · `[` `]` 调透明度 · `?` 查看全部

### 首次使用说明

Firefox 的 Manifest V3 把「访问网站」当作可选授权：安装后第一次点工具栏图标并点「开启」时，
浏览器会弹出授权请求，允许后工具才能注入页面。若拒绝，弹窗会给出提示，再次点击可重新授权。

### 隐私

设计稿、截图与比对报告全部保存在本机浏览器存储中：不联网、不上传、不埋点、无账号体系。

## Description (English)

Lay a design mockup over any live page, the way tracing paper works: drag, resize, snap, and keep fixing while you compare. Then let a pixel-level diff say exactly what is off.

- Multi-layer mockups with visibility, lock, order, duplicate and delete
- Precise placement: drag, 8-way resize, wheel scaling, 1 px / 10 px keyboard nudges
- Auto-align against page content, 16 blend modes, blink comparison, snapping guides
- Pixel diff with difference regions, matched elements, colour ΔE, SSIM, over-threshold ratio and suggestions
- Baseline check so you do not misread a misaligned mockup as a defect
- Export JSON / Markdown / SARIF / diff PNG, or copy `report.json` for AI and CI
- Local library, per-URL scene restore, light / dark theme, Chinese / English UI

Firefox MV3 treats site access as optional: the first time you click Enable, Firefox asks for permission
before the tool can be injected.

Everything stays on your device — no uploads, no analytics, no account.

## Notes to reviewer（审核员备注）

**What this add-on does**: overlays a design mockup on the current page and produces a pixel-level
visual diff report. It is a design-QA tool; it never modifies the page, network requests, or the user's data.

**How to test**

1. Open any http/https page.
2. Click the toolbar icon → click “开启” (Enable). On Firefox this triggers the optional site-access prompt.
3. Click “插入设计稿” (Insert design) and pick any PNG/JPG, or drag an image file into the page.
4. Drag / resize the overlay; move the opacity slider.
5. Click the diff button in the toolbar (or press `D`). A report panel appears; export JSON / Markdown / SARIF.

**Implementation notes**

- `manifest_version: 3`; `background` uses `scripts` (event page) because Firefox does not support
  `background.service_worker`; the bundle is a classic IIFE, no ESM in the background context.
- `content.js` is a tiny bootstrap (< 1 KB) registered for http/https; it only answers state queries and
  asks the background to inject `overlay.js` after a reload.
- `overlay.js` is injected on demand via `scripting.executeScript` and mounts a Shadow DOM (`tracing-paper-root`),
  so page styles cannot leak in or out.
- `tabs.captureVisibleTab` is used only when the user runs a diff.
- No remote code: every script is bundled. No network requests are made by the extension.
- No data collection: `browser_specific_settings.gecko.data_collection_permissions.required = ["none"]`.

**Permissions**: `storage`, `unlimitedStorage` (local mockup images), `activeTab`, `scripting`,
`host_permissions: <all_urls>` (overlay + diff on any site). See `../permissions.md` for per-permission reasons.

## 版本备注（Release notes，≤ 可留空）

首个公开版本 v3.0.0：多图层走查、自动对齐、像素比对与 JSON / Markdown / SARIF 报告导出。
