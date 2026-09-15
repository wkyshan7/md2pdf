# MD Studio

把 Markdown 排版成 **PDF / PPTX / DOCX / HTML** 的可视化工作台，同时也是一个可自定义外观的
Markdown 阅读器。纯浏览器前端实现，Windows / macOS / Linux 上有现代浏览器即可运行，无需安装
Office、Pandoc、LaTeX 或任何本地运行时。

```
┌──────────────────────────────────────────────────────────────────────┐
│  顶栏：打开 / 保存 / 导出 PDF · PPTX · DOCX · HTML                     │
├──────────────┬───────────────────────────────┬───────────────────────┤
│  Markdown    │   实时预览（页面 / 阅读模式）  │  主题与细节调整面板     │
│  编辑区      │   支持缩放、分页效果预览        │  预设 / 字体 / 配色 …  │
└──────────────┴───────────────────────────────┴───────────────────────┘
```

---

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物输出到 dist/，可直接静态托管
npm run verify     # 一条命令跑完全部检查（类型 + 冒烟 + 构建 + PWA 校验）

# 单独使用
npm run smoke      # 无浏览器冒烟测试：解析 / HTML / PPTX / DOCX / PDF 分页器 / 打印样式 / 排版
npm run check:pwa  # 校验 dist/ 是否真的是可安装、可离线的应用
npm run icons      # 重新生成应用图标（需要 python3 + Pillow）
```

构建产物是纯静态文件，`dist/` 丢到任意静态服务器（或直接 `file://` 打开）即可使用。

---

## 功能

### 1. 编辑与预览

- 左侧编辑，右侧 **实时预览**（`useDeferredValue` 防抖，大文档不卡顿）
- 两种预览布局：
  - **页面模式**：按真实纸张尺寸（A4/A3/A5/Letter/Legal/16:9）渲染，所见即所得
  - **阅读模式**：流式布局，宽度自适应，适合长时间阅读
- 缩放 40%–150%，可折叠编辑区 / 设置面板
- **可拖拽分栏**：编辑区与设置面板之间的分隔条可拖动调整宽度（双击恢复默认）；
  窗口变小时会自动压缩两侧，保证预览区不被挤没；宽度会记忆到 localStorage
- **响应式布局**：窗口宽度 ≤ 900px 时自动切换为移动端模式，顶部出现「Markdown / 预览 / 设置」标签页，
  每次只显示一屏，适合手机与窄窗口
- 设置面板使用**容器查询**，面板被拖窄时预设卡片自动改单列、颜色选择器自动换行，不会溢出或截断
- **双向同步滚动**：滚动左侧编辑区，中间预览自动跟随；滚动预览也会带动编辑区。
  以标题为锚点做分段线性插值（不是简单等比），标题越多越贴合原文；无标题时退化为等比映射。
  可用预览工具栏的「⇅ 同步滚动」开关关闭。
- 目录、脚注、任务列表、表格、KaTeX 数学公式、highlight.js 代码高亮
- 支持 `markdown-it-attrs` 语法，例如 `# 标题 {.special}`、`段落 {#pid}`
- **标题自动编号（默认开启）**：按层级生成 `1` / `1.1` / `1.2.2` 形式的多级序号，
  预览、HTML、PDF、PPTX、DOCX 五处编号完全一致；可在「标题」分组里关闭，或限制编号到第几级。
  同层级自增、上级标题出现时自动重置下级；跨级（如 H1 直接接 H4）会补零为 `1.0.0.1`。
- **跳过 / 忽略某个标题的编号**：在标题末尾加属性即可，例如 `## 摘要 {.no-number}`
  （也支持 `.unnumbered`）。被标记的标题不显示序号，也不占用编号，下一个标题序号保持连续。

### 2. 外观预设与细节调整

内置预设：**学术论文、现代科技、GitHub 风味、杂志排版、深色阅读、幻灯片**。

右侧面板可逐项微调（全部实时生效）：

