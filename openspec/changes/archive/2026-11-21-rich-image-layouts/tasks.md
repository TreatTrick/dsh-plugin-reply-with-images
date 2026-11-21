## 1. 配置与预算解耦

- [x] 1.1 更新 `src/config.ts` 中的默认预算与上限：`maxImagesPerTurn` 默认 `8`（上限 `16`）、`maxSearchesPerTurn` 默认 `6`（上限 `12`）、`maxCandidates` 默认 `10`（上限 `20`），同步更新 `Schema` 默认值与描述。
- [x] 1.2 更新 `src/candidates.ts` 中的 `reservePreparation`，支持分别传入 `searchCount` 与 `imageCount` 进行原子预算预留，保持单轮作用域隔离与错误码稳定。
- [x] 1.3 更新 `tests/config.spec.ts` 与 `tests/candidates.spec.ts`，覆盖新默认预算、合法上限覆写及搜索/图片解耦预留校验。

## 2. Host 端多布局图片准备与降级组装

- [x] 2.1 在 `src/replyImages.ts` 中扩展 `ImageTopic` / `PreparedImageTopic` 类型，支持 `layout?: 'single' | 'table' | 'collage' | 'strip'`、单查询 `count`（1–5）与多子查询 `items[]`（1–5），并保持对旧版 `{ topic, query, alt }` 的向后兼容校验。
- [x] 2.2 在 `src/replyImages.ts` 中实现单次搜索内候选下载失败顺延重试与基于 `attachmentId`（SHA-256）的内容去重，确保多图组不产出重复图片且单张失败不中断其余候选。
- [x] 2.3 实现各布局的 Markdown 拼装与自动降级逻辑：HTTP(S) 目标 URL 附加 `#dsh-layout=collage&group=<id>` 或 `#dsh-layout=strip&group=<id>`（Desktop 非 HTTP 路径跳过 fragment）；`collage` 与 `strip` 将同组图片排布在同一段落并附带单行汇总来源/许可脚注；`collage` 仅成 2 张降级 `strip`、成 1 张降级单图；`table` 生成即贴即用的标准 Markdown 含图表格与 `tableMarkdown`。
- [x] 2.4 更新 `src/tools.ts` 中 `reply_images_prepare` 的入参/出参 schema、description 与 `presentCall` 摘要，并在 `src/index.ts` 中更新 `systemPrompt`：先判断视觉正面价值（跳过短答/代码/抽象/纯文字），再按语义选用 `table`、`collage`、`strip`、`single` 布局并保留全部来源许可说明。

## 3. Web 客户端三种布局与组内多图灯箱

- [x] 3.1 更新 `src/client/styles.ts`：精修含图人物目录表格（首列 3:4 肖像与 `object-position: center 20%`）与对比表样式；新增 `[data-reply-image-group="collage"]` 桌面一大两小网格及 `<= 480px` 窄屏响应式布局；新增 `[data-reply-image-group="strip"]` 等高横向缩略图条、溢出隐藏及计数角标样式；补充多图灯箱的上一张/下一张按钮与底部分页圆点样式。
- [x] 3.2 更新 `src/client/images.ts`：在 `[data-chat-group-part="response"]` 范围内识别携带 `#dsh-layout=collage|strip` 的多图段落，标注可逆 `data-reply-image-group` / `data-reply-image-count` 属性；当 `strip` 超过 3 张时隐藏溢出图片并挂载可逆计数角标按钮；确保加载失败时自动回退且 `ctx.effect()` 卸载时完整清理所有属性、角标、样式与弹窗。
- [x] 3.3 升级 `src/client/images.ts` 中的 `<dialog>` 查看器支持组内多图浏览：识别同组图片（`collage`、`strip`、含图 `table`），支持上一张/下一张按钮、`ArrowLeft`/`ArrowRight` 键盘切图、分页圆点跳转、点击溢出角标直接查看完整图集，并维持 `Escape`/关闭按钮焦点恢复与单图无多余控件。

## 4. 测试、预览与全量门禁验证

- [x] 4.1 扩展 `tests/prepare.spec.ts` 与 `tests/plugin.spec.ts`：覆盖 `table` / `collage` / `strip` / 旧版单图混合准备、单查询多图预算消耗、坏图顺延与 `attachmentId` 去重、`collage` 降级、Desktop 路径不加 `#dsh-layout`、以及系统提示与工具描述契约。
- [x] 4.2 扩展 `tests/client.spec.ts`：覆盖表格精修、一大两小拼贴识别与降级、横向多图条超过 3 张的隐藏与计数角标、组内多图灯箱鼠标/键盘/圆点切图，以及插件卸载后的完整 DOM 清理。
- [x] 4.3 更新 `scripts/clientPreview.ts` 增加表格、一大两小拼贴、4 图横向条及多图灯箱的本地预览样例，并执行 `npm run check` 验证格式化、严格类型检查、测试覆盖率、构建产物与客户端包校验全部通过。
