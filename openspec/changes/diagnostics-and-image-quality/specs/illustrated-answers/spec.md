## ADDED Requirements

### Requirement: 默认图源优先级与候选相关性筛选

系统 MUST 将默认图源顺序设为 `['bing', 'so360', 'baidu', 'wikimedia']`（仍允许用户配置覆写），使实时新闻与现代人物/场景图源优先于静态百科图库；HTTP 客户端 MUST 发送标准桌面浏览器 `User-Agent` 与 `Accept-Language` 请求头；`baidu` 解析器 MUST 妥善处理反爬或缺失 `data` 数组的异常响应并输出简洁单行诊断错误。系统 MUST 在下载前对候选列表执行基于查询词匹配度、年份时效性及无关水印/图标词惩罚的相关性排序，并在写入附件库前通过轻量二进制头部解析过滤极小缩略图（宽 `< 120px` 或高 `< 80px`）与极端长宽比异形图（`> 4.5` 或 `< 0.22`），顺延尝试后续可用候选。

#### Scenario: 热点新闻查询优先命中现代新闻图源并过滤无关老图

- **WHEN** 插件以默认配置搜索包含近期年份或热点人物/事件的主题
- **THEN** 搜索优先查询 `bing` 等现代图源，相关性排序优先选择标题匹配主题词与年份的候选，并降低含无关噪声词（如 `logo`、`icon`、`watermark`）或明显过时年份候选的权重

#### Scenario: Baidu 返回反爬或无 data 载荷时安全降级

- **WHEN** `baidu` 返回不含 `data` 数组的 JSON 响应（如反爬提示）
- **THEN** 解析器返回简洁可读的单行失败诊断而不暴露多行底层 Schema 异常，搜索继续尝试剩余 Provider

#### Scenario: 下载到极小图标或极端横幅时自动跳过顺延

- **WHEN** 某候选图片二进制头部解析出尺寸小于 `120×80` 或长宽比超过 `4.5`
- **THEN** 工具跳过该候选且不写入附件存储，记录跳过原因并顺延尝试下一个候选

## MODIFIED Requirements

### Requirement: 自动识别适合插图的回答

当 automatic 配置开启时，系统提示 MUST 明确引导模型在较长的人物、组织、新闻或事件、商品、地点、自然主题和视觉比较回答中积极使用 `reply_images_prepare` 规划多个互补的图片版式区块（人物或公开实体目录与属性对比使用 `table`，单一复杂事件或专题的多维度补充使用 `collage` 一大两小拼贴，同一主题的多瞬间或多角度展示使用 `strip` 横向排列，独立段落配图使用 `single`），明确要求长篇多章节回答不要因保守退缩为仅贴一两张单图或放弃插图，并要求原样粘贴各主题返回的 `topic.markdown`（保留图片链接、标题标记与来源行）。对于涉及争议的非公开私人人物，指导 MUST 说明只需跳过该私人的未核实照片，不得因此连带放弃同事件中公开人物、机构或现场场景的配图。短答、代码、数学推导、抽象主题和纯文字请求 MUST 继续被指导为跳过配图。配置关闭时 MUST 继续只在用户明确要求图片时使用图片工具。

#### Scenario: 长篇热点新闻综述组合多种公开版式

- **WHEN** 用户要求详细介绍一位公众人物及相关复杂新闻事件，且 automatic 已开启
- **THEN** 系统提示明确引导模型单次规划公开人物 `table`、核心事件 `collage` 与现场/多角度 `strip` 等互补版式，仅跳过未经核实的私人照片，并原样插入各章节对应的 `topic.markdown`

#### Scenario: 只有一个相关视觉主体时降级

- **WHEN** 用户要求的长答只有一个适合展示的视觉主体，或剩余预算不足以支持多组图片
- **THEN** 模型可以准备单个主题或单张图片，并继续完成文字回答

#### Scenario: 纯文字、短答或抽象主题

- **WHEN** 用户要求短答、纯文字回答，或咨询代码、数学推理及抽象概念
- **THEN** 模型收到跳过装饰性配图的指导

#### Scenario: 用户关闭自动配图

- **WHEN** automatic 已关闭且用户没有要求图片
- **THEN** 系统提示禁止主动调用自动和分步图片工具

### Requirement: 图片分组可读且有来源说明

当回答包含人物/实体目录、视觉对比、一大两小拼贴或横向多图条时，工具输出的 Markdown MUST 保持标准 Markdown 可读性：表格布局继续使用标准 Markdown 含图表格；`collage` 与 `strip` 布局 MUST 将同组图片排布在同一标准 Markdown 段落内，并在紧随其后的脚注行汇总列出所有图片的来源、作者与许可说明。对于 Web 端 HTTP(S) 媒体链接，工具 MUST 在 URL 末尾附加无害的布局片段标识（`#dsh-layout=collage&group=...` 或 `#dsh-layout=strip&group=...`）；对于 Desktop 端本地文件路径等非 HTTP(S) 目标，工具 MUST 保持文件路径本身纯净不附加 `#fragment`，并改用标准 Markdown 图片标题属性（`"dsh-layout=collage&group=..."` 或 `"dsh-layout=strip&group=..."`）传递同组布局元数据。每张图片 MUST 保留准确 alt 文本及工具返回的来源与许可信息，不得将未知许可描述为可再发布许可，也不得将未经核实的图片描述为所涉人物或不当行为的证据。

