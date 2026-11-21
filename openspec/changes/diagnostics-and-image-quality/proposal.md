## Why

实测最近两次 DSH Desktop 真实会话（`session-b2cc0d1a` 与 `session-cc79c055`）发现，即使已支持多布局工具，真实图文效果仍明显逊于 ChatGPT：模型在保守提示下只调用了 2 次 `single`（甚至 0 图）；Desktop profile 本地图片路径直接跳过了 `#dsh-layout=` 导致 `collage`/`strip` 永远无法触发；默认把 `wikimedia` 排首位并盲取第 1 张导致 2026 新闻事件贴出 2024 年无关老合影，同时 `baidu` 图源解析已静默报错；单图满宽与大号斜体来源行视觉粗糙；且插件 Host 与 Client 端均缺少诊断日志，问题排查困难。

## What Changes

- **新增三层端到端诊断日志与会话复盘能力（`image-diagnostics`）**：
  - **Host 端结构化 JSONL 日志**：记录插件加载环境（`web`/`desktop`、图源顺序、预算）、工具原始入参、各 Provider 耗时/返回数/前 N 候选标题与错误、候选相关性评分、下载宽高/跳过原因、最终生效布局与降级原因，默认写入 `~/.dsh/cache/reply-with-images/diagnostics.jsonl` 并带体积轮转保护与配置开关。
  - **Web/Desktop 客户端诊断快照**：暴露只读 `window.__replyImagesDebug.snapshot()` 与可选 `console.debug` 输出，记录挂载状态、响应区所有 `<img>` 的 `src`/`classList`/布局标记以及 `readGallery` 命中或拒绝原因，卸载时自动清理。
  - **本地会话复盘脚本（`scripts/analyzeSession.ts` / `npm run analyze:session`）**：解压最新或指定 DSH `session.v4.jsonl.zstd` 并关联 `diagnostics.jsonl`，一键输出模型插图思考摘录、工具调用与最终贴图统计。
- **修复 Desktop 端支持 `collage` 与 `strip` 布局标记**：在保持 Desktop 本地文件路径完全纯净的前提下，对非 HTTP(S) 图片目标改用标准 Markdown 图片标题属性（`![alt](<local-path> "dsh-layout=collage&group=<id>")`）承载布局元数据；Web 客户端同时识别 `src` `#hash` 与原始 `title` 标记（并在替换为无障碍 `title` 前缓存在 `WeakMap` 中，避免悬停泄露内部标记），实现 Web 与 Desktop 双端一致渲染。
- **重排默认图源优先级、修复 `baidu` 解析并引入候选相关性筛选**：
  - 将默认 `providers` 从 `['wikimedia', 'baidu', 'so360', 'bing']` 调整为 `['bing', 'so360', 'baidu', 'wikimedia']`，让时效新闻与实拍图优先于百科老图库；
  - 完善 HTTP 请求头（真实浏览器 `User-Agent`、`Accept-Language`）并加固 `baidu` 解析逻辑（兼容反爬或异常 JSON 结构与备用字段，输出可读诊断错误而非多行 Zod 报错）；
  - 新增候选相关性打分与过滤模块（按查询词匹配度、年份时效性、无关水印/图标词惩罚排序，并在保存前过滤极小缩略图和极端长宽比异形图）。
- **强化系统提示与工具描述以打破「只贴 2 张单图」保守惯性**：明确区分「公共人物/事件场景」与「未经核实私人图片」，在长篇人物/事件/科普/旅行/对比综述中正向引导模型单次规划 2–3 个互补版式区块（如公开人物 `table` + 核心场景 `collage` + 同主题 `strip`），并要求原样保留工具返回的 Markdown 区块与来源行；同时保持对短答、代码、数学、抽象概念和纯文字请求的克制跳过。
- **精修视觉排版与紧凑来源条**：为普通正文单图增加合理最大高度与柔和圆角；精修人物目录表格卡片质感（去重线、3:4 竖版肖像与头部裁切保护）以及拼贴/横排图集微交互；客户端自动识别图片与图集下方的来源脚注行（支持英文 `*Image source(s): ...*` 与中文 `*图片来源：...*`）并以小号弱对比度紧凑样式呈现。

## Capabilities

### New Capabilities

- `image-diagnostics`: 为插件 Host 端、Web/Desktop 客户端及本地 DSH 会话提供结构化诊断日志、DOM 布局判定追踪与一键复盘脚本，用于定位模型触发决策、图源失败、选图偏差与前端渲染失效原因。

### Modified Capabilities

- `illustrated-answers`: 扩展双端（Web + Desktop）布局标记传递机制、调整默认图源优先级并引入候选相关性排序与尺寸过滤、强化多版式自动配图指引、以及精修正文单图、人物表格与紧凑来源脚注的客户端视觉表现。

## Impact

- **新增模块与脚本**：`src/diagnostics.ts`、`src/search/rank.ts`、`scripts/analyzeSession.ts`。
- **Host 端变更**：[src/config.ts](file:///d:/project/dsh-plugin-reply-with-images/src/config.ts)、[src/http.ts](file:///d:/project/dsh-plugin-reply-with-images/src/http.ts)、[src/search/providers.ts](file:///d:/project/dsh-plugin-reply-with-images/src/search/providers.ts)、[src/search/search.ts](file:///d:/project/dsh-plugin-reply-with-images/src/search/search.ts)、[src/replyImages.ts](file:///d:/project/dsh-plugin-reply-with-images/src/replyImages.ts)、[src/tools.ts](file:///d:/project/dsh-plugin-reply-with-images/src/tools.ts)、[src/index.ts](file:///d:/project/dsh-plugin-reply-with-images/src/index.ts)。
- **Client 端变更**：[src/client/images.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/images.ts)、[src/client/styles.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/styles.ts)、[scripts/clientPreview.ts](file:///d:/project/dsh-plugin-reply-with-images/scripts/clientPreview.ts)。
- **兼容性与门禁**：不新增运行时外部依赖，不改动 DSH 宿主源码；保持 `reply_images_prepare` / `reply_image_search` / `reply_images_embed` 向后兼容；Desktop 本地图片路径仍保持纯净无 hash；所有新增诊断状态与 DOM 属性在 `ctx.effect()` 卸载时完整清理。
