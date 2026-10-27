# 描图纸 Tracing Paper · 商店提交材料

本目录是三个商店（Chrome Web Store / Microsoft Edge Add-ons / Firefox AMO）的提交物料与操作说明。
素材与安装包都由脚本生成，不要手改二进制文件。

## 一、要上传的文件

| 文件 | 用途 | 对应商店 |
| --- | --- | --- |
| `release/tracing-paper-3.0.0-chrome.zip` | 扩展安装包 | Chrome Web Store |
| `release/tracing-paper-3.0.0-edge.zip` | 扩展安装包（与 Chrome 同一份 Chromium 产物） | Edge Add-ons |
| `release/tracing-paper-3.0.0-firefox.zip` | 扩展安装包（MV3 事件页） | Firefox AMO |
| `store/assets/icons/128.png` | 商店图标 128×128 | Chrome / Firefox |
| `store/assets/icons/300.png` | 商店 Logo 300×300 | Edge |
| `store/assets/icons/512.png` | 备用大图标 | 全部 |
| `store/assets/screenshots/*.png` | 商店截图 1280×800（4 张） | 全部 |
| `store/assets/promo/promo-440x280.png` | 小型宣传图 | Chrome |
| `store/assets/promo/marquee-1400x560.png` | 顶部大图 | Chrome（可选） |

生成命令：

```bash
npm run release        # 构建 Chrome/Edge + Firefox 产物并打包到 release/
npm run store:assets   # 用真实浏览器跑一遍，产出 1280×800 截图与推广图
npm run store:docs     # 把隐私政策同步到 docs/index.html（GitHub Pages 入口）
```

`release/SHA256SUMS.txt` 是三个 zip 的校验值，上传后如需核对请比对这里。

## 二、提交用的固定信息

三端 listing 与隐私政策里的占位符已全部替换成真实值，可直接粘贴：

| 字段 | 值 |
| --- | --- |
| 开发者 / 发布者 | `wind.wang` |
| 支持邮箱 | `bestv2@163.com` |
| 主页网址 | <https://github.com/bestv2/tracing-paper> |
| 支持 / 反馈 | <https://github.com/bestv2/tracing-paper/issues> |
| 隐私政策网址 | <https://bestv2.github.io/tracing-paper/> |
| 许可证 | MIT |

隐私政策只维护一份真源 `store/privacy-policy.html`（中英双语、自包含、可打印成双语 PDF），
`docs/index.html` 由 `npm run store:docs` 单向复制生成，不要手改；脚本发现未替换的占位符
会直接报错退出，避免把占位符发上商店。

启用 GitHub Pages（只做一次）：仓库 **Settings → Pages → Source: Deploy from a branch → Branch: `main`、目录 `/docs` → Save**，
等 1–2 分钟即可访问 `https://bestv2.github.io/tracing-paper/`。三个商店都填这一个地址。

## 三、三端提交步骤

### Chrome Web Store

1. 打开 <https://chrome.google.com/webstore/devconsole>，支付一次性注册费（如尚未注册）。
2. 「新增项目」→ 上传 `release/tracing-paper-3.0.0-chrome.zip`。
3. 按 `chrome/listing.md` 填写商店信息、图片、隐私权政策网址。
4. 「隐私权规范」页：单一用途说明、权限理由（用 `permissions.md`）、远程代码选「否」、数据使用选「不收集」并勾选三项承诺。
5. 「分发」页：可见性、销售区域（免费）、提交审核。首次审核通常 1–3 个工作日。

### Microsoft Edge Add-ons

1. 打开 <https://partner.microsoft.com/dashboard/microsoftedge>，用开发者账号登录。
2. 「创建新扩展」→ 上传 `release/tracing-paper-3.0.0-edge.zip`（同一个包，Edge 直接接受）。
3. 按 `edge/listing.md` 填写，Logo 用 300×300，截图 1280×800。
4. 提交审核，通常 1–2 个工作日。

Edge 与 Chrome 共用一份代码，**审核要点**：manifest 里 `minimum_chrome_version` 是 Chromium 通用字段，Edge 会忽略；其余无需改动。

### Firefox AMO

1. 打开 <https://addons.mozilla.org/developers/addon/submit/>，选择「On this site」。
2. 上传 `release/tracing-paper-3.0.0-firefox.zip`。
3. 按 `firefox/listing.md` 填写摘要、描述、隐私政策、审核员备注。
4. 选择「不收集数据」以匹配 manifest 里的 `data_collection_permissions: { required: ["none"] }`。
5. 提交后可选「自行分发（不签名）」或让 AMO 签名；签名版可直接装进正式版 Firefox。

Firefox 与 Chromium 的差异（已在构建里处理，无需手工改）：

- `background` 由 `service_worker` 改为 `scripts: ["background.js"]`，且 `background.js` 打成 IIFE（classic 脚本）。
- 移除 `minimum_chrome_version`，增加 `browser_specific_settings.gecko`（含 `id` 与 `strict_min_version: 115.0`）。
- Firefox MV3 里 `host_permissions` 属于「可选授权」，用户首次点「开启」时扩展会主动请求授权。

## 四、提交前自检清单

- [ ] `npm run typecheck` 通过
- [ ] `npm run release` 生成三个 zip，`unzip -t` 全部 OK
- [ ] Chrome：`chrome://extensions` → 开发者模式 → 加载 `dist/` → 图标、弹窗、开关、截图比对、导出报告全部正常
- [ ] Edge：同上加载 `dist/`（或 `edge://extensions`）
- [ ] Firefox：`about:debugging` → 临时载入 `dist-firefox/manifest.json` → 点图标、授权站点、插入设计稿、按 D 比对
- [ ] 隐私政策网址可公开访问
- [ ] 截图与当前版本 UI 一致（改了 UI 记得重跑 `npm run store:assets`）
- [ ] 版本号三处一致：`package.json`、`public/manifest.json`、release 文件名

## 五、常见驳回原因与对策

| 驳回原因 | 对策 |
| --- | --- |
| 权限说明过于笼统（`<all_urls>`） | 用 `permissions.md` 里的逐条理由，说明「在任意站点叠加设计稿 + 截图比对」是核心功能 |
| 单一用途不清晰 | 只保留「视觉走查与像素比对」这一个用途，不要把 CLI、报告模板等算作第二用途 |
| 缺少隐私政策 | 上传 `privacy-policy.html` 到公网并在后台填写链接 |
| AMO 要求声明数据收集 | 已在 Firefox manifest 声明 `required: ["none"]`，商店后台同样选择「不收集」 |
| 截图尺寸不符 | Chrome / Edge / AMO 均用 1280×800，脚本已固定该尺寸 |
| 描述里出现「最好/第一」等夸大表述 | 文案已规避，修订时保持客观 |

## 六、素材再生成说明

`scripts/store-assets.mjs` 会启动本机 Edge（找不到再找 Chrome），加载 `dist/`，在 `.e2e/site` 演示页上：

1. 打开弹窗 → 点「开启」→ 插入 `.e2e/assets/design-desktop.png` → 透明度设到 55%
2. 页面自动对齐设计稿 → 截「叠加」
3. 展开图层面板 → 截「图层」
4. 关闭弹窗，点工具栏「比对」→ 等报告出结果 → 截「比对」
5. 合成 4 张 1280×800 截图 + 440×280 小图 + 1400×560 大图

换演示站点：改脚本里的 `.e2e/site` 与 `DESIGN` 路径；换文案：改 `SLIDE_DEFS`。
