# DSH 回答配图

本插件为 DSH 回答提供真实图片搜索与附件保存能力。较长的人物、机构、新闻、商品和地点回答会明确提醒模型考虑配图；`reply_images_prepare` 可一次按主题搜索、保存最多三张图片，并返回可插入段落或 Markdown 表格的内容、来源和许可说明。搜索预算默认每轮三次，取图失败时仍可正常返回文字。

可选 Web 客户端为含图表格提供窄屏布局，并为普通 Markdown 图片增加键盘可访问的放大查看。它沿用 DSH 图片加载和错误回退行为，不配置该客户端时，原始 Markdown 图片仍可显示。现有分步 `reply_image_search` 和 `reply_images_embed` 工具保持兼容。

完整安装、配置、安全限制和测试说明见英文版 [README.md](README.md)。本地预览可运行 `npm run preview:client`，生成的 `client-preview.html` 展示人物索引式图文行和多图比较布局。
