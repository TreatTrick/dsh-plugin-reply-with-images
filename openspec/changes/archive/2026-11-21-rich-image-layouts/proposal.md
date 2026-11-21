## Why

当前插件（`v0.1.3`）仅支持单图段落插图和基础含图表格，且默认每轮搜索与出图上限均为 3 张、单主题固定 1 张图，无法像 ChatGPT 那样在信息密度高的回答中按语义组合多种图片版式。为了在图片对回答产生正面帮助时提供接近 ChatGPT 的图文阅读与引用体验，同时严格遵守 DeepSeek Harness (DSH) 插件规则与无客户端降级能力，需要引入「表格图 + 一大两小拼贴 + 横向多图条」三种布局及对应的多图准备与前端渐进增强能力。

## What Changes

- **扩展 Host 端多布局图片准备能力**：升级 `reply_images_prepare`，支持按视觉区块提交布局类型（`single`、`table`、`collage`、`strip`），支持「单查询取多图（如 1 次搜索取 3–4 张去重候选）」与「多子查询组图（如 1 主图 + 2 辅图拼贴、多人物表格）」两种模式，并自动拼装可直接插入正文的布局 Markdown、统一来源/许可说明与降级回退。
- **解耦每轮搜索与图片预算并提升出图可靠性**：将默认预算从 3 搜 / 3 图调整为更匹配多图组排版的默认值（默认 6 搜 / 8 图，默认每搜保留 10 个候选，仍支持用户配置覆写）；在单次搜索内支持候选下载失败顺延重试和按附件内容哈希去重，避免拼贴或横向图集中出现重复图或因单张失败整组失效。
- **强化「正面价值才插图」与版式选型指引**：更新系统提示词与工具描述，指导模型先判断图片是否能增强理解（短答、代码、抽象逻辑与纯文字请求继续跳过），再按内容语义匹配最合适的版式（人物/对比用 `table`、事件多维补充用 `collage`、同主题多图集用 `strip`），长篇多章节回答可组合使用多种版式。
- **采用方案 B（标准 Markdown + URL Fragment 渐进增强）升级 Web 客户端展示**：在保持零外部依赖、可逆 `ctx.effect()` 注册与标准 Markdown 降级的前提下，为 HTTP(S) 媒体链接附加无害的布局片段标识（`#dsh-layout=collage|strip&group=...`），在 Web 客户端实现：
  - **表格样式精修**：人物目录左列 3:4 紧凑肖像裁切（优先保留头部构图）与多列对比自适应样式；
  - **一大两小拼贴（Collage）**：桌面端左大图跨两行 + 右上下两小图 CSS Grid 拼贴，窄屏自适应为上大图 + 下两小图，不足 3 张时平滑降级为双图或单图；
  - **横向多图条（Strip）**：等高横向缩略图条，超过 3 张时在第 3 张叠加总数角标并隐藏溢出缩略图；
  - **组内多图灯箱（Image Viewer）**：将单图 `<dialog>` 升级为支持组内上一张/下一张按钮、左右方向键切换、底部分页圆点与当前图说明的查看器。

## Capabilities

### New Capabilities

### Modified Capabilities

- `illustrated-answers`: 扩展自动配图判断与版式选型指导、升级 `reply_images_prepare` 为支持 `table` / `collage` / `strip` / `single` 多图组准备与候选容错去重、解耦默认搜索与图片预算、并扩展 Web 客户端渐进增强以支持三种目标布局与组内多图灯箱。

## Impact

- **Host 端代码**：[src/config.ts](file:///d:/project/dsh-plugin-reply-with-images/src/config.ts)、[src/candidates.ts](file:///d:/project/dsh-plugin-reply-with-images/src/candidates.ts)、[src/replyImages.ts](file:///d:/project/dsh-plugin-reply-with-images/src/replyImages.ts)、[src/tools.ts](file:///d:/project/dsh-plugin-reply-with-images/src/tools.ts)、[src/index.ts](file:///d:/project/dsh-plugin-reply-with-images/src/index.ts)。
- **Web 客户端代码**：[src/client/images.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/images.ts)、[src/client/styles.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/styles.ts) 及预览脚本 [scripts/clientPreview.ts](file:///d:/project/dsh-plugin-reply-with-images/scripts/clientPreview.ts)。
- **兼容性与外部依赖**：不引入新的运行时依赖，不修改 DSH 宿主源码；`reply_images_prepare` 保持对旧版 `{ topic, query, alt }` 入参的向后兼容，`reply_image_search` 与 `reply_images_embed` 保持不变；Desktop 端本地文件路径不附加 `#dsh-layout` 片段以保证原生文件图片通道零回归；无 Web 客户端时自动回退为标准可读 Markdown。
- **测试套件**：更新并补充 [tests/config.spec.ts](file:///d:/project/dsh-plugin-reply-with-images/tests/config.spec.ts)、[tests/candidates.spec.ts](file:///d:/project/dsh-plugin-reply-with-images/tests/candidates.spec.ts)、[tests/prepare.spec.ts](file:///d:/project/dsh-plugin-reply-with-images/tests/prepare.spec.ts)、[tests/plugin.spec.ts](file:///d:/project/dsh-plugin-reply-with-images/tests/plugin.spec.ts) 与 [tests/client.spec.ts](file:///d:/project/dsh-plugin-reply-with-images/tests/client.spec.ts)。
