## 1. 来源域名信誉排序与水文降权

- [x] 1.1 更新 `src/search/rank.ts`：新增 `source` 评分项——对水印图库域名（`dreamstime`、`shutterstock`、`gettyimages`、`alamy`、`istockphoto`、`123rf`、`depositphotos`、`vecteezy`、`pinterest`、`wallpapers.com` 等）扣 `-8` 分，对非请求的 SEO 八卦水文标题/域名扣 `-5` 分，对匹配查询主体词的官方域名加 `+5` 分、百科域加 `+4` 分、主流新闻与科技媒体加 `+3` 分，并将 `source` 分项输出至 `scores` 以同步记录到 `search.ranked` 诊断日志。
- [x] 1.2 扩展 `tests/search/rank.spec.ts`：覆盖 Wikipedia 击败 `dreamstime`、ABC News 击败 `religion-info` 内容农场、查询主体命中官方域加权，以及查询主动包含关键词时不误惩罚的场景。

## 2. 预算放宽与反“许可焦虑”提示重构

- [x] 2.1 更新 `src/config.ts`：将 `maxSearchesPerTurn` 默认调至 `8`（上限 `16`）、`maxImagesPerTurn` 默认调至 `12`（上限 `20`），同步更新 Schemastery 描述与 `tests/config.spec.ts`。
- [x] 2.2 更新 `src/replyImages.ts` 与 `src/tools.ts`：将 `reply_images_prepare` 单次 `topics[]` 上限放宽至 `1–6` 个区块，更新入参校验与工具描述。
- [x] 2.3 更新 `src/index.ts` 系统提示：明确声明 `License unconfirmed` 是搜索引擎参考图的正常状态、禁止仅因未确认许可丢弃来自官网/百科/主流媒体的有效参考图；给出公司/人物/事件多章节配图蓝图（2–4 个互补区块：`table` + `collage` + `strip` + 可选 `single`），并同步更新 `tests/plugin.spec.ts` 与 `tests/prepare.spec.ts`。

## 3. 客户端人物目录卡片化与极简来源视觉

- [x] 3.1 更新 `src/client/images.ts`：扫描 `[data-chat-group-part="response"]` 内的含图表格，识别首列单图目录表且表头仅为通用占位词（如 `Image` / `Description` / `Source and license` / `图片` / `人物` / `说明` / `来源`）的表格，标注可逆 `data-reply-image-directory=""` 属性并在插件卸载或内容变化时完整清理。
- [x] 3.2 更新 `src/client/styles.ts`：将 `[data-reply-image-directory]` 升级为无外框、无障碍视觉隐藏通用表头（`sr-only`）、仅保留极细行分隔线、左 `3:4` 圆角肖像与弱化来源末列的编辑级人物卡片样式；将 `[data-reply-image-caption]` 来源脚注进一步弱化为 `11.5px` 低对比度与轻量圆角链接胶囊样式。
- [x] 3.3 扩展 `tests/client.spec.ts` 与 `scripts/clientPreview.ts`：验证首列人物目录表标注 `data-reply-image-directory`、自定义业务对比表保留表头、胶囊来源样式及卸载后 100% 清理，并在预览页补充 Anthropic 风格人物目录卡片示例。

## 4. 全量验证与重新打包安装

- [x] 4.1 执行 `npm run check`（格式化、严格类型检查、Vitest 覆盖率测试、tsdown 构建、`checkClientBundle` 校验）确保全部通过。
- [x] 4.2 重新打包带内容哈希后缀的 `.tgz` 并通过 `dsh.cmd plugin --profile desktop add` 安装到 DSH Desktop profile，核对安装目录最新构建产物。

## 5. Review 修复

- [x] 5.1 恢复首列含图表格的通用紧凑栏宽和肖像裁切，覆盖自定义业务表头并保留多列含图对比布局。
- [x] 5.2 收窄 `age` 的 SEO 匹配，验证科技与历史报道不被误伤，同时保留明确八卦表达的降权与查询豁免。
- [x] 5.3 为目录表补充 `position: relative`，验证隐藏表头定位，并重新运行完整校验、预览及打包安装。
