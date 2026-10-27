# Microsoft Edge Add-ons 提交信息

> 上传包：`release/tracing-paper-3.0.0-edge.zip`（与 Chrome 同一份 Chromium 产物，无需单独构建）
> 隐私政策 URL 与 Chrome 共用：`https://bestv2.github.io/tracing-paper/`（仓库 `docs/` 发布到 GitHub Pages）。

## 基本信息

| 字段 | 填写内容 |
| --- | --- |
| 扩展名称 | 描图纸 Tracing Paper |
| 简短说明（≤132 字符） | 设计稿描在网页上做视觉走查：多图层、透明度与混合模式对比、像素级差异定位，报告可导出给 AI / CI。 |
| 类别 | 开发人员工具（Developer tools） |
| 语言 | 中文（简体）、English |
| 商店图标 300×300 | `store/assets/icons/300.png` |
| 小图标 128×128 | `store/assets/icons/128.png` |
| 截图 1280×800 | `store/assets/screenshots/01-overlay.png`、`02-layers.png`、`03-diff.png`、`04-popup.png` |
| 搜索词（≤7 个） | 设计走查、视觉还原、像素比对、UI 对比、design QA、pixel diff、overlay |
| 主页 URL | https://github.com/bestv2/tracing-paper |
| 支持联系人 | https://github.com/bestv2/tracing-paper/issues（或 bestv2@163.com） |
| 隐私政策 URL | https://bestv2.github.io/tracing-paper/ |
| 发布者 | wind.wang |

## 详细说明（中文）

把设计稿像描图纸一样盖在网页上：拖动、缩放、对齐，一边看一边改；差在哪里，交给像素比对说清楚。

**核心能力**

- 多图层叠加：显隐、锁定、层级、复制、删除，一份页面同时对照多张设计稿
- 精确对位：拖动移动、8 向缩放、滚轮等比缩放、方向键 1px / Shift 10px 微调
- 自动对齐：按页面内容自动缩放定位设计稿，省掉手追像素
- 对比工具：透明度、16 种混合模式（差值最适合找像素差）、闪烁对比、吸附对齐
- 像素比对：截当前视口 → 裁到设计稿区域 → 逐像素比对，输出差异区域、命中元素、颜色 ΔE、SSIM、超阈比例与修改建议
- 基准自检：先判断设计稿是否真的对齐，避免把错位读成差异
- 报告导出：JSON / Markdown / SARIF / 差异图 PNG，一键复制 `report.json`，可直接交给 AI 或接进 CI
- 素材库与场景记忆：按 URL 恢复图层、位置、尺寸、透明度；刷新不丢
- 中文 / English 界面，浅色 / 深色主题

**快捷键**：`Alt + Shift + V` 开关工具，`D` 比对，`A` 自动对齐，`[` / `]` 调透明度，`?` 看全部。

**说明**

- 仅支持 http / https 页面；`edge://`、扩展商店等特权页面无法注入
- 设计稿、截图与报告全部留在本地，不上传、不统计

## Description (English)

Lay a design mockup over any live page, the way tracing paper works: drag, resize, snap, and keep fixing while you compare. Then let a pixel-level diff say exactly what is off.

- Multi-layer mockups with visibility, lock, order, duplicate, delete
- Precise placement: drag, 8-way resize, wheel scaling, 1 px / 10 px keyboard nudges
- Auto-align against page content, blend modes including difference, blink comparison, snapping
- Pixel diff with regions, matched elements, ΔE, SSIM, over-threshold ratio and suggestions
- Baseline check before you trust the numbers
- Export JSON / Markdown / SARIF / diff PNG, or copy `report.json` for AI and CI
- Local library and per-URL scene restore, light / dark theme, Chinese / English UI

## 审核说明

- 与 Chrome 版同一份代码：`manifest_version: 3`，`background.service_worker`（ESM），`content_scripts` 仅有引导脚本
- `minimum_chrome_version` 为 Chromium 通用字段，Edge 会忽略，不影响安装
- 不申请 `tabs`、`cookies`、`webRequest`、`downloads` 等权限，权限理由见 `../permissions.md`
- 无远程代码、无网络请求、无数据收集；可参考 `../permissions.md` 末节自查

## 测试步骤（供审核）

1. 打开任意 http/https 页面
2. 点工具栏图标 → 「开启」
3. 「插入设计稿」选一张 PNG/JPG（或把图片拖进页面）
4. 拖动 / 缩放设计稿，拖动透明度滑杆
5. 点「比对」或按 `D`，右侧出现差异报告，可导出 JSON / Markdown / SARIF

无需登录，无第三方接口请求。
