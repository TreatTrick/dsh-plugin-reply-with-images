## 1. Host 端诊断日志与配置升级

- [x] 1.1 更新 `src/config.ts`：将默认 `providers` 调整为 `['bing', 'so360', 'baidu', 'wikimedia']`，新增 `debugLog`（默认 `true`）与 `debugLogPath`（默认 `''`）配置项及 Schemastery 声明，同步更新 `tests/config.spec.ts`。
- [x] 1.2 新建 `src/diagnostics.ts`：实现零依赖 JSONL 诊断日志写入器（默认路径 `~/.dsh/cache/reply-with-images/diagnostics.jsonl`、单文件超过 2 MiB 自动轮转 `.1`、所有文件 I/O 静默降级、可选转发精简摘要至 `ctx.logger`），并补充单元测试。

## 2. 图源修复、候选相关性排序与尺寸质检

- [x] 2.1 更新 `src/http.ts` 与 `src/search/providers.ts`：升级请求头为标准桌面浏览器 `User-Agent` 与 `Accept-Language`；加固 `baidu` 解析逻辑，兼容缺失 `data` 数组或反爬风控载荷并输出简洁单行错误，支持 `hoverURL` 等合法百度 CDN 备用字段，同步补充 `tests/search/providers.spec.ts`。
- [x] 2.2 新建 `src/search/rank.ts` 并接入 `src/search/search.ts`：实现基于查询词匹配度、年份时效性、噪声词（`logo`/`icon`/`watermark`/`qrcode` 等）惩罚及稳定排位的候选相关性评分，并将各 Provider 耗时/候选标题/错误与排序后 Top 5 得分写入诊断日志，补充排序单元测试。
- [x] 2.3 在 `src/replyImages.ts` 中新增纯 JS 零依赖 PNG/JPEG/WebP/GIF 图片头宽高解析，保存前过滤极小缩略图（`< 120×80`）与极端长宽比异形图（`> 4.5` 或 `< 0.22`），将 `prepare.start`、`candidate.saved`、`candidate.skipped`、`prepare.done` 全流程接入诊断日志。

## 3. Desktop 双通道布局标记与系统提示重构

- [x] 3.1 更新 `src/replyImages.ts` 的 `renderTopic`：Web 端 HTTP(S) URL 继续使用 `#dsh-layout=<layout>&group=<id>`，Desktop 非 HTTP(S) 本地路径保持路径纯净并通过标准 Markdown 图片 `title` 属性（`"dsh-layout=<layout>&group=<id>"`）输出布局元数据，并在 `prepare.done` 日志中记录标记通道（`hash`/`title`/`none`）。
- [x] 3.2 更新 `src/index.ts` 的 `systemPrompt` 与 `src/tools.ts` 的工具描述：正向引导长篇多章节回答主动规划 2–3 个互补版式区块（`table` / `collage` / `strip`），明确区分「公开人物/现场场景」与「非公开私人未核实照片」，要求原样粘贴 `topic.markdown` 保留链接、标题标记与来源行，继续跳过短答、代码、数学与纯文字请求；记录 `plugin.loaded` 诊断日志。

## 4. 客户端双通道识别、视觉精修与诊断快照

- [x] 4.1 更新 `src/client/images.ts`：支持从 `src` `#hash` 与原始 `title` 双通道解析布局标记并缓存到 `WeakMap`，避免 `zoom` 替换 `title` 后丢失标记或悬停暴露原始内部字符串；自动识别图片/图集下方的来源脚注行（`*Image source(s): ...*` / `*图片来源：...*`）并附加可逆 `data-reply-image-caption` 属性。
- [x] 4.2 在 `src/client/images.ts` 中挂载只读 `window.__replyImagesDebug.snapshot()`（暴露响应区图片状态、双通道标记与每个含图段落的 `readGallery` 命中/拒绝原因）及 `localStorage('reply-images:debug')` 调试输出，确保 `ctx.effect()` 卸载时彻底清理。
- [x] 4.3 更新 `src/client/styles.ts` 与 `scripts/clientPreview.ts`：精修正文单图最大高度（`380px`）与圆角、人物目录轻边框卡片样式、拼贴/横排细节与紧凑小号弱化来源脚注条样式，并在预览脚本中补充 Desktop `title` 标记样例与紧凑来源条样例。

## 5. 一键会话复盘脚本与全量验证

- [x] 5.1 新建 `scripts/analyzeSession.ts` 并在 `package.json` 中注册 `analyze:session` 命令：支持自动查找本地 `~/.dsh/sessions/` 最新会话或指定文件路径，多帧解压 `session.v4.jsonl.zstd` 并关联 `diagnostics.jsonl`，输出结构化插图诊断报告。
- [x] 5.2 扩展 `tests/prepare.spec.ts`、`tests/plugin.spec.ts`、`tests/client.spec.ts` 及新增诊断测试，覆盖 Desktop `title` 双通道、相关性排序与尺寸过滤、紧凑来源条、`window.__replyImagesDebug` 卸载清理、日志轮转与静默降级。
- [x] 5.3 执行 `npm run check`（格式化、严格类型检查、测试覆盖率、构建、`checkClientBundle`）与 `npm run analyze:session` 验证全部通过。
