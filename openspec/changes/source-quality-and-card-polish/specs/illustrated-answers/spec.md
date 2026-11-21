## ADDED Requirements

### Requirement: 来源域名信誉排序与低质图源降权

候选相关性排序 MUST 在查询词匹配度、年份时效性与噪声词过滤之外，综合评估 `sourceUrl` 域名质量与 SEO 八卦水文特征，并将 `source` 分项写入 `search.ranked` 诊断日志：

1. 对商业水印图库（如 `dreamstime.com`、`shutterstock.com`、`gettyimages.com`、`alamy.com`、`istockphoto.com`、`123rf.com`、`depositphotos.com`、`vecteezy.com`、`pinterest.com`、`wallpapers.com` 等）施加强负分，确保在存在正常来源候选时不被水印图库抢占；
2. 当查询本身未请求相关内容时，对典型人物八卦/SEO 内容农场标题（如 `religion`、`net worth`、`height`、`wife`、`biography` 等）与已知低质农场域名施加负分；
3. 对与查询主体词匹配的官方域名（如查询含 `Anthropic` 时命中 `anthropic.com`）、权威百科（`wikipedia.org`、`wikimedia.org`）与主流新闻/科技媒体（如 `reuters.com`、`abcnews.go.com`、`bbc.com`、`nytimes.com`、`bloomberg.com`、`techcrunch.com`、`theverge.com`、`wired.com` 等）施加正分，使高质量权威来源在同相关性下稳定排在前面。

#### Scenario: 维基百科官方图稳定击败水印图库

- **WHEN** 查询 `"Anthropic logo"` 同时返回 `dreamstime.com` 手机拍图与 `zh.wikipedia.org` 官方 Logo 候选且标题匹配度相同
- **THEN** 排序结果将 `zh.wikipedia.org` 排在 `dreamstime.com` 之前，`search.ranked` 日志记录两者的 `source` 分项差异

#### Scenario: 主流媒体人物肖像稳定击败八卦内容农场

- **WHEN** 查询 `"Dario Amodei"` 同时返回含 `Religion: Jewish Heritage` 的内容农场博客与 `abcnews.go.com` 新闻人物报道候选
- **THEN** 排序结果将 `abcnews.go.com` 排在内容农场候选之前

#### Scenario: 查询主体命中官方域名获得最高来源加权

- **WHEN** 查询 `"Claude Code interface"` 返回来自 `claude.com` 或 `anthropic.com` 的候选与其他普通博客候选且标题相关性接近
- **THEN** 官方域名候选获得正向 `source` 加分并排在普通博客之前

#### Scenario: 科技和历史报道中的 age 不触发八卦降权

- **WHEN** 权威媒体标题包含 `Entering the Age of AI`、`Golden Age of AI` 或 `Bronze Age`，且未命中其他非请求的八卦特征
- **THEN** 候选保留正常来源加分，不因单独的 `age` 扣分；`how old`、`age and height` 等明确八卦表达仍在未被查询请求时降权

## MODIFIED Requirements

### Requirement: 自动识别适合插图的回答

当 automatic 配置开启时，系统提示 MUST 明确引导模型在较长的人物、公司或组织、新闻或事件、商品、地点、自然主题和视觉比较回答中积极调用 `reply_images_prepare`，按章节内容规划 2–4 个互补的图片版式区块（关键人物、创始团队、实体或对比章节优先使用 `table`；复杂事件或核心产品使用 `collage` 一大两小拼贴；产品界面、现场或多角度画面使用 `strip` 横向排列；独立段落亮点使用 `single`），将每组成功结果原样插入对应章节之后，不得将所有主题堆砌在开头单一区块。系统提示 MUST 明确声明：搜索引擎参考图默认显示 `License unconfirmed` 属于正常现象，不得仅因未确认许可就丢弃来自官网、百科或主流媒体的有效参考图；涉及争议的非公开私人人物仅跳过该私人未核实照片，不得连带放弃同事件中公开人物与机构的 `table` 展示。短答、代码、数学推理、抽象主题和纯文字请求 MUST 继续被指导为跳过配图。配置关闭时 MUST 继续只在用户明确要求图片时使用图片工具。

#### Scenario: 长篇公司介绍按章节规划多版式且不因未确认许可弃图

- **WHEN** 用户要求介绍一家知名科技公司（如 Anthropic），且 automatic 已开启，工具返回来自官网、维基百科或主流媒体且许可状态为 `License unconfirmed` 的参考图
- **THEN** 系统提示引导模型按章节组合规划创始团队 `table`、核心产品 `collage` 与产品/场景 `strip` 等区块，并明确禁止仅因 `License unconfirmed` 丢弃有效参考图

