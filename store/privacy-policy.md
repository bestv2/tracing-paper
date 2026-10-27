# 描图纸 Tracing Paper 隐私政策

最后更新：2026-10-27 · 适用版本：1.0.0 及以后

描图纸 Tracing Paper（下称「本扩展」）是一个浏览器内的视觉走查工具：把设计稿叠加到网页上，
在本地做像素比对并生成差异报告。**本扩展不收集、不上传、不共享任何用户数据。**

## 一、我们处理哪些数据

| 数据 | 存储位置 | 用途 | 是否离开设备 |
| --- | --- | --- | --- |
| 你插入的设计稿图片 | 浏览器本地存储（IndexedDB / `chrome.storage.local`） | 叠加显示、像素比对、下次复用 | 否 |
| 图层的坐标、尺寸、透明度、混合模式 | 同上，按页面 URL 归档 | 刷新页面后恢复走查现场 | 否 |
| 比对产生的截图与报告（JSON / Markdown / SARIF / PNG） | 内存 + 你主动导出到的本地文件 | 生成差异结论 | 否 |
| 界面语言、主题偏好 | 同上 | 记住你的选择 | 否 |
| 当前标签页的标题与 URL | 不落盘（仅内存） | 在弹窗中显示「本页走查状态」 | 否 |

本扩展没有账号体系，不需要登录，也不读取你的浏览历史、书签、密码、Cookie 或表单内容。

## 二、我们不做什么

- 不发起任何网络请求：没有埋点、没有统计 SDK、没有远程配置、没有第三方接口
- 不加载远程代码：所有脚本都打包在安装包内
- 不出售、不共享、不转让任何数据给第三方
- 不把数据用于广告、画像或信用评估

## 三、权限与用途

| 权限 | 用途 |
| --- | --- |
| `storage` / `unlimitedStorage` | 在本地保存素材库与每页的走查状态 |
| `activeTab` | 你点击工具栏图标后，读取当前标签页标题与 URL |
| `scripting` | 你开启工具时，按需把走查浮层注入当前页 |
| `host_permissions: <all_urls>` | 在任意站点叠加设计稿、截图比对、刷新后恢复浮层 |
| `commands`（Alt+Shift+V） | 快捷键开关工具 |

Firefox 的 Manifest V3 将「访问网站」作为可选授权，你可以随时在浏览器扩展设置中撤销，
撤销后本扩展不会在任何页面注入脚本。

## 四、数据保留与删除

- 所有数据都在你的浏览器配置目录内，卸载扩展或清除扩展数据即全部删除
- 弹窗中的「素材库 → 删除」可单独删除某张设计稿
- 页面内工具栏的「清空本页」可删除当前页的图层记录

## 五、儿童隐私

本扩展面向开发者与设计师，不面向 13 岁以下儿童，也不会有意收集儿童数据（本扩展本身不收集任何数据）。

## 六、政策变更

若未来功能变化导致数据处理方式改变，我们会在本页更新并修订「最后更新」日期；
涉及新增数据收集时，会在扩展更新说明中明确告知，并同步更新浏览器商店的数据使用声明。

## 七、联系方式

- 开发者：wind.wang
- 邮箱：bestv2@163.com
- 主页：<https://github.com/bestv2/tracing-paper>

---

# Tracing Paper Privacy Policy

Last updated: 2026-10-27 · Applies to version 1.0.0 and later

Tracing Paper is an in-browser visual QA tool: it overlays a design mockup on a web page, runs a
pixel-level comparison locally and produces a diff report. **The extension does not collect, upload or
share any user data.**

## What is processed

| Data | Where it lives | Why | Leaves your device |
| --- | --- | --- | --- |
| Design images you insert | Local browser storage (IndexedDB / `chrome.storage.local`) | Overlay, comparison, reuse | No |
| Layer geometry (position, size, opacity, blend mode) | Same, keyed by page URL | Restore the review session after reload | No |
| Captures and reports (JSON / Markdown / SARIF / PNG) | Memory, plus files you explicitly export | Produce the diff result | No |
| UI language and theme | Same local storage | Remember your choice | No |
| Active tab title and URL | Memory only | Show the "current page" status in the popup | No |

There is no account system. The extension does not read your history, bookmarks, passwords, cookies or form data.

## What we never do

- No network requests: no analytics, no remote config, no third-party endpoints
- No remote code: every script is bundled with the package
- No selling, sharing or transferring data to third parties
- No advertising, profiling or credit scoring

## Permissions

| Permission | Purpose |
| --- | --- |
| `storage` / `unlimitedStorage` | Keep the local library and per-page review state |
| `activeTab` | Read the active tab title/URL after you click the toolbar icon |
| `scripting` | Inject the review overlay on demand when you enable the tool |
| `host_permissions: <all_urls>` | Overlay mockups and capture diffs on any site, restore the overlay after reload |
| `commands` (Alt+Shift+V) | Keyboard shortcut to toggle the tool |

Firefox's Manifest V3 treats site access as optional; you can revoke it at any time in the browser's
extension settings, after which no script is injected anywhere.

## Retention and deletion

All data lives inside your browser profile. Uninstalling the extension or clearing extension data
removes everything. The popup's library view lets you delete individual mockups, and the in-page
toolbar's "Clear page" removes the layers recorded for the current page.

## Changes

If a future feature changes how data is handled, this page will be updated (with a new "last updated"
date), and the change will be described in the extension release notes and the store data-usage forms.

## Contact

- Developer: wind.wang
- Email: bestv2@163.com
- Homepage: <https://github.com/bestv2/tracing-paper>