| 分组 | 可调项 |
| --- | --- |
| 页面 | 纸张、方向、页边距、H1/H2 前分页 |
| 字体配色 | 字体栈、字号、行高、段间距、正文/背景/强调/链接颜色 |
| 标题 | 对齐、字重、H1–H4 字号、标题色、下划线、自动编号（格式 `1.2.2`，可限定到 H1–H6） |
| 代码 | 高亮主题（27 种）、字号、代码块/行内代码配色、自动换行 |
| 表格引用 | 边框、表头底色、斑马纹、引用边框/底色/文字 |
| 高级 | 自定义 CSS（注入预览与 HTML 导出） |

主题可 **导出 / 导入 JSON**，方便团队统一规范。所有设置与文档自动存入 `localStorage`。

**新建自己的主题**：点击主题预设区的「＋ 新建主题」，输入名称，即可把当前所有外观设置
存成一个自定义主题，与内置预设并列、随时切换。自定义主题卡片带「自定义」标识，
选中后可「更新当前主题」（用当前设置覆盖）或「删除主题」。主题只保存 token，体积极小。

### 3. 字体与图片（分开导入）

字体与图片是两类生命周期不同的资源，分别从顶栏两个入口导入、分别管理：

| 入口 | 标签页 | 存储位置 | 生命周期 |
| --- | --- | --- | --- |
| 顶栏「🅰 字体」 | 字体库 | IndexedDB（全局） | 跨文档复用，一直保留 |
| 顶栏「🖼 图片」 | 文档图片 | IndexedDB + 文档文件 | 跟随当前文档，随保存 / 打开迁移 |

**字体库（全局）** — TTF / OTF / WOFF / WOFF2

- 拖拽或点选导入，自动从字体二进制里读取**族名、字重、斜体**（TTF/OTF/WOFF），读不到时回退文件名；族名可在面板里修改。
- 一键「设为正文」或「设为代码」：字体会插到对应字体栈最前面，实时生效；再点一次即可取消。
- 面板内置可编辑的预览文本，导入即可看到实际字形。
- 字体会以 `@font-face` + data URL 内联，因此：
  - **预览**：`document` 中注入 `@font-face`，无需系统安装字体；
  - **HTML 导出**：单文件内含字体，任何设备打开都一致；
  - **PDF（位图 / 矢量打印）**：导出流程复用同一套字体，不会回退到默认字体；
  - **PPTX / DOCX**：把自定义字体名写入字体设置（受格式限制，无法内嵌字体文件，打开端需安装同名字体）。

**文档图片（随文档）** — PNG / JPEG / GIF / WebP / SVG

- 缩略图网格展示，显示尺寸与体积。
- **插入引用**：在光标处写入 `![名称](asset://<id>)`，正文保持整洁；渲染 / 导出时自动替换为 data URL。
- **插入内嵌**：直接写入 data URL，适合单独分享 Markdown 源文件。
- 「⤓ 保存文档」会把 Markdown、主题与**当前文档的全部图片**打包成 `.mdstudio.json`；
  用顶栏「打开文件」打开该文件，图片会一并恢复，正文里的 `asset://` 引用自动重定向到对应图片。

> 「保存 MD」只导出纯 Markdown；要让图片跟随文档，请用「保存文档」。
> `asset://` 引用只在当前文档范围内有效，普通 Markdown 分享到别处会显示占位图。

**文档文件（`.mdstudio.json`）**

```jsonc
{
  "format": "md-studio:document",
  "version": 1,
  "meta": { "title": "..." },
  "markdown": "# ... ![图](asset://img1)",
  "tokens": { /* 主题 */ },
  "images": [ { "id": "img1", "name": "图", "dataUrl": "data:image/png;base64,..." } ]
}
```

### 4. 多格式导出

| 格式 | 实现方式 | 说明 |
| --- | --- | --- |
| **PDF** | 预览 DOM → 重新分页 → html2canvas 渲染 → jsPDF 写入 | **与预览逐像素一致**。在块元素边界分页，超高的代码块 / 列表 / 表格会按行或按文本继续切分；可选 150/200/300 DPI、PNG/JPEG 编码、页码 |
| **PDF（矢量）** | 浏览器打印引擎（`@page`） | 备选方案：文字可选中 / 可搜索，但分页与页眉页脚由浏览器控制 |
| **PPTX** | `pptxgenjs` | 按 H1/H2 自动切分幻灯片，标题页/章节页、项目符号分级、代码块、表格、图片、自动续页 |
| **DOCX** | `docx` | 生成**真正的 Word 结构**：标题层级（可生成目录并自动更新）、多级列表、表格、代码底纹、图片、页眉页脚与页码 |
| **HTML** | 无依赖 | 单文件自包含：主题 CSS、高亮 CSS 全部内联，离线可看、可直接分享 |

