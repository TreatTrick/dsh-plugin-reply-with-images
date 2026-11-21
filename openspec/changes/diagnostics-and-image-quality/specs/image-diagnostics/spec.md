## ADDED Requirements

### Requirement: Host 端结构化诊断日志

系统 MUST 提供可配置的 Host 端结构化 JSONL 诊断日志（`debugLog` 默认开启，`debugLogPath` 可覆写，默认写入 `~/.dsh/cache/reply-with-images/diagnostics.jsonl`），在不引入外部运行时依赖的前提下记录插件加载环境（`web`/`desktop`、图源顺序、预算）、工具入参、各 Provider 搜索耗时/返回数/候选标题与错误原因、候选排序得分、下载宽高与跳过原因（如尺寸过小、长宽比极端、重复或下载失败）以及每个主题的最终生效布局、降级原因与标记通道（`hash`/`title`/`none`）。日志文件 MUST 受体积上限保护（超过 2 MiB 时自动轮转），且任何日志写入错误 MUST 静默降级而不得阻塞或中断正常图片工具执行。

#### Scenario: 记录一次多布局准备的完整诊断轨迹

- **WHEN** `debugLog` 开启且模型调用 `reply_images_prepare`
- **THEN** Host 端按 JSONL 格式追加写入 `prepare.start`、`search.provider`、`search.ranked`、`candidate.saved`（或 `candidate.skipped`）与 `prepare.done` 记录，包含耗时、候选标题、评分与最终布局通道信息

#### Scenario: 关闭日志或写入路径不可写时静默降级

- **WHEN** 配置将 `debugLog` 设为 `false`，或默认/自定义日志目录不可写
- **THEN** 插件正常完成搜索、保存与 Markdown 返回，不抛出日志相关异常

### Requirement: 客户端渲染诊断快照

启用 Web/Desktop 客户端扩展时，客户端 MUST 在 `window.__replyImagesDebug` 暴露只读诊断接口 `snapshot()`，返回插件挂载状态、响应区所有图片的截断 `src`、`classList`、布局标记解析结果与可用性，以及每个含图段落的 `readGallery` 命中布局或精确拒绝原因（如 `no-marker`、`mixed-text`、`class-mismatch`、`single-image`）。当 `localStorage` 中开启 `reply-images:debug=1` 时 MUST 输出 `console.debug` 摘要。插件卸载时 MUST 移除 `window.__replyImagesDebug` 而不残留全局状态。

#### Scenario: 排查前端未命中拼贴或横排的原因

- **WHEN** 客户端已加载且响应区包含含图段落，开发者调用 `window.__replyImagesDebug.snapshot()`
- **THEN** 返回值准确列出响应区图片列表、每张图识别到的 `hash`/`title` 标记以及每个段落的布局匹配结果或拒绝原因

#### Scenario: 插件卸载清理诊断挂载

- **WHEN** 插件客户端通过 `ctx.effect()` 卸载
- **THEN** `window.__replyImagesDebug` 被清除，不再保留对 DOM 节点的引用

### Requirement: 本地 DSH 会话一键复盘脚本

仓库 MUST 提供命令行复盘脚本（`scripts/analyzeSession.ts`，经 `npm run analyze:session` 执行），支持自动读取本地 `~/.dsh/sessions/` 最新会话或指定会话文件，解压多帧 `session.v4.jsonl.zstd` 并关联可读的 `diagnostics.jsonl` 日志，输出模型关于插图的思考摘录、`reply_images_*` 工具调用与警告、最终正文中嵌入的图片与布局统计。

#### Scenario: 复盘最近一次 DSH 会话

- **WHEN** 开发者运行会话分析脚本并指向一个有效的 `session.v4.jsonl.zstd` 文件（及可选诊断日志）
- **THEN** 脚本输出结构化文本报告，清晰列出用户提问、插图推理摘录、工具入参/警告与最终正文贴图数量及布局类型
