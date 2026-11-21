## Context

在完成了多布局准备、三层诊断日志与 DSH 44.7.0 真实 DOM 适配（`_image_13jw0_300` / `_imageButton_13jw0_471` / 零宽 `alt` 标记）后，对照「介绍 Anthropic 这个公司」的本地实测会话（`session-9671f835`）与 ChatGPT 同题分享页（`https://chatgpt.com/share/6b01ca41-5f74-83ee-b357-cd3b397cf288`），发现制约最终体验的最后三道瓶颈：

1. **排序缺少来源信誉维度**：[src/search/rank.ts](file:///d:/project/dsh-plugin-reply-with-images/src/search/rank.ts) 仅基于标题词频与年份打分，不区分 `sourceUrl` 域名可信度；当 `dreamstime.com` 水印图库或八卦内容农场博客与 `wikipedia.org` / `abcnews.go.com` 同分（均为 12 分）时，低质来源因搜索引擎原序靠前被优先选中。
2. **模型「许可焦虑」导致自我弃图**：`session-9671f835` 中模型明确因为看到 `"unconfirmed licenses from low-quality sources"` 而放弃了全部已准备图片（`embedded.total = 0`）；同时长篇公司/人物综述往往需要 3–5 个视觉区块（ChatGPT 同题使用了 14 张图覆盖 5 个章节），默认 `6 搜 / 8 图` 与 `1–5` 区块对复合主题仍偏紧。
3. **表格与来源条视觉仍有“文档表格感”**：ChatGPT 的人物卡与主题卡采用「无外框、无英文表头、左 3:4 竖照 + 右文字 + 极细行分隔线」的编辑级流式卡片，来源呈现克制低噪；而当前人物目录表仍显示 `Image | Description | Source and license` 三列表头与外边框，且来源脚注较显眼。

## Goals / Non-Goals

**Goals:**

- 在 `rankCandidates` 中引入可解释、零外部依赖的 `sourceQuality`（来源域名信誉 + SEO 水文标题识别）打分项，让官网、维基百科与主流权威媒体稳定压过水印图库与内容农场，并将该分项记录到 `search.ranked` 诊断日志。
- 消除系统提示中的许可焦虑，明确告知模型搜索引擎参考图标注未确认许可是常规状态，不得据此丢弃高质量官网/百科/媒体参考图；给出公司/人物/事件介绍的清晰多章节配图蓝图，并将默认预算适度放宽至 `8 搜 / 12 图`（单次支持 `1–6` 区块）。
- 将客户端首列人物/实体目录表升级为更接近 ChatGPT 编辑质感的「去表头无外框左图右文卡片行」，并进一步弱化与收紧来源脚注及链接胶囊样式，同时保持无障碍语义与无客户端纯 Markdown 降级。

**Non-Goals:**

- 不引入外部黑/白名单网络服务或在线域名信誉 API（全部规则本地确定性运行、零网络额外延迟）。
- 不彻底硬删除水印图库候选（若某偏门查询确实只有图库结果时仍可作为最后兜底，但通过强负分确保只要存在任意非图库正常来源就绝不会被图库抢占）。
- 不省略工具返回的来源链接与许可状态元数据（仍保留真实来源与未确认许可说明，只通过提示词消除误解、通过客户端样式降低视觉噪音）。

## Decisions

### 1. 来源域名信誉与低质水文评分（[src/search/rank.ts](file:///d:/project/dsh-plugin-reply-with-images/src/search/rank.ts)）

在现有 `scores: { relevance, freshness, noise, prefix }` 中新增 `source` 分项（计入总分 `score` 并输出至 `search.ranked` 日志）：

- **水印商业图库与低质聚合站强降权（`-8`）**：
  - 匹配 `sourceUrl` 的 hostname（含子域）：`dreamstime.com`、`shutterstock.com`、`gettyimages.com`、`gettyimages.cn`、`alamy.com`、`istockphoto.com`、`123rf.com`、`depositphotos.com`、`vecteezy.com`、`stock.adobe.com`、`vcg.com`、`veer.com`、`quanjing.com`、`pinterest.com`、`pinterest.jp`、`clipartmax.com`、`pngtree.com`、`cleanpng.com`、`freepngimg.com`、`wallpapers.com`、`wallpaperaccess.com`、`wallpapercave.com`。
  - 强负分 `-8` 足以在同相关性（`12` 分）甚至略低相关性的场景下，把水印图库稳定压到正常百科/新闻/官网之后。
- **SEO 八卦内容农场标题/域名降权（`-5`）**：
  - 当查询本身未包含相关词时，若标题命中典型人物八卦/水文关键词（`religion`、`net worth`、`biography`、`bio`、`height`、`weight`、`wife`、`husband`、`salary`、`dating`、`ethnicity`、`nationality`、身高、体重、身价、净资产、宗教信仰）或域名含低质百科农场特征（如 `religion-info`、`celebs*`、`famousbirthdays`、`biographypedia`、`thefamouspeople`），扣除 `-5` 分。年龄仅匹配 `how old` 或 `age and height`、`age, wife` 等明确组合，不因 `Age of AI`、`Bronze Age` 中单独的 `age` 误扣分；查询主动请求的对应表达继续豁免。
- **权威百科、主流媒体与主体官网加权（`+3` ~ `+5`）**：
  - **主体官网动态匹配（`+5`）**：若 `query` 中长度 `>= 4` 的英文主体词元（如 `anthropic`、`nvidia`、`openai`、`tesla`、`claude`）恰好作为 `sourceUrl` 域名的主域标签出现（如 `anthropic.com`、`claude.com`、`nvidia.com`），给予 `+5` 官方一手来源加分；
  - **百科与开源图库（`+4`）**：`wikipedia.org`、`wikimedia.org`、`britannica.com`；
  - **主流新闻与权威科技/财经媒体（`+3`）**：`reuters.com`、`apnews.com`、`bbc.com`、`bbc.co.uk`、`abcnews.go.com`、`nytimes.com`、`wsj.com`、`ft.com`、`bloomberg.com`、`cnbc.com`、`cnn.com`、`theguardian.com`、`washingtonpost.com`、`techcrunch.com`、`theverge.com`、`wired.com`、`arstechnica.com`、`forbes.com`、`time.com`、`nature.com`、`science.org`、`nasa.gov`、`gov.cn`、`xinhuanet.com`、`caixin.com`、`36kr.com`、`ithome.com`、`github.com`。
  - 取上述正向匹配最高值并与负向惩罚叠加，确保「官网/百科/主流媒体 > 普通媒体 > SEO 水文 > 水印图库」。

### 2. 预算放宽与反“许可焦虑”提示重构

- **预算更新（[src/config.ts](file:///d:/project/dsh-plugin-reply-with-images/src/config.ts)、[src/replyImages.ts](file:///d:/project/dsh-plugin-reply-with-images/src/replyImages.ts)）**：
  - `maxSearchesPerTurn`：默认由 `6` 调至 `8`，上限由 `12` 调至 `16`；
  - `maxImagesPerTurn`：默认由 `8` 调至 `12`，上限由 `16` 调至 `20`；
  - `reply_images_prepare` 单次 `topics[]` 数量上限由 `5` 调至 `6`。
- **提示词与工具描述精修（[src/index.ts](file:///d:/project/dsh-plugin-reply-with-images/src/index.ts)、[src/tools.ts](file:///d:/project/dsh-plugin-reply-with-images/src/tools.ts)）**：
  - 明确写入反自我弃图规则：搜索引擎参考图默认带有 `License unconfirmed` 属正常现象，**不得仅因未确认许可就丢弃来自官网、百科或主流媒体的有效参考图**；仅当来源本身明显无关或为低质水印垃圾图时才跳过；
  - 明确给出「公司/人物/事件/产品长篇介绍」的推荐多章节配图蓝图（在预算内按章节自然规划 2–4 个互补区块：关键人物/实体/对比用 `table`、核心产品或事件用 `collage`、产品界面/现场多角度用 `strip`、独立亮点章节用 `single`），并继续明确跳过短答、代码、数学、抽象概念和纯文字请求。

### 3. 客户端人物目录表卡片化与极简来源视觉（[src/client/images.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/images.ts)、[src/client/styles.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/styles.ts)）

- **人物/实体目录表编辑级卡片样式**：
  - 首列含图且其余列不含图的表格共享紧凑栏宽和 3:4 肖像裁切基线，无论表头是否为通用占位词。首列桌面使用 `112px`，`480px` 及以下使用 `84px`，避免 `clamp()` 在表格列宽计算中按自动宽度处理而回退为对半分栏。多列含图对比表保留原等宽布局。
  - 针对首列含图且其余列不含图的目录表（如工具生成的 `| Image | Description | Source and license |` 或模型自建两列人物名录表）：
    - 去除生硬的外框盒子，仅保留干净的顶部/行间极细分隔线（`border-block-start`）；
    - 当 `thead` 仅包含通用占位表头（如 `Image` / `Description` / `Source and license` / `图片` / `说明` / `来源`）时，客户端为该 `<table>` 标注可逆 `data-reply-image-directory=""`，用无障碍视觉隐藏（`sr-only` 风格，对读屏器仍可读）收起生硬表头，让页面呈现为类似 ChatGPT 的「左 3:4 竖版肖像 + 右文字介绍 + 弱化来源列」流式人物卡片；该目录表使用 `position: relative` 为绝对定位的隐藏表头提供锚点；
    - 缩小第 3 列（来源列）字号与透明度（`12px`、`opacity: 0.68`），视觉主次分明；自定义业务对比表（多列含图或带具体业务表头）继续完整展示表头。
- **紧凑来源脚注胶囊化**：
  - 对 `[data-reply-image-caption]` 来源段落进一步弱化：次级小字号（`11.5px`）、柔和透明度（`0.65`）、链接呈现为极轻圆角胶囊背景（`padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, currentColor 8%, transparent)`），兼顾信息透明与干净版面。
  - 所有新增 DOM 属性（`data-reply-image-directory` 等）均通过 `setAttributes` 记录并在 `ctx.effect()` 卸载时 100% 还原。

## Risks / Trade-offs

- **[域名白/黑名单为静态启发式列表，无法穷尽所有站点]** → 采用「强降权已知图库/水文 + 温和加权已知权威域 + 动态匹配查询主体官网域」策略，未知普通网站得 `0` 分不受误伤，并通过 `search.ranked` 诊断日志透明输出 `scores.source` 便于持续迭代。
- **[提高默认预算至 8 搜 / 12 图可能增加多区块准备耗时]** → 单查询多图仅消耗 1 次搜索，保留每请求 `8s` 超时与 `AbortSignal` 取消，并保持单次 `reply_images_prepare` 汇总调用以减少模型往返轮次。
- **[视觉隐藏通用目录表头可能影响依赖表头文字的场景]** → 仅当 `thead` 所有列头均命中通用图片目录占位词（`Image`、`Description`、`Source and license`、`图片`、`人物`、`说明`、`来源`等）且为首列单图目录表时隐藏，且采用无障碍视觉隐藏方式（不移除 DOM），用户自定义对比表头不受影响。

## Migration Plan

- 完全向后兼容既有配置项、工具入参/出参结构、Web `#hash` 与 Desktop `alt+title` 双通道协议。
- 完成后依次执行 `npm run check`、更新 [scripts/clientPreview.ts](file:///d:/project/dsh-plugin-reply-with-images/scripts/clientPreview.ts) 预览校验、打包新 `.tgz` 安装到 DSH Desktop 并重启验收「介绍 Anthropic 这个公司」等真实多章节长答。