#### PDF 导出是怎么做到“与预览一致”的

PDF 导出不依赖任何独立排版引擎，而是直接复用浏览器已经排版好的结果：

1. 把预览页的 `.md-page` 克隆到屏幕外的容器，按纸张版心宽度重新排版（`src/core/exportPdfRaster.ts`）；
2. **分页**：以块级元素为最小单位依次“填”进页面，放不下就换页；
   - 单个元素超过整页时递归拆分：列表按 `li`、表格按 `tr`、其余按文本用 `Range` 二分查找断点；
   - 拆分时保留结构（`<pre><code>`、嵌套引用、列表续号、表格重复表头）；
3. 用 `html2canvas` 把每页（分块渲染，避免超出 canvas 高度上限）画成位图；
4. 用 `jsPDF` 按纸张尺寸把位图逐页写入并保存。

因此输出所见即所得；代价是**文字为位图，不可选中/搜索**。需要矢量文字时用「用浏览器打印（矢量文字）」。
`jspdf`（400 KB）与 `html2canvas`（200 KB）都通过动态 `import()` 加载，不影响首屏。

#### 打印不会截断内容

浏览器打印有两个容易踩的坑，已在 `buildPrintCss()` 中处理：

- **页面被撑宽**：`.md-page` 原本是 flex 子项，其自动最小尺寸是 `min-content`，
  一旦出现长代码行或宽表格就会把页面撑得比纸张还宽，右侧内容被直接裁掉。
  打印时改为 `display: block` + `width: 100% !important` + `min-width: 0`。
- **长内容溢出**：纸张不会滚动，所以 `overflow: auto / hidden` 等于裁切。
  打印时代码块强制 `white-space: pre-wrap`，表格单元格用 `overflow-wrap: anywhere`，
  并给 `.md-body` 加 `overflow-wrap: anywhere`（它会参与 `min-content` 计算）。

另外，如果你直接在应用页面上按 `Ctrl/Cmd + P`，`app.css` 的打印规则会自动只输出预览页，
隐藏顶栏、侧边编辑区、设置面板与状态栏，不再打印出被截断的分栏。

### 5. 安装为应用（PWA）

项目内置 PWA 支持（`vite-plugin-pwa`），可以像原生应用一样安装到桌面或手机主屏，**并离线使用**：

| 平台 | 安装方式 |
| --- | --- |
| Chrome / Edge（桌面） | 地址栏右侧的「安装」图标，或顶栏的「⤓ 安装应用」按钮 |
| Android Chrome | 菜单 →「安装应用」/「添加到主屏幕」 |
| iOS / iPadOS Safari | 底部分享 →「添加到主屏幕」（Safari 不发安装事件，应用会提示该操作） |
| macOS Safari 17+ | 文件 →「添加到程序坞」 |

细节：

- **离线可用**：Service Worker 预缓存 81 个资源（≈3.5 MB），包含主包、`docx`/`pptxgenjs`/`jspdf`/`html2canvas`
  的按需分块以及 **KaTeX 字体**，断网后公式、代码高亮、四种格式导出全部照常工作
- **相对路径**：`base: './'` 与 PWA 兼容——`manifest.webmanifest` 用 `start_url/scope: "./"`，
  Service Worker 的 81 条预缓存条目也全是相对路径（已由 `npm run check:pwa` 断言）
- **离线主题**：`localStorage` 保存主题与文档，重开即恢复
- **安全区适配**：`viewport-fit=cover` + `env(safe-area-inset-*)`，在刘海屏/灵动岛/底部指示条下不被压住
- **动态视口**：`100dvh` 适配移动端地址栏收放

