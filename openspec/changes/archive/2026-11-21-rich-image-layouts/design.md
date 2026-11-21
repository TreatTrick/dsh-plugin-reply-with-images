## Context

`dsh-plugin-reply-with-images`（`v0.1.3`）已具备完整的 DeepSeek Harness (DSH) 双端插件骨架：Host 端基于 Cordis 注册系统提示、原生工具与鉴权媒体路由，图片经 `ctx.attachments.saveImage` 持久化（Web 走 `ctx.connection.fetch.register`，Desktop 走 `imageHostPath` 本地文件通道）；Web 客户端通过 `dsh.client` 与 `window.__ModuleLoader__.load` 零依赖加载，提供含图表格基础样式与单图 `<dialog>` 放大。

当前局限在于：

1. `reply_images_prepare` 固定每项 1 搜 1 图、最多 3 项，默认 `maxImagesPerTurn = 3`、`maxSearchesPerTurn = 3`，无法承载「表格名录 + 一大两小拼贴（3 图）+ 横向多图条（3–5 图）」的复合排版。
2. 单次搜索仅取 `found.images[0]`，下载失败即放弃该主题，多图组合时容易出现单张缺失或重复图。
3. 客户端仅识别 `table:has(img)` 与单图放大，缺少「一大两小拼贴」「横向多图条 + 溢出角标」及「组内多图灯箱翻页」。
4. DSH 插件规则要求：Host 工具不能重写 Assistant 消息块；全部注册需经 `ctx.effect()` 可逆清理；不得依赖未稳定的内部 UI 私有实现导致 Desktop 或无客户端场景不可读。

## Goals / Non-Goals

**Goals:**

- 支持至少三种语义清晰的富媒体图片布局：**表格样式（`table`）**、**一大两小拼贴（`collage`）**、**横向多图排列（`strip`）**，并保留普通单图（`single`）。
- 坚持**方案 B（标准 Markdown 载体 + 无害 URL Fragment + 零依赖 Web 客户端渐进增强）**，保证未加载 Web 客户端、Desktop 端或导出纯文本时仍可正常浏览图片与来源。
- 升级 `reply_images_prepare` 为组图友好且向后兼容的工具接口，支持「单查询取多图」与「多子查询组图」，内置候选顺延重试、按 `attachmentId` 去重与布局自动降级。
- 解耦每轮搜索预算与图片张数预算，提升多布局长答的可用性，同时保留用户配置覆写和严格安全限制（SSRF/DNS/大小/超时/取消/卸载排空）。
- 将 Web 客户端查看器升级为支持组内翻页、方向键导航与分页圆点的多图灯箱。

**Non-Goals:**

- 不接入 DSH 内部 `dsh-client-ui-slots` 自定义代码块（避免无客户端或 Desktop 退化为原始 JSON）。
- 不新增运行时第三方依赖，不修改 DSH 宿主源码或 Markdown 解析器。
- 不做 AI 生图、视觉内容识别（VLM 审图）或替模型自动拦截修改最终文本流。
- 不破坏现有 `reply_image_search`、`reply_images_embed` 以及旧版 `reply_images_prepare({ topics: [{ topic, query, alt }] })` 调用契约。

## Decisions

### 1. 布局传递协议：标准 Markdown + HTTP(S) URL Fragment（方案 B）

- **载体约定**：
  - `table`：继续采用标准 Markdown 表格（人物名录首列为图、对比表多列含图），由工具返回整段即贴即用的表格 Markdown 及逐项 `tableMarkdown`。
  - `collage`（一大两小）与 `strip`（横向多图）：工具将同组图片输出在**同一 Markdown 段落内**（空格分隔，避免 `\n\n` 把图片拆成多个 `<p>`），紧接着在下一段落输出**一条汇总的来源与许可脚注**。
  - **布局标记**：仅当图片目标地址为 HTTP(S) URL（即 Web 端 `mediaUrl`）时，在 URL 末尾追加标准 Fragment：`#dsh-layout=collage&group=<id>` 或 `#dsh-layout=strip&group=<id>`。
- **为什么选择 URL Fragment 而不是自定义代码块 / `title` 属性 / 查询参数**：
  - HTTP 请求不会把 `#fragment` 发送给服务端，`createMediaResource` 的 URL 参数校验和缓存键（`Cache-Control: immutable`）完全不受影响；
  - 浏览器 DOM 中的 `img.src` 完整保留 `#fragment`，客户端可零歧义解析出布局类型与分组 ID，不会误伤正文里其它普通连续图片；
  - 相比 `title` 属性，不会在鼠标悬停时弹出无意义的内部标记 tooltip；
  - 相比自定义代码块（方案 A），在无 Web 客户端、旧版宿主、纯文本导出或流式半成品阶段天然降级为标准图片；
  - **Desktop 端安全边界**：Desktop 端 `imageDestination` 返回编码后的本地文件路径（非 `http(s):`），为其跳过 `#dsh-layout` 附加，确保原生文件图片通道零回归。

