# DSH 回答配图

本插件为 DSH 回答提供真实图片搜索与附件保存能力。对于包含多个可视章节的详细人物、新闻或事件回答，模型会被明确要求默认规划三个不同的配图主题，并把每张成功图片连同来源说明放在对应章节之后。`reply_images_prepare` 一次最多搜索并保存三张图片，每项返回独立的插入位置提示、段落 Markdown、表格 Markdown、来源和许可说明。短答、纯文字请求、单一视觉主体、预算不足或图源失败时会合理减少图片，或继续以文字回答。

图片通过 DSH 支持的 Markdown 图片语法插入回答；本插件不控制模型是否遵循提示，也不替换 DSH 宿主的 Markdown 排版。可选 Web 客户端为含图表格提供窄屏布局，并为普通 Markdown 图片增加键盘可访问的放大查看。现有分步 `reply_image_search` 和 `reply_images_embed` 工具保持兼容。

## 安装或升级

在插件项目目录运行 `npm ci`、`npm run check` 和 `npm pack`，生成 `dsh-plugin-reply-with-images-0.1.3.tgz`。将 tarball 安装到正在使用的 DSH profile；Web profile 示例：

```sh
dsh plugin --profile web add ./dsh-plugin-reply-with-images-0.1.3.tgz
dsh --profile web
```

Desktop 请完全退出 DSH，使用该安装版本自带的 `dsh` 命令执行 `plugin --profile desktop add <tarball路径>`，然后重新启动 Desktop。Windows 下命令通常位于安装目录的 `resources/runtime/cli/bin/dsh.cmd`。更新插件不会改写已生成的旧回答，请用新对话验证三主题配图行为。

完整配置、安全限制和测试说明见英文版 [README.md](README.md)。本地 Web 客户端预览可运行 `npm run preview:client`，生成的 `client-preview.html` 展示人物索引式图文行和多图比较布局。