#### Scenario: Web 端拼贴与横向图集使用 URL Fragment

- **WHEN** 工具生成 `collage` 或 `strip` 区块的 Markdown 且目标地址为 Web 端 HTTP(S) 媒体 URL
- **THEN** 同组图片位于同一段落并携带 `#dsh-layout=` 与 `group` 片段标识，紧随其后提供汇总来源与许可脚注；未加载客户端增强时仍可直接渲染全部图片与出处

#### Scenario: Desktop 端本地图片路径纯净且通过 title 传递布局标记

- **WHEN** 插件运行在 Desktop profile 并通过 `imageDestination` 生成本地图片路径，且布局为 `collage` 或 `strip`
- **THEN** Markdown 图片目标路径不附加 `#dsh-layout=` 片段以保证原生文件通道正常加载，同时通过标准 Markdown 图片 `title` 属性携带 `dsh-layout=<layout>&group=<id>` 供客户端识别

#### Scenario: 人物目录与并列图片组

- **WHEN** 模型创建人物目录或视觉对比并将图片放入标准 Markdown 表格
- **THEN** 每个图片组在原 Markdown 中仍与相邻的名称、说明和来源对应

#### Scenario: 结果未能验证图片身份或许可证

- **WHEN** Provider 仅返回标题和来源，或许可状态未知
- **THEN** 输出不得声称已检查图片内容或存在再发布许可，并继续显示现有的许可证状态文字

### Requirement: 客户端图片表格与查看器增强

启用插件 Web/Desktop 客户端入口时，DSH MUST 在 `[data-chat-group-part="response"]` 范围内以零外部依赖、可逆 `ctx.effect()` 方式增强图片布局、来源脚注与查看器：

1. **双通道布局识别**：同时识别 `img` 的 `src` `#dsh-layout=` 片段与原始 `title` 中的 `dsh-layout=<collage|strip>&group=<id>`（缓存至 `WeakMap` 后以可读 `View image: <alt>` 替换 `title`，避免悬停暴露内部标记）；
2. **表格与正文单图精修**：将含图 Markdown 表格呈现为轻边框响应式人物目录行（首列紧凑 3:4 圆角肖像并优先保留上部人物构图）或等宽多列比较组；将普通正文单图限制在舒适可视高度并呈现圆角；
3. **一大两小拼贴与横向多图条**：识别 `collage` 3 图段落呈现为桌面左大图跨两行 + 右两小图上下堆叠（窄屏上大图下两小图），2 图呈现等宽双栏；识别 `strip` 多图段落呈现为等高圆角横向缩略图条，超过 3 张时隐藏溢出图并展示可点击计数角标；
4. **紧凑来源脚注条**：自动识别紧随含图段落或图集之后的纯斜体来源说明行（匹配 `Image source:` / `Image sources:` / `图片来源：`），以小字号、去斜体、弱对比度的紧凑样式呈现并保留链接可点击性；
5. **组内多图查看器**：点击或键盘激活任意普通 Markdown 图片打开 `<dialog>` 查看器，多图组支持上一张/下一张按钮、`ArrowLeft`/`ArrowRight` 切换与分页圆点，支持 `Escape` 和关闭按钮并恢复焦点。
   图片加载失败 MUST 保留 Markdown renderer 的可读错误/alt 回退。插件卸载时 MUST 彻底清理样式、监听、角标、诊断接口、打开的弹窗及临时属性。未加载客户端入口时，原回答 MUST 仍以普通 Markdown 图片和表格展示。

#### Scenario: Desktop 端通过 title 标记成功渲染拼贴与横向图集且无内部标记 tooltip

- **WHEN** 客户端在 Desktop 环境中加载且同段落 3 张图片通过 `title="dsh-layout=collage&group=g1"` 标记（`src` 不含 `#hash`）
- **THEN** 客户端将其渲染为一大两小拼贴网格，并将图片 `title` 替换为无障碍说明 `View image: ...`，卸载后还原原始 `title`

#### Scenario: 紧凑来源脚注条美化

- **WHEN** 客户端已加载且含图段落或图集下方紧跟 `*Image source: ...*`、`*Image sources: ...*` 或 `*图片来源：...*` 脚注段落
- **THEN** 客户端为该脚注行标注可逆 `data-reply-image-caption` 属性并以小字号紧凑弱化样式呈现，卸载后移除该属性

#### Scenario: 横向多图条与超量计数角标及组内灯箱切换

- **WHEN** 客户端已加载且回答包含 4 张带 `strip` 标记的有效图片，用户点击角标或任意图片
- **THEN** 行内显示前 3 张并叠标总数 `4`，查看器打开并支持上一张/下一张按钮、`ArrowLeft`/`ArrowRight` 键盘切换与分页圆点，按 `Escape` 返回触发元素焦点

#### Scenario: 插件卸载或客户端未启用

- **WHEN** 插件客户端卸载、图片 URL 不可用或 DSH 客户端增强未加载
- **THEN** 卸载后不残留临时属性、角标、样式、全局调试对象或弹窗；图片错误仍由 Markdown 回退处理
