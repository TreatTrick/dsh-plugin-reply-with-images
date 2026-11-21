## Context

在 `rich-image-layouts` 落地后，通过解包分析本地 DSH Desktop 真实会话（`session-b2cc0d1a` 与 `session-cc79c055`）定位到五大根因，导致实际图文效果仍远逊于 ChatGPT：

1. **模型策略过保守**：`deepseek-flash` 在当前偏防守的系统提示下反复权衡延迟与隐私顾虑，要么 0 图、要么仅调用 2 次 `layout: "single"`，完全未触发 `table`、`collage`、`strip`。
2. **Desktop 端布局标记缺失**：Desktop profile 的 `imageDestination` 返回本地文件路径（`C:/Users/...`），`renderTopic` 因 `!/^https?:\/\//i` 直接跳过 `#dsh-layout=` 附加，使 Desktop 端永远无法呈现 `collage` 与 `strip`。
3. **图源与选图失准**：默认 `providers` 将静态百科库 `wikimedia` 排首位且盲取首条候选，导致 2026 热点新闻搜出 2024 年无关老合影（如与欧盟外交官博雷利合影）；同时 `baidu` 因请求头过简及反爬 JSON 结构变化抛出 Zod 错误。
4. **单图与来源条视觉粗糙**：普通正文单图满宽无高度上限，来源行 `*Image source: ...*`（或模型改写的 `*图片来源：...*`）以大号斜体正文显示，视觉噪点高。
5. **全链路零诊断日志**：Host 与 Client 均无结构化观测日志，无法快速定位各 Provider 报错、候选标题排序、Desktop 渲染出的真实 DOM 结构及 `readGallery` 跳过原因。

## Goals / Non-Goals

**Goals:**

- 建立三层轻量可观测体系（Host 结构化 JSONL 日志、Client 诊断快照、本地 DSH 会话复盘脚本），零新增运行时依赖，写入失败绝不阻塞主流程。
- 让 Desktop 与 Web 双端均能稳定传递并渲染 `table`、`collage`、`strip` 三种布局与多图灯箱，同时保持 Desktop 本地图片路径纯净无损。
- 优化默认图源顺序（时效图源优先）、修复 `baidu` 请求与解析、引入基于标题/关键词/年份/噪声词与尺寸的候选相关性筛选，显著减少跑题老图与坏图。
- 重构系统提示词与工具描述，正向鼓励长篇多章节回答规划多版式组合，同时清晰界定「公开人物/公开事件」与「未经核实私人图片」边界，继续跳过短答、代码与抽象主题。
- 精修正文单图比例、人物表格卡片质感与弱化紧凑来源脚注条。

**Non-Goals:**

- 不接入大模型视觉审图（VLM）或 AI 生图。
- 不替换 DSH 宿主 Markdown 渲染器，不引入 `dsh-client-ui-slots` 私有依赖。
- 不修改 DSH 附件存储底层格式或破坏现有 Web 端 `#dsh-layout=` URL 协议。

## Decisions

### 1. Desktop 端 `collage` / `strip` 布局标记传递：Markdown 图片 `title` 双通道协议

- **Web（HTTP(S) 目标）**：继续在 URL 末尾附加 `#dsh-layout=<layout>&group=<id>`，零 tooltip 且服务端忽略 hash。
- **Desktop（非 HTTP(S) 本地文件路径目标）**：保持 `<destination>` 路径字符完全原样不变，通过标准 CommonMark/GFM 图片标题语法附加布局元数据：
  ```markdown
  ![alt](C:/Users/.../objects/ce/... 'dsh-layout=collage&group=<id>')
  ```
- **客户端双通道识别与去痕**：
  - [src/client/images.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/images.ts) 新增 `imageMarker(image)`：优先读取 `WeakMap<HTMLImageElement, LayoutMarker>` 缓存；未命中时依次检查 `src` 的 `#dsh-layout=...` 片段与 `image.getAttribute('title')` 中的 `dsh-layout=<collage|strip>&group=<id>`（允许忽略前后空白），命中后写入 `WeakMap`。
  - 当客户端随后为可放大图片设置 `title="View image: <alt>"` 时（并按既有机制在卸载时还原原始属性），用户鼠标悬停**绝不会看到**原始 `"dsh-layout=..."` 字符串；且后续 `MutationObserver` 重跑 `refresh()` 时从 `WeakMap` 仍能准确识别该图片所属的 `collage`/`strip` 组。
  - **额外收益**：即使某版本 DSH Web 端对 HTTP URL 剥离了 `#hash`，只要需要也可以无缝兼容 `title` 通道，抗宿主升级能力更强。

### 2. 三层可观测诊断日志架构

