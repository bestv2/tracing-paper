# 权限理由（可直接粘贴到商店后台）

Chrome / Edge 会逐条要求解释，Firefox 会让审核员核对声明与实际用途。下面是本扩展的全部权限，
每一条都对应明确功能，没有冗余权限。

## permissions

### `storage`
保存素材库索引、每个 URL 对应的图层位置/尺寸/透明度，以及界面语言与主题偏好。
这些数据只存在 `chrome.storage.local`，用于下次打开同一页面时恢复走查现场，不做任何跨设备同步。

### `unlimitedStorage`
设计稿以 dataURL 形式保存在本地存储中，一张设计稿常见 1–5 MB，多份素材会超过默认 5 MB 配额。
该权限仅放宽本地配额，不产生任何网络传输。

### `activeTab`
用户点击工具栏图标打开弹窗时，扩展需要读取当前标签页的标题与 URL，用于展示「本页走查状态」
并把场景按 URL 归档。该权限只在用户主动点击后生效，不常驻、不遍历其他标签页。

### `scripting`
用户开启工具时，用 `chrome.scripting.executeScript` 按需把 `overlay.js`（走查浮层）注入当前页。
浮层不常驻：未开启时不注入任何脚本，关闭时从页面移除。

## host_permissions

### `<all_urls>`
核心功能是「把设计稿叠到任意网页上做走查」，因此需要：

1. `content_scripts` 在 http/https 页面加载时注册极小的引导脚本 `content.js`（< 1 KB），仅用于
   响应弹窗的状态查询，以及页面刷新后按需恢复上次的设计稿；
2. `chrome.tabs.captureVisibleTab` 截取当前视口，用于像素比对；
3. 在用户关闭再打开页面后，仍能把走查浮层注入到同一站点。

扩展不会读取、收集、上传页面内容：比对只在本地进行，报告通过下载/剪贴板交给用户自己处理。

**Firefox 差异**：Firefox 的 MV3 把 `host_permissions` 视为「可选授权」。用户安装后首次点「开启」时，
扩展会调用 `permissions.request()` 请求站点访问；用户拒绝时不会注入任何脚本，只在弹窗内显示提示。

## commands

### `toggle-inspector`（Alt+Shift+V）
一键开启 / 收起当前页的走查工具栏。不涉及数据访问。

## 未申请的权限（供审核参考）

以下是这类工具常见但本扩展**没有**申请的权限，可对照 `manifest.json` 核对：

| 权限 | 为什么不需要 |
| --- | --- |
| `tabs` | 只用 `activeTab` 就够定位当前页，不需要列出所有标签页 |
| `<all_urls>` 的 `webRequest` / `declarativeNetRequest` | 不拦截、不修改任何网络请求 |
| `identity` / `cookies` | 无账号体系，不读取登录状态 |
| `downloads` | 报告导出走 `a[download]` 与剪贴板，不接管下载管理器 |
| `clipboardRead` | 粘贴图片用页面内的 `paste` 事件，不读系统剪贴板 |

## 远程代码与数据

- 无远程代码：所有 JS 都在安装包内，不加载 CDN 脚本，不用 `eval` 执行远程字符串
- 无网络请求：扩展自身不发起任何 HTTP 请求（不埋点、不鉴权、不拉配置）
- 无数据收集：设计稿、截图、报告都留在本地；Firefox manifest 已声明
  `data_collection_permissions: { required: ["none"] }`