> **注意**：Service Worker 只在 **HTTPS 或 localhost** 下生效。用 `file://` 直接打开 UI 正常，
> 但没有离线缓存和安装能力。部署到静态托管（GitHub Pages / Netlify / Vercel / Nginx）即可。

#### 图标

图标是几何「M」标记（渐变圆角方块），由 `scripts/make-icons.py` 用 Pillow 生成，不依赖字体渲染：

| 文件 | 用途 |
| --- | --- |
| `icons/icon-192.png` / `icon-512.png` | PWA 图标（带圆角与透明） |
| `icons/icon-maskable-512.png` | maskable 图标：RGB 无 alpha、全出血，标记缩到 36% 落在安全区 |
| `icons/apple-touch-icon.png` | iOS 桌面图标：180×180、不透明（iOS 不支持透明） |
| `favicon.svg` | 矢量 favicon，与 PNG 共用同一套轮廓 |

---

## 目录结构

```
src/
├─ core/
│  ├─ types.ts            页面尺寸、ThemeTokens、导出选项等类型
│  ├─ themes.ts           DEFAULT_TOKENS 与内置预设
│  ├─ assets.ts           自定义资源类型、asset:// 引用解析、@font-face CSS
│  ├─ assetStore.ts       资源持久化（IndexedDB，失败时退回内存）
│  ├─ fontMeta.ts         从 TTF/OTF/WOFF 二进制读取族名 / 字重 / 斜体
│  ├─ documentBundle.ts   文档文件（.mdstudio.json）：Markdown + 主题 + 图片
│  ├─ userThemes.ts       用户自定义主题的增删改与 localStorage 持久化
│  ├─ parser.ts           markdown-it 实例、插件、高亮、标题编号、图片引用解析
│  ├─ headingNumbers.ts    标题多级编号（1 / 1.2 / 1.2.2），预览与导出共用、支持跳过
│  ├─ render.ts           渲染 + DOMPurify 净化（HTML 安全）
│  ├─ themeCss.ts         token → CSS 变量 + 基础排版 + @page 打印规则
│  ├─ highlightThemes.ts  highlight.js 主题 CSS（?inline 静态导入）
│  ├─ document.ts         组装自包含 HTML 文档（HTML 导出 / PDF 打印共用）
│  ├─ exportHtml.ts       HTML 导出
│  ├─ exportPdf.ts        打印式 PDF 导出（矢量文字，备选）
│  ├─ exportPdfRaster.ts  所见即所得 PDF：重新分页 + 位图渲染 + jsPDF
│  ├─ dom.ts              单位换算、下一帧、字体/图片等待
│  ├─ exportPptx.ts       Markdown → 幻灯片结构 → PPTX
│  ├─ exportDocx.ts       Markdown → docx 元素树 → DOCX
│  ├─ download.ts         下载 / 文件读取工具
│  └─ sample.ts           示例文档
├─ ui/
│  ├─ controls.tsx        表单控件（滑块 / 颜色 / 下拉 / 开关 …）
│  ├─ SettingsPanel.tsx   设置面板
│  ├─ AssetsPanel.tsx     资源库面板（导入 / 管理字体与图片）
│  ├─ useAssets.ts         资源状态：导入、删除、重命名、IndexedDB 同步
│  ├─ Preview.tsx         预览容器（页面 / 阅读、缩放）
│  ├─ useScrollSync.ts    编辑器 ↔ 预览同步滚动
│  ├─ useMediaQuery.ts    响应式断点
│  └─ usePwaInstall.ts    PWA 安装事件与安装按钮逻辑
├─ styles/app.css         应用界面样式
├─ App.tsx                状态管理与整体布局
└─ main.tsx               入口
public/
├─ favicon.svg
└─ icons/                 应用图标（由 scripts/make-icons.py 生成）
scripts/
├─ smoke.ts               无浏览器冒烟测试
├─ check-pwa.mjs          构建产物 PWA 校验
└─ make-icons.py          图标生成
```

**设计要点**：主题只是一组 `ThemeTokens`，渲染层只消费 token，不关心具体预设。
新增一套预设 = 在 `themes.ts` 里加一个 `{ id, name, tokens }` 对象，其余全部自动生效。