### 2. 工具 Schema 与多图组准备：`reply_images_prepare` 兼容扩展

在保留现有 `topics[]` 数组名与旧字段（`topic`、`query`、`alt`）的前提下，向后兼容地扩展每个元素：

```ts
interface ImageTopicItem {
  query: string
  alt: string
  caption?: string // 可选简短说明，用于 table 文本列或灯箱补充
}

interface ImageTopic {
  topic: string
  layout?: 'single' | 'table' | 'collage' | 'strip' // 默认 'single'
  query?: string // 单查询模式（与 items 二选一）
  alt?: string // 单查询模式 alt
  count?: number // 单查询取图张数：1–5（默认 single=1, collage=3, strip=3）
  items?: ImageTopicItem[] // 多子查询模式：1–5 项（如人物表多人、一大两小 3 个独立场景）
}
```

- **单次调用上限**：放宽为 `1–5` 个主题组，总搜索数与总目标图片数均在网络请求前通过 `CandidateStore.reservePreparation(scope, searchCount, imageCount, searchLimit, imageLimit)` **原子预留**。
- **搜索与出图解耦**：
  - 单查询多图（如 `layout: 'strip', query: 'Jensen Huang Trump White House', count: 4`）仅消耗 **1 次搜索预算** + **4 张图片预算**；
  - 多子查询组图（如 `layout: 'collage', items: [hero, sub1, sub2]`）消耗 **3 次搜索预算** + **3 张图片预算**。
- **候选顺延重试与内容去重**：
  - 单次搜索返回最多 `maxCandidates` 个候选（默认提升至 `10`）。
  - 下载阶段按顺序遍历候选列表：遇到下载失败、不支持格式、超字节限制或与本轮/本组已保存图片**相同 `attachmentId`（SHA-256 去重）**时，自动尝试下一个候选，直到凑满目标张数或候选耗尽。
- **自动降级策略**：
  - `collage` 目标 3 张：实际成功 3 张 → 输出 `#dsh-layout=collage`；仅成功 2 张 → 降级输出 `#dsh-layout=strip`（避免三格拼贴缺角）；仅成功 1 张 → 降级为普通单图 Markdown（不带布局 fragment）；0 张 → 仅输出警告。
  - `strip` 目标 2–5 张：实际成功 ≥ 2 张 → 输出 `#dsh-layout=strip`；仅成功 1 张 → 降级为普通单图 Markdown。
  - `table`：为每个成功项输出表格行（含 `tableMarkdown`），失败项记录警告而不阻塞其余行。

### 3. 默认预算调整

- `maxImagesPerTurn`：默认由 `3` 调整为 `8`，配置上限由 `8` 调整为 `16`。
- `maxSearchesPerTurn`：默认由 `3` 调整为 `6`，配置上限由 `10` 调整为 `12`。
- `maxCandidates`：默认由 `6` 调整为 `10`，配置上限保持 `20`。
- 用户已有自定义配置继续生效并受校验边界保护。

### 4. Web 客户端渐进增强与多图灯箱

