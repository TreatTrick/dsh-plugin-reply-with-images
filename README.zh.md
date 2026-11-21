# DSH 回答配图

本插件为 DSH 回答提供图片搜索与附件保存能力。模型会先判断配图是否能提升理解，再按章节内容使用人物/对比表格、三图拼贴、最多五图横向图集或普通单图。`reply_images_prepare` 单次支持最多五个图片区块，每轮默认最多搜索 6 次、展示 8 张；候选下载失败或内容重复时会顺延寻找其他图片。图片保留准确的来源、作者与许可说明，短答、纯文字请求或图源不可用时仍可继续完成文字回答。

图片通过 DSH 支持的 Markdown 图片语法插入回答；本插件不控制模型是否遵循提示，也不替换 DSH 宿主的 Markdown 排版。可选 Web 客户端为含图表格提供窄屏布局，并为普通 Markdown 图片增加键盘可访问的放大查看。现有分步 `reply_image_search` 和 `reply_images_embed` 工具保持兼容。

## 安装或升级

在插件项目目录运行 `npm ci`、`npm run check` 和 `npm pack`，生成 `dsh-plugin-reply-with-images-0.1.3.tgz`。将 tarball 安装到正在使用的 DSH profile；Web profile 示例：

```sh
dsh plugin --profile web add ./dsh-plugin-reply-with-images-0.1.3.tgz
dsh --profile web
```

Desktop 请完全退出 DSH，使用该安装版本自带的 `dsh` 命令执行 `plugin --profile desktop add <tarball路径>`，然后重新启动 Desktop。Windows 下命令通常位于安装目录的 `resources/runtime/cli/bin/dsh.cmd`。更新插件不会改写已生成的旧回答，请用新对话验证三主题配图行为。

完整配置、安全限制和测试说明见英文版 [README.md](README.md)。本地 Web 客户端预览可运行 `npm run preview:client`，生成的 `client-preview.html` 展示人物索引式图文行和多图比较布局。