资源层同理：`Asset` 统一描述字体与图片，`asset://<id>` 在解析阶段就替换为 data URL，
因此下游的渲染与四种导出完全不需要知道资源是如何导入的。

---

## 已知限制

- **PDF 文字不可选中**：所见即所得导出基于位图。需要可搜索的 PDF 请用「用浏览器打印（矢量文字）」。
- **PDF 页码**：现在由导出器直接绘制（「PDF 选项 → 输出页码」），不再依赖浏览器打印对话框。
- **代码块换行**：为了保证长代码不被裁掉，写 PDF 时会强制代码块自动换行；
  若希望预览与 PDF 完全一致，请在「代码」分组里开启「代码自动换行」。
- **PPTX 图片**：支持 data URL 与可跨域访问的图片 URL；本地相对路径图片无法在浏览器中读取，
  建议用资源库「插入引用 / 插入内嵌」（PDF 导出会自动把可跨域的图片转成 data URL）。
- **DOCX / PPTX 字体嵌入**：这两种格式的库不支持内嵌字体文件，只能写入字体名。
  若把导出的文件发给未安装该字体的设备，会回退到系统字体；需要完全一致的视觉效果请用 PDF / HTML。
- **资源持久化**：字体库与文档图片保存在浏览器 IndexedDB 中，仅当前浏览器可见。
  字体是全局资源，不会随文档同步；图片可以用「保存文档」随 `.mdstudio.json` 一起迁移。
  隐私模式下退化为内存存储，刷新即丢失（面板会给出提示）。
- **DOCX 数学公式**：以 LaTeX 源码形式呈现（Word 原生公式 OMML 暂未转换）。
- **PPTX 版式**：采用「标题 + 内容」的通用版式自动排版，不做像素级模板还原。
- 主包体积约 1.75 MB（gzip 564 KB），主要来自 `docx` / `pptxgenjs` / KaTeX / highlight.js；
  PDF 相关的 `jspdf`、`html2canvas` 已按需加载。

---

## 安全说明

预览与 HTML 导出都经过 **DOMPurify** 净化（开启 HTML + MathML + SVG 配置），
即使粘贴了不可信的 Markdown（含 `<script>`）也不会执行脚本。

## 后续可扩展方向

- 目录（TOC）侧边栏与折叠预览
- 多文档标签页 / 文件夹工作区（File System Access API）
- 自定义模板体系（封面页、页眉页脚变量、PPT 母版）
- Paged.js 分页预览，实现真实页码与交叉引用
- 用 Tauri 打包桌面版（体积 5–15 MB），获得原生另存为对话框与本地图片相对路径支持；
  需注意 Linux 的 WebKitGTK 未实现 `window.print()`，应在该平台隐藏「矢量打印」按钮
  （主 PDF 路径是位图渲染，不受影响）
- 若不想引入 Rust，可用 Electron（体积 120–180 MB）

## 打包为应用

本项目是**纯前端静态 SPA**，`src/` 里没有任何 Node / 服务端 API，因此可以原样嵌入各种容器：

| 方案 | 体积 | 覆盖平台 | 说明 |
| --- | --- | --- | --- |
| **PWA（已完成）** | 0 | 桌面三平台 + iOS/Android | 浏览器「安装」，离线可用；需 HTTPS 或 localhost |
| Tauri v2 | 5–15 MB | 桌面三平台 + iOS/Android | 需 Rust 工具链；同一套配置可出移动包 |
| Electron | 120–180 MB | 桌面三平台 | 只需 Node，最成熟 |
| Capacitor | ~10 MB | iOS/Android | 需 Xcode / Android SDK |

嵌入到原生容器时需要额外处理的三点：

1. **Blob 下载**：四种格式导出都走 `URL.createObjectURL` + `<a download>`（`core/download.ts`）。
   PWA / Electron 直接可用；Tauri 需接官方 `dialog` + `fs` 插件才能控制保存路径。
2. **矢量打印**：`exportPdf.ts` 用 `window.print()`，Linux WebKitGTK 不支持。
3. **中文字体**：目前依赖系统字体栈，Linux 需安装 `fonts-noto-cjk`，否则中文会缺字或字形不佳。