全部逻辑保留在零依赖的 [src/client/images.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/images.ts) 与 [src/client/styles.ts](file:///d:/project/dsh-plugin-reply-with-images/src/client/styles.ts) 中，严格限定在 `[data-chat-group-part="response"]` 内，所有写入的属性与节点均记录原值并在 `ctx.effect()` 清理时完整还原。

1. **表格样式精修（`table:has(img)`）**：
   - 首列单图人物/实体目录表：首列图片使用稳定紧凑宽高比（`aspect-ratio: 3 / 4`、`object-fit: cover`、`object-position: center 20%` 优先保留人脸头部构图），圆角 `8px`。
   - 多列对比表：各列等宽、`object-fit: cover`、响应式防溢出。
2. **一大两小拼贴（`[data-reply-image-group="collage"]`）**：
   - 客户端扫描包含 `>= 2` 张带有 `#dsh-layout=collage`（且共享同 `group` 或连续排列）图片的 `<p>` 容器，标记 `data-reply-image-group="collage"` 与 `data-reply-image-count`。
   - 3 图桌面端采用 CSS Grid：`grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)`、`grid-template-rows: repeat(2, minmax(0, 1fr))`，首图 `grid-row: 1 / 3` 跨两行，整体圆角裁切（`border-radius: 12px; overflow: hidden; gap: 4px`），图片 `width: 100%; height: 100%; object-fit: cover; object-position: center 25%`。
   - 窄屏（`<= 480px`）自动切为「首图跨两列在上 + 两小图并排在下」。
   - 2 图自动呈现等宽双栏；单图或加载失败时清理标记回退普通展示。
3. **横向多图条（`[data-reply-image-group="strip"]`）**：
   - 客户端扫描带有 `#dsh-layout=strip` 的多图 `<p>` 容器，标记 `data-reply-image-group="strip"` 与 `data-reply-image-count`。
   - 默认以等高圆角卡片横向排列（最多显示 3 张可见缩略图，单卡 `aspect-ratio: 5 / 4`、`object-fit: cover`、`border-radius: 10px`、`gap: 8px`）。
   - 当组内图片数 `> 3` 时，第 4 张及以后在行内态隐藏（通过可逆 `data-reply-image-overflow` 属性控制），并在容器内注入一个可逆的计数角标按钮（如显示总数 `4` / `+1`，样式呼应 ChatGPT 图集角标），点击角标或任意可见图均可直接拉起完整组内灯箱。
4. **组内多图灯箱（`<dialog class="reply-images-viewer">`）**：
   - 从单图放大扩展为**同组图片浏览**：触发任意图时收集其所属图片组（同一 `collage`、`strip` 或同一 `table` 中的全部有效已加载图片）及当前索引。
   - 多于 1 张时展示上一张/下一张按钮、底部分页圆点指示器与 `i / N` 序号，并支持 `ArrowLeft` / `ArrowRight` 键盘切图、点击圆点跳转。
   - 维持现有无障碍契约：`Escape` / 关闭按钮 / 背景点击关闭，关闭后焦点回到触发图片；单图点击时不显示多余翻页控件。

### 5. 模型触发判断与克制原则

更新 [src/index.ts](file:///d:/project/dsh-plugin-reply-with-images/src/index.ts) 的 `systemPrompt` 与 [src/tools.ts](file:///d:/project/dsh-plugin-reply-with-images/src/tools.ts) 的工具描述：

- **先判价值，再选版式**：仅当实拍/参考图片能明显帮助读者辨识人物、地点、事件、实物或视觉差异时调用；短答、纯代码、数学推导、抽象概念与纯文字请求必须跳过。
- **语义到版式映射**：
  - 人物/实体介绍或属性对比 → `table`
  - 复杂事件/专题的多维度视觉补充（1 核心场景 + 2 关联画面）→ `collage`
  - 同一主题的多瞬间/多角度图集 → `strip`
  - 独立段落单点配图 → `single`
- 长篇多章节综述鼓励根据章节语义组合使用不同版式，避免全篇千篇一律只贴单图，同时明确禁止为凑齐张数插入无关图片。

## Risks / Trade-offs

- **[宿主 Markdown 渲染器可能修改或剥离 URL Fragment]** → 实际部署到目标 DSH 版本时需在浏览器中实测验证 `img.src` 是否保留 `#dsh-layout=`；同时客户端解析同时检查 `image.getAttribute('src')` 与 `image.src`，并在无匹配时优雅保留普通图片显示，不会白屏或报错。
- **[宿主 Markdown 渲染器可能把多图包在独立节点而非直接子元素]** → 客户端识别逻辑向上定位最近的段落级块容器（`p`）并收集其后代有效 `img`，处理 `img` 直接位于 `<p>` 或被轻量内联包装器（如 `span`）包裹的场景；同时避免跨段落误合并。
- **[单轮图片预算提高带来更长准备耗时]** → 保留单请求超时（8s）、单图字节上限（5MB）与 `AbortSignal` 随时中断；单查询多图减少搜索请求次数，仅串行下载实际需要的图片并在候选失败时有界顺延。
- **[搜索结果构图不一导致裁切人脸或主题偏离]** → CSS 对人物表格与拼贴/横排图默认采用 `object-position: center 20%` / `center 25%` 减少裁头风险；Host 端按 `attachmentId` 去重防止重复图；保留 `reply_image_search` + `reply_images_embed` 供需要精细比选标题的场景。
- **[横向溢出角标需要向 DOM 插入辅助节点]** → 严格记录所有注入的角标 DOM 节点与修改过的元素属性，在 `MutationObserver` 失效或 `ctx.effect()` 卸载时 100% 移除还原，不破坏宿主 React 虚拟 DOM 对原始 `<p>` / `<img>` 节点的管理（角标优先挂载或通过非破坏方式附着并做好变更重算）。

## Migration Plan

- **完全向后兼容**：保留现有工具名、媒体路由 `/api/reply-images`、附件存储格式及旧版 `reply_images_prepare` 简写参数；历史对话中的旧 Markdown 图片继续由客户端正常放大查看。
- **验证链路**：依次通过 `npm run check`（格式化、严格类型检查、Vitest 覆盖率测试、tsdown 构建、`checkClientBundle` 校验）及 `npm run preview:client` 本地可视化验收三种布局与灯箱交互，随后在真实 DSH Web 与 Desktop 环境中验收端到端模型配图与冷重启回看。