#### Scenario: 只有一个相关视觉主体时降级

- **WHEN** 用户要求的长答只有一个适合展示的视觉主体，或剩余预算不足以支持多组图片
- **THEN** 模型可以准备单个主题或单张图片，并继续完成文字回答

#### Scenario: 纯文字、短答或抽象主题

- **WHEN** 用户要求短答、纯文字回答，或咨询代码、数学推理及抽象概念
- **THEN** 模型收到跳过装饰性配图的指导

#### Scenario: 用户关闭自动配图

- **WHEN** automatic 已关闭且用户没有要求图片
- **THEN** 系统提示禁止主动调用自动和分步图片工具

### Requirement: 单次调用准备主题配图

系统 MUST 提供 `reply_images_prepare`，支持模型在一次调用中提交 1–6 个有序图片区块（`topics[]`），每个区块可声明布局类型 `layout`（`single`、`table`、`collage`、`strip`，默认为 `single`），并支持向后兼容的单查询模式（`query`、`alt` 及可选多图张数 `count`）以及多子查询模式（`items[]`）。工具 MUST 按单轮剩余搜索预算与剩余图片预算分别原子预留整批需求（单查询取多图仅消耗一次搜索预算及对应张数图片预算），在单次搜索内结合来源信誉排序依次尝试候选、跳过低质尺寸/比例或重复 `attachmentId` 候选并顺延回退，沿用现有安全 Provider、附件持久化能力及取消/卸载排空契约。当 `table` 区块中部分子项失败但至少有一项成功时，生成的表格 MUST 为失败项保留文字占位行而不丢失该实体说明。每个区块 MUST 独立返回布局类型、对应章节 `placement` 插入提示、可直接插入正文的 `markdown`、供表格单元格使用的 `tableMarkdown`、图片元数据数组及独立警告。原有 `reply_image_search` 和 `reply_images_embed` MUST 继续可用。

#### Scenario: 一次调用准备最多六个布局区块

- **WHEN** 模型提交 1–6 个包含 `table`、`collage`、`strip` 与 `single` 的合法区块且未超剩余搜索与图片预算
- **THEN** 工具在网络请求前分别预留搜索预算与图片预算，按序完成搜索、排序、容错下载与去重持久化，并为每个区块返回可直接插入正文的布局 Markdown、统一来源说明及对应 `placement`

#### Scenario: 表格区块部分人物无图时保留文字占位行

- **WHEN** `layout: "table"` 提交多个 `items`，其中一项搜图或下载失败而其余项成功
- **THEN** 工具生成的 Markdown 表格保留成功项的图片行，并为失败项输出文字占位行同时在 `warnings` 中记录失败原因

#### Scenario: 区块数超过上限或预算超额

- **WHEN** 提交超过 6 个区块，或总搜索数超过剩余搜索预算，或总目标图片数超过剩余图片预算
- **THEN** 工具拒绝超额输入且不得在网络或附件服务上执行超额工作

#### Scenario: 向后兼容旧版单图主题入参

- **WHEN** 模型仅提交旧版 `{ topic, query, alt }` 而不提供 `layout`、`count` 或 `items`
- **THEN** 工具按 `layout: "single"` 且目标 1 张图执行，并保持原有输出字段完整可用

#### Scenario: 插件卸载或请求取消

- **WHEN** 图片准备期间当前轮取消或插件开始卸载
- **THEN** 网络工作停止并按现有附件写入排空契约结束

### Requirement: 客户端图片表格与查看器增强

启用插件 Web/Desktop 客户端入口时，DSH MUST 在 `[data-chat-group-part="response"]` 范围内以零外部依赖、可逆 `ctx.effect()` 方式增强图片卡片布局、来源呈现与查看器：

