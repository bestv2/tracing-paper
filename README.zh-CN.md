# 描图纸 · Tracing Paper

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-orange.svg)](public/manifest.json)
[![Chromium 110+](https://img.shields.io/badge/chromium-110%2B-green.svg)](public/manifest.json)
[![Firefox 115+](https://img.shields.io/badge/firefox-115%2B-ff7139.svg)](scripts/manifest.mjs)

[English](README.md)

**把设计稿像描图纸一样覆盖在网页上：拖动、缩放、混合模式肉眼比对，再来一次像素级差异分析，最后导出一份 AI 与 CI 都能直接读的报告。**

多数覆盖工具止步于"半透明 PNG 贴上去了，你自己看"。描图纸把这一步走完：视觉走查的结论变成结构化数据——用 ΔE2000 与 SSIM 度量像素、把差异归类、归因到具体 DOM 元素，并输出 JSON / Markdown / SARIF。浏览器扩展与零依赖 Node CLI 跑的是同一套比对管线，设计师、智能体和 CI 看到的是同一组数字。

同一份代码运行在 Chrome / Edge 110+ 与 Firefox 115+ 上，比对引擎同时供无头 CLI 使用。

```
设计稿 ───────┐
              ├─▶ 覆盖走查 ─▶ 截图 ─▶ 对齐 ─▶ ΔE / SSIM 网格 ─▶ 归因分类 ─▶ report.json / .md / .sarif
线上页面 ─────┘
```

---

## 目录

- [界面预览](#界面预览)
- [功能特性](#功能特性)
- [安装扩展](#安装扩展)
- [快速上手](#快速上手)
- [快捷键](#快捷键)
- [命令行](#命令行)
- [报告格式](#报告格式)
- [工作原理](#工作原理)
- [目录结构](#目录结构)
- [本地开发](#本地开发)
- [隐私与权限](#隐私与权限)
- [已知限制](#已知限制)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 界面预览

| 叠加 · 55% 透明度 | 图层管理 |
| --- | --- |
| ![设计稿叠在线上页面上](docs/screenshots/overlay.png)<br><sub>任意设计稿叠到任意页面：拖动、缩放、吸附、混合，这里是自动对齐后的结果。</sub> | ![图层面板：透明度、混合模式、显隐与锁定](docs/screenshots/layers.png)<br><sub>逐层调整透明度、混合模式、锁定、显隐与层级。</sub> |

![像素比对：页面上的差异标记与右侧报告面板](docs/screenshots/diff.png)

<sub>比对：页面上的差异区域、带 ΔE / SSIM 的差异条目、匹配到的 DOM 选择器与修改建议。</sub>

<p align="center">
  <img src="docs/screenshots/popup.png" width="280" alt="弹窗：当前场景、素材库与按 URL 恢复">
</p>

<p align="center"><sub>弹窗：当前场景、素材库与按 URL 恢复。截图取自 `.e2e/site` 演示页，界面语言跟随浏览器。</sub></p>

## 功能特性

### 覆盖与走查

- **多图层** — 设计稿可以叠多张，每张独立的位置、尺寸、透明度、混合模式、显隐与锁定状态。
- **16 种混合模式** — 正常、差值、正片叠底、滤色、叠加、变暗、变亮、颜色减淡、颜色加深、强光、柔光、排除、色相、饱和度、颜色、亮度。
- **吸附参考线** — 图层之间、图层与视口自动吸附，`S` 键开关。
- **冻结** — 按 `F` 让所有图层穿透点击：设计稿留着，页面照常操作。
- **撤销重做、复制、隐藏、锁定、调层级** — 另有闪烁对比：图层两次快闪，肉眼一眼看出错位。
- **素材库** — 上传过的图片存在 `chrome.storage.local`（默认保留 24 张），可在弹窗里再次插入。
- **按页面保存场景** — 图层几何自动落盘，回到同一页面自动还原（最多记忆 12 个页面）。
- **Shadow DOM 隔离** — 界面挂在 `<tracing-paper-root>` 自定义元素里，页面样式打不进来，工具栏样式也漏不出去。

### 自动对齐

按 `A`（或点魔棒按钮），描图纸会自己在页面里找设计稿的位置：抓当前视口 → 两边转成模糊亮度场 → 按梯度加权在设计稿上取样 → 扫描可能的缩放 → 三级搜索位移（整页粗搜 → 局部中搜 → 像素级）。打分用 ZNCC，对整体色偏与亮度差不敏感。两个候选分数接近时，优先"1:1 / 铺满宽度"这类常见落法。它还会换几个滚动位置重试，避免被吸顶头部骗走。

### 差异引擎

- 全局对齐 — 8/2/1 金字塔位移搜索，只有残差确实下降时才采纳位移。
- 一次 ΔE2000 场 — 网格判定、区域统计、差异图共用同一份度量，报告不会自相矛盾。
- 网格 + 局部 SSIM — 默认 16px 网格，8 连通聚合成区域，再做像素级精修。
- 忽略区域 — 时钟、轮播、广告位：`x,y,w,h[:原因]`。
- 差异分类 — `位移` / `颜色` / `尺寸` / `缺失` / `多余` / `内容`，各自带严重度（`严重` / `主要` / `次要` / `提示`）、度量值，能推断时还给出 CSS 修改建议。
- **切片** — 每个差异区域导出「设计稿 / 页面 / 差异」三张 PNG，扩展内最多保留 8 组。

### 基准自检

出报告之前先确认"图层是否真的压在页面内容上"。用与自动对齐相同的算法算出匹配度（ZNCC）与峰值裕度，给出结论：

- `ok` — 落点可信，数字可以当真；
- `drift` — 页面内容偏移超过 2px 或倍率差超过 1%，报告里附建议落点，一键重新对齐并复比；
- `weak` — 没有可信匹配，本次差异只能作参考。

![基准自检报出 drift、建议落点，并可一键对齐重比](docs/screenshots/baseline-drift.png)

### 报告

差异面板可直接导出 **JSON**、**Markdown**、**SARIF**、**PNG**，或把 JSON 复制到剪贴板；勾选任意差异块可单独复制、复制所选，或只导出勾选子集，编号与完整报告保持一致。每份产物字段稳定、可 diff。

![单个差异展开为「设计 / 页面 / 差异」三张切片，底部是导出操作](docs/screenshots/report-finding.png)

### 命令行

`dist-cli/tracing-diff.mjs` 是单文件 Node ESM 程序，**零依赖**（PNG 编解码直接建在 `node:zlib` 上）。输入两张 PNG 与可选元数据，产出与扩展完全同构的报告——适合 CI、回归脚本，或开不了浏览器的智能体。

## 安装扩展

环境要求：Chrome / Edge 110+ 或 Firefox 115+，构建需要 Node.js 18+。

```bash
git clone https://github.com/bestv2/tracing-paper.git
cd tracing-paper
npm install
npm run build
```

构建产出：

| 产物 | 说明 |
| --- | --- |
| `dist/` | Chrome / Edge 可直接加载的扩展目录（`manifest.json`、`popup.html`、`background.js`、`content.js`、`overlay.js`） |
| `dist-firefox/` | Firefox 扩展目录（事件页代替 service worker） |
| `dist-cli/tracing-diff.mjs` | 独立的差异比对 CLI |

只构建一个浏览器：`npm run build:chrome` 或 `npm run build:firefox`。

**Chrome / Edge**

1. 打开 `chrome://extensions`；
2. 打开右上角 **开发者模式**；
3. 点 **加载已解压的扩展程序**，选择 `dist/` 目录；
4. 把扩展固定到工具栏——当前页走查开启时，扩展角标显示 `ON`。

**Firefox**

1. 打开 `about:debugging#/runtime/this-firefox`；
2. 点 **临时载入附加组件**，选择 `dist-firefox/manifest.json`；要长期安装，先 `npm run release` 打包再上传 AMO；
3. 打开弹窗点 **开启**——Firefox 把站点访问当作可选授权，首次需要在弹窗里允许。

> `npm run dev` 会同时监听 Chrome/Edge 与 Firefox 的构建；重建后仍需重新加载扩展并刷新页面。

## 快速上手

1. 打开任意 `http(s)` 页面，点工具栏图标或按 `Alt`+`Shift`+`V`（Firefox 首次会请求站点访问权限，允许即可）；
2. 添加设计稿：弹窗上传、拖图片到页面上，或 `⌘/Ctrl`+`V` 粘贴；
3. 摆位置：拖动移动、`Alt`+滚轮缩放、`Alt`+`4` 铺满视口宽度，或按 `A` 自动对齐到页面内容；
4. 按 `D` 比对。差异会以标记画在页面上，面板列出严重度、区域、ΔE、SSIM、匹配到的 DOM 选择器与修改建议；
5. 导出 `report.json`、`report.md`、`report.sarif` 或差异图。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Alt`+`Shift`+`V` | 打开 / 收起工具栏（浏览器级快捷键） |
| `⌘/Ctrl`+`V` | 粘贴剪贴板里的图片 |
| 拖拽文件 | 把图片文件拖到页面上 |
| 方向键 / `Shift`+方向键 | 选中图层移动 1px / 10px |
| `[` `]` | 透明度 −/+ 5% |
| `0`–`9` | `0` 为 100%，`1`–`9` 为 10%–90%（连按两位数可精确设置） |
| `H` / `L` | 隐藏/显示 · 锁定/解锁选中图层 |
| `F` | 冻结 / 解冻全部图层 |
| `S` | 吸附参考线开关 |
| `D` | 跑一次像素比对 |
| `A` | 自动对齐选中图层 |
| `⌘/Ctrl`+`Z` / `⇧`+`⌘/Ctrl`+`Z` | 撤销 / 重做 |
| `⌘/Ctrl`+`D` | 复制选中图层 |
| `Delete` / `Backspace` | 删除选中图层 |
| `Alt`+`1` / `2` / `3` | 原始尺寸 / 2 倍 / 0.5 倍 |
| `Alt`+`4` | 铺满视口宽度 |
| `Alt`+`5` | 视口居中 |
| `Alt`+`0` | 重置 |
| `Alt`+滚轮 | 以图层中心缩放 |
| `Esc` | 先关面板，再取消选中 |
| `Shift`+`F` | 收起 / 展开工具栏 |
| `?` | 快捷键一览 |

## 命令行

构建一次，之后用 Node 直接跑生成的文件——不需要安装、没有运行时依赖：

```bash
npm run build          # 或只跑：npm run build:cli

node dist-cli/tracing-diff.mjs \
  --expected design/home@2x.png \
  --actual shots/home.png \
  --out .tracing-report \
  --stdout md
```

`npm run diff -- <参数>` 是上面这条命令的简写。

### 参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--expected <file.png>` | 必填 | 设计稿 |
| `--actual <file.png>` | 必填 | 页面截图（同尺寸效果最好） |
| `--out <dir>` | `.tracing-report` | 产物目录 |
| `--format <list>` | `json,md,sarif,png,crops` | 逗号分隔的输出格式 |
| `--tile <n>` | `16` | 网格边长（px） |
| `--delta-e <n>` | `2.3` | ΔE2000 阈值（JND ≈ 2.3） |
| `--ssim <n>` | `0.98` | 结构相似度下限 |
| `--pixel <n>` | `6` | 像素级色差阈值 |
| `--min-area <n>` | `96` | 小于该面积（px²）的区域丢弃 |
| `--shift-search <n>` | `4` | 局部位移搜索半径 |
| `--max-findings <n>` | `120` | 最多输出条数 |
| `--mask <x,y,w,h[:原因]>` | — | 忽略区域，可重复 |
| `--align <auto\|off\|dx,dy>` | `auto` | 全局对齐；auto 只在位移确实压低残差时采用 |
| `--scale <n>` | `1` | 设计稿渲染缩放 |
| `--url <url>` | — | 报告里记录的页面地址 |
| `--figma <file.json>` | — | Figma 节点导出（REST / 插件均可），用于语义层 |
| `--dom <file.json>` | — | 页面布局导出，用于语义层 |
| `--baseline <report.json>` | — | 与上一次报告对比，输出 unified diff |
| `--stdout <json\|sarif\|md\|diff>` | — | 只把小体积结果打到标准输出 |
| `--exit-code` | 关闭 | 有差异时退出码为 `1` |
| `--quiet` | 关闭 | 不打印摘要 |
| `--help` | — | 显示帮助 |

退出码：`0` 正常；带 `--exit-code` 且有差异时 `1`；参数或读写失败 `2`。

### 产物

```
.tracing-report/
├── report.json     # 机器可读契约（schemaVersion: tracing.diff/2）
├── report.md       # 带差异表格的摘要，可直接贴进对话
├── report.sarif    # SARIF 2.1.0，ruleId = vi/<kind>
├── report.diff     # 仅 --baseline：差异条目的 unified diff（+ 新增，- 已修复）
├── layout.diff     # 仅 --figma + --dom：语义层 unified diff
├── diff.png        # 高亮后的差异图
└── crops/
    ├── c1.expected.png
    ├── c1.actual.png
    └── c1.diff.png
```

### 接入 CI

```yaml
name: visual-check
on: [pull_request]

jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci && npm run build:cli
      - name: 先给应用截图，再比对
        run: |
          node dist-cli/tracing-diff.mjs \
            --expected design/home.png \
            --actual shots/home.png \
            --out .tracing-report \
            --exit-code
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: tracing-report
          path: .tracing-report

      # 可选：把差异显示到 Code scanning 面板
      # 私有仓库需要 GitHub Advanced Security
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: .tracing-report/report.sarif
```

### 配合 AI 智能体

报告刻意做得"无聊但好解析"，这正是智能体需要的：

```
读取 .tracing-report/report.json，按顺序修复 severity 为 "blocker" 和 "major" 的差异，
然后重新跑一次 CLI，直到 summary.verdict 变成 "clean" 为止。
```

`--stdout md` 让输出小到可以直接塞进模型上下文，`--baseline` 则把"这次比上次变了什么"变成一份普通 unified diff。

## 报告格式

数据契约在 [`src/shared/diff/types.ts`](src/shared/diff/types.ts)，破坏性字段改动必须升 `schemaVersion`。精简示例：

```json
{
  "schemaVersion": "tracing.diff/2",
  "generatedAt": "2026-10-26T09:12:44.512Z",
  "tool": { "name": "tracing-paper", "version": "1.0.0", "mode": "cli" },
  "inputs": {
    "expected": { "name": "home@2x.png", "width": 750, "height": 1624 },
    "actual": { "name": "home.png", "width": 1440, "height": 900, "url": "https://example.com/" },
    "alignment": { "scale": 1, "dx": 0, "dy": 2, "method": "auto" }
  },
  "policy": {
    "tile": 16, "deltaE": 2.3, "ssim": 0.98, "pixel": 6,
    "minArea": 96, "shiftSearch": 4, "maxFindings": 120, "masks": []
  },
  "summary": {
    "verdict": "changed",
    "findings": 3,
    "changedRatio": 0.012,
    "maxDeltaE": 18.4,
    "tiles": 5040,
    "changedTiles": 61,
    "byKind": { "color": 2, "shift": 1 },
    "bySeverity": { "major": 1, "minor": 2 }
  },
  "findings": [
    {
      "id": "f-0001",
      "kind": "color",
      "severity": "major",
      "box": { "x": 24, "y": 512, "w": 96, "h": 48 },
      "metrics": { "deltaE": 18.4, "ssim": 0.99, "pixelRatio": 0.31, "edgeDelta": 0.02 },
      "expected": { "hex": "#1a73e8" },
      "actual": { "hex": "#2b7de9" },
      "element": { "selector": "button.primary", "tag": "button" },
      "suggestion": { "property": "color", "from": "#2b7de9", "to": "#1a73e8", "confidence": "low" }
    }
  ],
  "artifacts": {
    "diffImage": "diff.png",
    "report": "report.json",
    "markdown": "report.md",
    "sarif": "report.sarif"
  },
  "notes": []
}
```

几点约定：

- `box` 使用**设计图像素坐标**，不是页面坐标；
- `summary.verdict` 只有 `clean` / `changed`，`byKind` / `bySeverity` 是便于统计的计数；
- `baseline`（仅扩展侧）携带基准自检：`score`、`margin`、`verdict`、`drift`、`scaleRatio`、`suggested`；
- `semantic`（仅 CLI，需 `--figma` 与 `--dom`）按 IoU 匹配后列出逐节点属性差异；
- SARIF 会把严重度映射为 `error` / `warning` / `note`，带稳定 `partialFingerprints`，并把 DOM 选择器作为逻辑位置。

## 工作原理

1. **截图** — 扩展先隐藏自己的宿主节点，通过 background 调 `captureVisibleTab`，再按实测 DPR 把截图换算回 CSS 像素。
2. **对齐** — 三级金字塔估一个整数 `(dx, dy)`；只有残差明显下降才采纳，渲染正确时不会被无端平移。
3. **度量** — 全图只算一次 ΔE2000 场；网格在此基础上统计均值、局部 SSIM、方差与边缘能量。
4. **聚合** — 变化网格按 8 连通合并成区域，像素级精修，按 `minArea` 过滤，剔除掩膜区域。
5. **分类** — 边缘能量与位移增益决定这是 `位移`、`颜色`、`尺寸`、`缺失`、`多余` 还是 `内容`；严重度由面积、ΔE 与类型共同决定。
6. **归因与产出** — 每个差异框映射回 DOM 元素（选择器、标签、计算后的颜色），随切片一起序列化成 JSON / Markdown / SARIF。

自动对齐与基准自检共用 `src/shared/diff/placement.ts` 里的纯函数定位算法，因此 CLI 与回归脚本无需浏览器也能调用。

## 目录结构

```
src/
├── background/        # 后台（service worker / 事件页）：角标、按需注入、captureVisibleTab
├── bootstrap/         # 极小的常驻内容脚本：状态查询 + 场景恢复
├── content/           # 覆盖层 UI（React + Zustand）、导入、比对编排
│   ├── components/    # 工具栏、面板、气泡、差异标记、提示层
│   ├── hooks/         # 快捷键、文件/剪贴板输入
│   └── lib/           # 动作、自动对齐、比对流程、DOM 归因、持久化
├── popup/             # 弹窗 UI：开关、上传、素材库、设置
├── shared/
│   ├── diff/          # 比对引擎（纯逻辑，浏览器与 Node 共用）
│   │   ├── align.ts       # 金字塔位移搜索
│   │   ├── metrics.ts     # ΔE2000 场、网格与区域统计
│   │   ├── compare.ts     # 网格 → 区域 → 差异条目
│   │   ├── placement.ts   # ZNCC 自动定位
│   │   ├── semantic.ts    # Figma 节点 vs DOM 元素
│   │   ├── report.ts      # JSON / Markdown / SARIF / 基线对比
│   │   └── node/png.ts    # 基于 node:zlib 的 PNG 编解码
│   ├── hostaccess.ts  # Firefox 可选站点授权流程
│   ├── i18n/          # 中英文文案
│   └── storage.ts     # chrome.storage.local 数据模型
└── cli/index.ts       # 零依赖 CLI 入口
```

```
scripts/
├── build-ext.mjs      # 多浏览器构建驱动（Chrome/Edge + Firefox）
├── manifest.mjs       # 按浏览器改写 public/manifest.json
├── package.mjs        # 商店安装包 zip + SHA256SUMS
└── store-assets.mjs   # 商店截图与宣传图
```

五份 Vite 配置分别描述 popup、background、overlay、bootstrap 与 CLI；`scripts/build-ext.mjs` 把它们驱动两遍，以满足 MV3 的不同产物形态：Chromium 用 ESM service worker、Firefox 用 classic 事件页，另有 IIFE 内容脚本、IIFE 覆盖层包与 Node ESM CLI。

## 本地开发

```bash
npm install
npm run dev          # 同时监听 Chrome/Edge 与 Firefox 构建
npm run typecheck    # tsc --noEmit
npm run build        # 类型检查 + 两端构建 + CLI
npm run build:chrome # 只构建 Chrome / Edge
npm run build:firefox # 只构建 Firefox
npm run build:cli    # 只产出 dist-cli/tracing-diff.mjs
npm run release      # 打包安装包与 SHA256SUMS 到 release/
npm run store:assets # 生成商店截图与宣传图到 store/
npm run clean        # 删除 dist/、dist-firefox/、release/
```

提交补丁前值得知道的几条约定：

- `src/shared/**` 必须与浏览器无关：不碰 DOM、不用 `chrome.*`，CLI 才能复用引擎；
- 浏览器差异放进小而克制的辅助函数（参考 `src/shared/hostaccess.ts`），不要把分支撒进 UI；
- CLI 不得引入 npm 依赖，PNG 读写走 `src/shared/diff/node/png.ts`；
- 报告结构是公开契约：加字段随意，改名或删字段必须升 `schemaVersion`；
- 界面文案写进 `src/shared/i18n/{zh,en}.ts`，不要内联；
- 目前 `package.json` 里还没有自动化测试脚本；`.e2e/` 是本地手动回归用的 Playwright 脚本。

## 隐私与权限

全部在本地完成。扩展**不发起任何网络请求**，没有埋点，也不上传设计稿或截图——它们保存在 `chrome.storage.local`，直到你手动删除，或素材库超出上限被自动清理。

| 权限 | 用途 |
| --- | --- |
| `storage`、`unlimitedStorage` | 在本机保存素材库与按 URL 记录的图层场景 |
| `activeTab`、`scripting` | 只在你主动操作的标签页注入覆盖层 |
| `host_permissions: <all_urls>` | 覆盖层需要在你走查的任意页面上运行；只有你触发时才会挂载 |
| `captureVisibleTab`（由 background 调用） | 像素比对必须截图，内容脚本本身没有截图能力 |

Firefox 把 `host_permissions` 当作**可选授权**：用户未授予站点访问权限前，内容脚本不会注入、也无法截图。Firefox 的 manifest 另外声明了 `data_collection_permissions: none`。

## 已知限制

- 支持 Chrome / Edge 110+ 与 Firefox 115+；Firefox 首次比对前需授予站点访问权限。
- 比对基于**视口截图**：图层需要基本完整可见，被裁切时报告会写明。
- 页面 CSP 严格时会降级为 canvas 渲染设计稿，超大图可能更吃内存。
- 图层只有轴对齐矩形，不支持旋转与透视。
- 语义层需要同时提供 Figma JSON 与 DOM 布局 JSON，且仅在 CLI 中可用。
- 设计稿与页面倍率差很大时仍可比对，但报告会记录倍率，并提示结论仅供参考。

## 参与贡献

欢迎提 issue 与 PR。提交前请跑一遍 `npm run typecheck`，保持共享引擎不依赖 DOM/chrome API，并守住报告契约（确需破坏性改动就显式升 `schemaVersion`）。较大的改动建议先开 issue 对齐方向。

## 许可证

[MIT](LICENSE) © 2026 wind.wang
