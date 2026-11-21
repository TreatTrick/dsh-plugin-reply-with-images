## Why

对照最新本地实测会话（`session-9671f835`「介绍 Anthropic 这个公司」）与 ChatGPT 同一问题的分享页，发现当前插件仍存在三大体验断层：候选排序不看 `sourceUrl` 域名质量，导致 `dreamstime` 水印图库与 `religion-info` 内容农场在同分下挤掉了 Wikipedia 官方图与 ABC News 专访照；系统提示中的许可表述与工具结果里的 `License unconfirmed` 让模型产生「许可焦虑」，甚至在拿到图片后主动全部弃用（最终 0 图）；人物目录表格与来源行仍偏重原始表格和英文版权注脚，缺少 ChatGPT 那种「无表头左图右文卡片 + 极简去噪来源」的杂志级排版质感。

## What Changes

- **引入来源域名信誉评分与水印图库/内容农场强降权**：升级 [src/search/rank.ts](file:///d:/project/dsh-plugin-reply-with-images/src/search/rank.ts)，基于 `sourceUrl` 域名与标题特征增加来源质量维度——对商业水印图库（`dreamstime`、`shutterstock`、`gettyimages`、`alamy`、`istockphoto`、`123rf`、`depositphotos`、`vecteezy`、`pinterest` 等）及 SEO 八卦水文标题（`religion`、`net worth`、`height`、`wife`、`wiki-bio` 等）施加强负分；对百科、官方站点（与查询主体匹配的域名）及主流新闻/科技媒体加分，并将 `sourceQuality` 分项写入 `search.ranked` 诊断日志。
- **消除模型「许可焦虑」、明确多章节配图蓝图并适度放宽默认预算**：
  - 将默认预算从 `6 搜 / 8 图`（单次 1–5 区块）调整为 `8 搜 / 12 图`（上限 `16 搜 / 20 图`，单次 `reply_images_prepare` 允许 `1–6` 区块），支持长篇公司/人物/事件介绍跨 3–5 个章节自然配图；
  - 重写系统提示与工具说明：明确声明搜索引擎参考图标注未确认许可是正常状态，**不得仅因未确认许可就丢弃来自百科、官网或主流媒体的清晰参考图**；给出公司/人物/事件介绍的默认配图蓝图（关键人物/对比用 `table`、核心产品或事件用 `collage` 一大两小、现场/产品界面/多角度用 `strip` 横排，单章节独立说明可用 `single`），同时继续对短答、代码、数学、抽象概念和纯文字请求保持克制。
- **客户端卡片化与来源视觉去噪升级**：
  - **人物/实体表卡片化**：对由工具生成的标准首列含图目录表（表头为 `Image | Description | Source and license` 或同结构首列肖像目录表），在 Web/Desktop 客户端采用去外框、隐藏冗余英文表头、仅保留细分隔线的「左 3:4 竖照 + 右文字」编辑级卡片排版，同时保留屏幕阅读器语义和无客户端时的标准 Markdown 表格降级；
  - **来源信息极简化**：进一步弱化图片与图集下方的来源脚注行（小号低对比度胶囊链接样式、紧凑间距），并为单张正文图支持柔和比例约束与干净圆角，让视觉重心完全回归图片与正文。

## Capabilities

### New Capabilities

### Modified Capabilities

- `illustrated-answers`: 扩展候选相关性排序以纳入 `sourceUrl` 域名信誉分与水印图库/SEO 水文强降权，调整多章节长文默认预算与“反许可焦虑”配图蓝图提示，并将客户端首列人物目录表升级为去表头轻卡片样式与更克制的来源呈现。

## Impact

- **Host 端代码**：[src/search/rank.ts](file:///d:/project/dsh-plugin-reply-with-images/src/search/rank.ts)、[src/config.ts](file:///d:/project/dsh-plugin-reply-with-images/src/config.ts)、[src/replyImages.ts](file:///d:/project/dsh-plugin-reply-with-images/src/replyImages.ts)、[src/tools.ts](file:///d:/project/dsh-plugin-reply-with-images/src/tools.ts)、[src/index.ts](file:///d:/project/dsh-plugin-reply-with-images/src/index.ts)。
- **Client 端代码**：[src/client/images.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/images.ts)、[src/client/styles.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/styles.ts)、[scripts/clientPreview.ts](file:///d:/project/dsh-plugin-reply-with-images/scripts/clientPreview.ts)。
- **测试套件**：[tests/search/rank.spec.ts](file:///d:/project/dsh-plugin-reply-with-images/tests/search/rank.spec.ts)、[tests/config.spec.ts](file:///d:/project/dsh-plugin-reply-with-images/tests/config.spec.ts)、[tests/prepare.spec.ts](file:///d:/project/dsh-plugin-reply-with-images/tests/prepare.spec.ts)、[tests/plugin.spec.ts](file:///d:/project/dsh-plugin-reply-with-images/tests/plugin.spec.ts)、[tests/client.spec.ts](file:///d:/project/dsh-plugin-reply-with-images/tests/client.spec.ts)。
- **兼容性**：零新增运行时依赖；继续保留 `reply_images_prepare` / `reply_image_search` / `reply_images_embed` 向后兼容、Web `#hash` 与 Desktop `alt+title` 双通道协议，以及无客户端时 100% 标准 Markdown 可读降级。