1. **双通道与真实 DOM 适配**：兼容 DSH 44.7+ 的 `_image_*` 类名与 `_imageButton_*` 原生图片按钮，支持从 `src` `#hash`、`title`、不可见 `alt` 零宽标记及紧跟来源脚注的纯多图段落识别布局；
2. **人物/实体目录表卡片化**：对首列含图且其余列不含图的目录表，采用去外框、仅保留细行分隔线与左 3:4 圆角竖照（优先保留上部人物构图）的编辑级卡片样式；当表头仅为通用占位列头（如 `Image` / `Description` / `Source and license`）时，以可逆 `data-reply-image-directory` 属性对表头进行无障碍视觉隐藏（保留读屏器语义）并弱化末列来源字号；多列对比表与自定义业务表头保持完整表头显示；
3. **一大两小拼贴与横向多图条**：识别 `collage` 3 图段落呈现为桌面左大图跨两行 + 右两小图上下堆叠（窄屏上大图下两小图），2 图呈现等宽双栏；识别 `strip` 多图段落呈现为等高圆角横向缩略图条，超过 3 张时隐藏溢出图并展示可点击计数角标；
4. **极简紧凑来源脚注与单图约束**：自动识别图片与图集下方的来源脚注段落（`*Image source(s): ...*` / `*图片来源：...*`）并以小号低对比度紧凑样式与轻量胶囊链接呈现；普通正文单图限制舒适最大高度并保持圆角；
5. **组内多图查看器**：点击或键盘激活任意普通 Markdown 图片或多图组内原生图片按钮时，多图组打开支持上一张/下一张按钮、`ArrowLeft`/`ArrowRight` 键盘切换与分页圆点的 `<dialog>` 查看器，剥离 `alt` 内部零宽标记，支持 `Escape` 与关闭按钮并恢复焦点。
   图片加载失败 MUST 保留 Markdown renderer 的可读错误/alt 回退。插件卸载时 MUST 彻底清理样式、监听、角标、诊断接口、打开的弹窗及临时属性。未加载客户端入口时，原回答 MUST 仍以普通 Markdown 图片和表格展示。

#### Scenario: 首列人物目录表呈现为无外框去表头卡片

- **WHEN** 客户端已加载且回答包含首列含图、表头为 `Image | Description | Source and license` 的人物目录表
- **THEN** 客户端为表格标注可逆 `data-reply-image-directory` 属性，视觉隐藏通用表头（保留无障碍语义），呈现左 3:4 圆角肖像 + 右文字介绍 + 弱化来源列的流式卡片，卸载后移除该属性

#### Scenario: 多列含图对比表格保留完整表头

- **WHEN** 客户端已加载且回答包含多列含图对比表，包含带具体业务列头（如 `OpenAI | Anthropic`）的对比表格
- **THEN** 客户端不隐藏该表格的表头，保持等宽对比列布局

#### Scenario: 自定义业务表头的首列图文表保留紧凑图片栏

- **WHEN** 回答表格仅首列含图，其余列不含图，且使用 `创始人 | 职位与背景` 或 `主题 | 观察要点与来源` 等自定义业务表头
- **THEN** 客户端保留完整表头，并采用紧凑首列与 3:4 肖像裁切；桌面首列为 `112px`，`480px` 及以下为 `84px`，不得回退为对半分栏

#### Scenario: 来源脚注行以极简紧凑胶囊链接呈现

- **WHEN** 客户端已加载且图片或图集下方紧跟 `*Image source(s): ...*` 或 `*图片来源：...*` 脚注段落
- **THEN** 客户端标注 `data-reply-image-caption` 并以小字号弱对比度与轻量圆角链接胶囊渲染，卸载后完全还原

#### Scenario: 拼贴、横向多图条与组内多图灯箱完整可用

- **WHEN** 客户端在 Desktop 或 Web 环境中渲染 `collage` 3 图或 `strip` 4 图（含 DSH `_imageButton_*` 包装器）
- **THEN** 桌面端呈现一大两小网格或三图横排加 `4` 角标，点击任意图或角标拉起组内多图 `<dialog>` 并支持左右切换与分页圆点

### Requirement: 默认预算与逐图回退

系统 MUST 将默认每轮图片搜索预算设为 `8`（可配置上限 `16`）、默认每轮图片展示预算设为 `12`（可配置上限 `20`）、默认每次搜索候选数设为 `10`（可配置上限 `20`），并继续接受用户有效的配置覆写。无结果、预算不足和逐图存储错误 MUST 允许模型完成有用的文字回答，并提供说明失败原因的工具结果。

#### Scenario: 默认多章节配图预算

- **WHEN** 插件以默认配置加载
- **THEN** 单轮默认允许最多 8 次图片搜索、最多 12 张展示图片，每次搜索默认保留最多 10 个候选

#### Scenario: 用户自定义较小或较大有效预算

- **WHEN** 配置将 `maxImagesPerTurn` 或 `maxSearchesPerTurn` 覆写为合法范围内的自定义值
- **THEN** 工具预算校验和系统提示均遵从配置值

#### Scenario: 全部图源不可用

- **WHEN** 所有当前 Provider 均失败或找不到可用候选
- **THEN** 工具返回有界警告，模型能够继续提交无图文本回答