- **Host 端日志模块（`src/diagnostics.ts`）**：
  - 新增配置项 `debugLog: boolean`（默认 `true`）与 `debugLogPath: string`（默认 `''`，为空时自动落盘至 `path.join(os.homedir(), '.dsh', 'cache', 'reply-with-images', 'diagnostics.jsonl')`）。
  - 每次写入为单行 JSON（含 `ts`、`event`、`sessionTurn` 及事件负载），内置轻量大小保护（单文件超过 `2 MiB` 时自动轮转为 `.1` 备份并新建文件，最多保留 1 份备份），所有文件 I/O 均 `try/catch` 静默降级，绝不因磁盘权限或路径不可写影响搜图与工具返回。
  - 若运行上下文存在 `ctx.logger`，同步输出精简摘要（不泄漏敏感凭据）。
  - 覆盖事件：`plugin.loaded`、`prepare.start`、`search.provider`（Provider 名、耗时、HTTP 失败或解析异常、返回数量及前 5 候选标题）、`search.ranked`（排序后前 5 候选及得分拆解）、`candidate.saved` / `candidate.skipped`（宽高、字节数、跳过原因如 `too-small` / `extreme-aspect` / `duplicate` / `download-failed`）、`prepare.done`（各主题目标 vs 实际 `layout`、标记通道 `hash`/`title`/`none`、总耗时）。
- **Client 端诊断接口（[src/client/images.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/images.ts)）**：
  - 在 `window` 上挂载 `__replyImagesDebug` 只读对象，提供 `snapshot()` 方法返回实时状态：挂载时间戳、扫描到的响应区 `<img>` 列表（含截断 `src`、`classList`、解析到的 `marker`、是否命中 `markdownImage`、是否可用）以及每个包含图片的 `<p>` 的 `readGallery` 判定结果与详细拒绝原因（`matched` / `no-marker` / `mixed-text` / `class-mismatch` / `single-image` / `inconsistent-group`）。
  - 若 `localStorage.getItem('reply-images:debug') === '1'`，在关键 `refresh()` 变化时打印 `console.debug('[reply-with-images]', ...)`。
  - 插件通过 `ctx.effect()` 卸载时删除 `window.__replyImagesDebug`，保持零残留。
- **本地会话复盘脚本（`scripts/analyzeSession.ts`）**：
  - 在 `package.json` 注册 `analyze:session` 命令，支持无参自动选取 `~/.dsh/sessions/` 下最新会话或传参指定 session ID / 文件路径。
  - 使用 Node 24 内置 `zlib.zstdDecompressSync` 按多帧魔数（`28 B5 2F FD`）解压 `session.v4.jsonl.zstd`，提取并格式化输出：用户提问、模型关于插图的思考摘录、`reply_images_*` 工具入参与返回警告、最终正文嵌入的图片清单与布局标记，并在存在对应时间窗口的 `diagnostics.jsonl` 记录时一并关联输出。

### 3. 默认图源重排、Baidu 修复与候选相关性筛选

