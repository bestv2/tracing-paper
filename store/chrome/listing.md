# Chrome Web Store 提交信息

> 上传包：`release/tracing-paper-1.0.0-chrome.zip`
> 字段上限按 2026 年后台：名称 75 字符、简短说明 132 字符、详细说明 16000 字符。
> 隐私政策由仓库 `docs/index.html` 发布到 GitHub Pages（Settings → Pages → main /docs），
> 地址 `https://bestv2.github.io/tracing-paper/`；改了隐私政策记得同步 `store/privacy-policy.html` 后重新复制。

## 基本信息

| 字段 | 填写内容 |
| --- | --- |
| 名称（中文） | 描图纸 Tracing Paper |
| 名称（English） | Tracing Paper |
| 简短说明（中文） | 设计稿描在网页上做视觉走查：多图层、透明度与混合模式对比、像素级差异定位，报告可导出给 AI / CI。 |
| 简短说明（English） | Overlay design mockups on any page for visual QA: layers, blend modes, pixel diff, and reports you can hand to AI or CI. |
| 类别 | 开发者工具（Developer Tools） |
| 语言 | 中文（简体）、English (United States) |
| 商店图标 | `store/assets/icons/128.png` |
| 截图（1280×800） | `store/assets/screenshots/01-overlay.png`<br>`02-layers.png`<br>`03-diff.png`<br>`04-popup.png` |
| 小型宣传图 440×280 | `store/assets/promo/promo-440x280.png` |
| 顶部大图 1400×560（可选） | `store/assets/promo/marquee-1400x560.png` |
| 主页网址 | https://github.com/bestv2/tracing-paper |
| 支持网址 | https://github.com/bestv2/tracing-paper/issues |
| 隐私权政策网址 | https://bestv2.github.io/tracing-paper/ |
| 开发者 | wind.wang |

## 详细说明（中文）

把设计稿像描图纸一样盖在网页上：拖动、缩放、对齐，一边看一边改；差在哪里，交给像素比对说清楚。

**它能做什么**

- 多图层叠加：一次插入多张设计稿，分别控制显隐、锁定、层级、复制与删除
- 精确对位：拖动移动、8 向缩放、滚轮等比缩放、键盘方向键 1px / Shift 10px 微调
- 自动对齐：点一下让设计稿按页面内容自动缩放定位，不用手追像素
- 对比工具：透明度滑杆、16 种混合模式（差值最适合找像素差）、闪烁对比、吸附对齐
- 像素比对：截取当前视口，裁到设计稿区域逐像素比对，输出差异区域、命中元素、颜色 ΔE、SSIM、超阈比例与修改建议
- 基准自检：先判断「设计稿到底有没有对齐页面」，避免把错位读成差异，可一键对齐并重比
- 报告导出：JSON / Markdown / SARIF / 差异图 PNG，一键复制 `report.json`，可直接喂给 AI 或接进 CI
- 素材库：上传过的设计稿留在本地，下次一键复用；按 URL 记住位置、尺寸、透明度与图层，刷新自动恢复
- 中文 / English 界面，浅色 / 深色主题

**快捷键**

| 操作 | 快捷键 |
| --- | --- |
| 开关工具 | `Alt + Shift + V` |
| 截图比对当前视口 | `D` |
| 自动对齐页面 | `A` |
| 透明度 −5% / +5% | `[` / `]` |
| 直接设定透明度 | 连按两位数字，例如 `55` |
| 显示/隐藏、锁定、复制、删除图层 | `H` / `L` / `⌘D` / `Delete` |
| 吸附对齐、冻结画布 | `S` / `F` |
| 撤销 / 重做 | `⌘Z` / `⇧⌘Z` |
| 全部快捷键 | `?` |

**适合谁**

前端与设计走查、还原度验收、回归对比、多端适配核对；需要把结论交给 AI 或自动化流程的团队。

**说明**

- 工具只在 http / https 页面可用，`chrome://`、扩展商店等特权页面无法注入
- 设计稿、截图与报告全部留在本机浏览器存储内，不上传、不统计
- 想接 CI 可用同仓库的 CLI：`node dist-cli/tracing-diff.mjs`

## Detailed description (English)

Lay a design mockup over any live page, the way tracing paper works: drag, resize, snap, and keep fixing while you compare. Then let a pixel-level diff say exactly what is off.

**What it does**

- Multiple layers: insert several mockups at once, toggle visibility, lock, reorder, duplicate, delete
- Precise placement: drag to move, 8-way resize, wheel to scale proportionally, arrow keys for 1 px (Shift for 10 px)
- Auto-align: one click scales and positions the mockup against the page content
- Compare tools: opacity slider, 16 blend modes (difference is best for pixel hunting), blink comparison, snapping guides
- Pixel diff: capture the current viewport, crop to the mockup area, compare pixel by pixel, and report regions, matched elements, colour ΔE, SSIM, over-threshold ratio and suggestions
- Baseline check: tells you whether the mockup is actually aligned before you trust the numbers, with one-click re-align and re-run
- Reports: JSON / Markdown / SARIF / diff PNG, plus copy `report.json` straight to your AI assistant or CI job
- Library: inserted mockups stay in local storage for reuse; position, size, opacity and layers are remembered per URL and restored after reload
- Chinese / English UI, light / dark theme

**Notes**

- Works on http / https pages only; privileged pages such as `chrome://` cannot be injected
- Mockups, screenshots and reports never leave your device — no uploads, no analytics
- A CLI in the same repository (`dist-cli/tracing-diff.mjs`) is available for CI pipelines

## 隐私权规范（Privacy practices 标签页）

| 问题 | 选择 |
| --- | --- |
| 单一用途说明 | 在网页上叠加设计稿，并对页面与设计稿做像素级视觉走查与差异报告。 |
| 是否使用远程代码 | 否（所有代码都在安装包内） |
| 是否收集或使用用户数据 | 否 |
| 权限理由 | 见本目录 `../permissions.md`，逐条粘贴即可 |
| 数据使用合规声明 | 三项承诺全部勾选（不出售、不用于无关用途、不用于判断信用） |

## 审核员备注（可选，建议填写）

测试路径：

1. 打开任意 http/https 页面（例如 `https://example.com`）
2. 点击工具栏图标 → 点「开启」
3. 点「插入设计稿」选择任意 PNG/JPG（或直接把图片拖进页面）
4. 拖动设计稿到页面上方，可拖透明度滑杆
5. 点工具栏「比对」（或按 `D`），几秒后右侧出现差异报告，可导出 JSON / Markdown / SARIF

该扩展不需要登录、不联网请求任何第三方接口；想验证「不上传数据」可在 DevTools Network 面板观察，除页面自身请求外无新增请求。