- **默认图源优先级（[src/config.ts](file:///d:/project/dsh-plugin-reply-with-images/src/config.ts)）**：
  - 将默认 `providers` 调整为 `['bing', 'so360', 'baidu', 'wikimedia']`：
    - `bing` 覆盖全球实时新闻、公众人物近照与中英文双语查询；
    - `so360` 与 `baidu` 补充中文语境图源；
    - `wikimedia` 作为开源许可百科兜底，不再垄断新闻事件首图。
- **HTTP 请求头与 Baidu 解析修复（[src/http.ts](file:///d:/project/dsh-plugin-reply-with-images/src/http.ts)、[src/search/providers.ts](file:///d:/project/dsh-plugin-reply-with-images/src/search/providers.ts)）**：
  - 将 `User-Agent` 升级为标准现代桌面浏览器 UA 并补充 `Accept-Language: zh-CN,zh;q=0.9,en;q=0.8`，降低国内图源误判爬虫概率。
  - 重写 `baidu` 解析入口：先安全检查响应是否为合法 JSON 对象，检测反爬/风控载荷（如 `antiFlag`、缺失 `data` 数组或非零状态码）并抛出单行可读诊断错误而非原始多行 Zod 栈；对合法 `data` 数组额外兼容 `hoverURL` / `replaceUrl` 等合法百度 CDN 缩略字段，忽略尾部空占位对象。
- **候选相关性排序与尺寸质量过滤（`src/search/rank.ts` + [src/replyImages.ts](file:///d:/project/dsh-plugin-reply-with-images/src/replyImages.ts)）**：
  - **排序打分（`rankCandidates(query, candidates)`）**：
    - 从 `query` 提取有效词元（英文单词与中文词片），按 `title` 命中词元比例加分；
    - 年份对齐：若 `query` 包含 4 位年份（如 `2026`），标题命中该年份加分，标题包含明显更早年份（如 `2020`–`2024`）适度减分；
    - 噪声惩罚：对非查询请求的 `logo`、`icon`、`vector`、`clipart`、`wallpaper`、`qrcode`、`watermark`、`meme`、`screenshot` 等关键词减分；对百科合影中主体前出现大量无关前缀实体（如 `A with B` 中主查询词位于后半段）略降权；
    - 保持稳定排序（同分保留原搜索引擎相关度顺序）。
  - **保存前尺寸/比例质检**：在 `saveCandidate` 拿到 `attachments.saveImage`（或在读取图片头解析宽高 / 校验 `ref.width`、`ref.height`）后，若图片过小（`width < 120 || height < 80`）或长宽比极端（`aspect > 4.5 || aspect < 0.22`），判定为低质图标/横幅并跳过顺延尝试下一个候选（记录到 `candidate.skipped` 诊断日志）。为避免把废图写入附件库，优先在 `saveImage` 前用纯 JS 轻量解析 PNG/JPEG/WebP/GIF 头部宽高（约 35 行零依赖代码），不合格的直接跳过下载落盘！

### 4. 系统提示与工具描述重构

- 调整 [src/index.ts](file:///d:/project/dsh-plugin-reply-with-images/src/index.ts) 的 `systemPrompt` 与 [src/tools.ts](file:///d:/project/dsh-plugin-reply-with-images/src/tools.ts) 的 `description`：
  - 将「长篇多章节回答的积极配图契约」前置：面对人物、新闻事件、组织、地点、产品、自然或对比类详细回答时，明确要求**主动规划 2–3 个互补版式区块**（例如公开人物 `table` + 核心场景 `collage` + 现场/多角度 `strip`），不得因怕耗时而退缩为仅贴 1–2 张 `single` 或放弃配图；
  - 精细区分安全边界：对涉及争议的**非公开私人人物**可跳过其个人照片，但**绝不应因此连带放弃同事件中公开政商人物（如公司高管、政府官员）、公司总部、发布会现场与核心场景的配图**；
  - 明确要求模型**原样粘贴 `topic.markdown`**（不得改写或删除图片链接、图片标题标记及来源行），以保证客户端布局识别与来源精修生效；
  - 保留对短答、代码、数学推理、抽象概念和纯文字请求的明确跳过约束。

### 5. 视觉精修与紧凑来源脚注

- **普通正文单图**：限制 `max-height: 380px`、`border-radius: 12px`、柔和边框，避免普通配图撑爆整屏。
- **人物目录表格**：淡化厚重边框、首列 3:4 圆角肖像（`clamp(84px, 20%, 112px)`、`border-radius: 10px`、`object-position: center 20%`），提升卡片感。
- **紧凑来源脚注条**：客户端识别紧随含图段落/图集之后、仅包含 `<em>` 且文本以 `Image source:` / `Image sources:` / `图片来源：` 开头的脚注段落，赋予可逆属性 `data-reply-image-caption`：设置 `12px` 小字号、去斜体（`font-style: normal`）、柔和次级透明度（`0.72`）、紧凑上边距（`-4px`），不破坏原链接可点击性，卸载时完全复原。

## Risks / Trade-offs

- **[Desktop 宿主 Markdown 渲染器可能不透传 `title` 属性]** → 通过新增的 `window.__replyImagesDebug.snapshot()` 日志可在一次真实运行后直接确认 Desktop 渲染出的 `<img>` 真实属性；即使宿主不透传，纯本地文件路径仍保证图片 100% 正常加载而不破图。
- **[调整默认图源顺序后未知许可图片占比上升]** → `bing` / `so360` / `baidu` 默认标注 `License unconfirmed`，保留现行来源与许可声明规范，并继续允许追求严格开源许可的用户将 `providers` 覆写为 `['wikimedia', ...]`。
- **[默认开启 `debugLog` 会产生本地缓存文件]** → 默认路径位于 `~/.dsh/cache/reply-with-images/diagnostics.jsonl` 且单文件严格限制 `2 MiB` 自动轮转，写入异常静默降级，同时支持配置 `debugLog: false` 一键关闭。
- **[标题相关性打分过于激进可能误伤中文短标题候选]** → 采用保守加减分权重与稳定排序（保留原引擎排位作为基准），并完整打印 Top 5 候选得分到 `diagnostics.jsonl` 便于持续调优。

## Migration Plan

- 完全向后兼容现有配置、工具名、Web `#dsh-layout=` 协议与持久化附件路由；用户已有自定义 `providers` 不会被覆写。
- 完成后依次运行 `npm run check`（格式化、严格 TS、Vitest 全覆盖测试、tsdown 构建、`checkClientBundle`）、`npm run preview:client` 视觉验收，以及 `npm run analyze:session` 验证诊断链路。
