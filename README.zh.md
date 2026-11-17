# DSH Reply with images

[English](README.md) | 中文

为 DeepSeek Harness 回答添加相关真实图片的独立 TypeScript 社区插件。只使用官方 Harness 服务，不依赖第三方搜图或展示插件；图片下载、来源解析、候选管理由本项目维护。普通运行时依赖还包括 Zod、Cheerio、ipaddr.js。

图片作为标准 Markdown 插在相关段落后，接近 ChatGPT 回答中的图文混排。默认每轮最多搜索两次、展示两张图片。模型判断配图是否有用；上游失败时继续文字回答。

## 安装

需要 Node.js ≥24.9，以及 DSH `0.2.2-rc.3` API 所需的官方 `agents`、`tools`、`systemPrompt`、`attachments`、`connection`、`webServer` 服务。Web/Desktop profile 提供浏览器展示环境；纯 headless profile 不适合本插件。当前锁定的 SDK 测试基线是 `0.2.2-rc.3`；其他 `0.2.x` 版本尚需兼容性验证。

```powershell
npm ci
npm run check
npm pack
dsh plugin --profile web add ./dsh-plugin-reply-with-images-0.1.0.tgz
dsh --profile web --dump-config
dsh --profile web
```

`web` 应为已经能启动 Web UI 的 profile。包尚未发布 npm；上述命令安装当前构建产物。开发时也可先构建，再通过 `dsh plugin --profile web add .` 链接 checkout。没有修改全局配置或默认安装本插件。

## 配置

在使用的 profile 的 `cordis.patch.yml` 中覆写已有行：

```yaml
- id: reply-with-images
  config:
    providers: [baidu, so360, bing]
    automatic: true
    maxImagesPerTurn: 2
    maxSearchesPerTurn: 2
    maxCandidates: 6
    requestTimeoutMs: 8000
    maxImageBytes: 5242880
    maxSearchBytes: 3145728
    allowFakeIpDns: false
    publicBaseUrl: ''
```

`automatic: false` 时，提示模型只在用户明确要求图片时搜图。来源按顺序回退，候选达到上限就停止。Wikimedia 默认关闭，可显式加入 `providers`，但在中国大陆不保证可达。百度、360、Bing 使用网页端接口，也不能保证所有网络都可用；搜索词会发送给所配置的来源。

`publicBaseUrl` 留空使用官方 WebServer origin。远程或反向代理部署时应填浏览器实际访问的同源地址（可以含路径前缀），并把该前缀下的 `/api/reply-images` 转发给 Harness，沿用官方认证。图片 URL 不含认证 token。URL 的 origin/路径改变后，已保存回答中的绝对 URL 需迁移；附件内容本身仍在官方存储中。

`allowFakeIpDns` 只用于明确使用代理 Fake-IP DNS 的环境，额外允许 `198.18.0.0/15` 和 `2001:2::/48`；默认拒绝这些地址，其他内网地址始终拒绝。网络请求使用 Node HTTPS，不自动读取 `HTTP_PROXY`/`HTTPS_PROXY`；需要代理时应在部署层提供兼容网络。

## 原理和限制

1. `reply_image_search({ query })` 返回当前 Agent、当前轮次专用的候选 ID 与来源信息，不向模型返回任意下载 URL。
2. `reply_images_embed({ candidates: [{ candidateId, alt? }] })` 原子预留预算，从来源 CDN 下载并通过官方 `attachments.saveImage()` 校验、持久化。
3. 模型将返回的 `markdown` 原样放在对应段落后。官方 Connection 路由先完成认证，再通过 `attachments.readImage()` 读取图片。附件引用随回答保存，重启后可重新读取。

这是通过工具和提示词辅助模型配图，无法强制所有模型在每次回答中调用工具或粘贴 Markdown。模型依据标题和来源筛选，插件不会对图片内容做视觉识别或保证语义准确。默认使用搜索缩略图，清晰度受上游限制；支持 PNG、JPEG、WebP、GIF，附件服务可能重新编码。卸载插件后路由移除，重新启用并保留附件存储才能显示旧图片。

百度/360/Bing 未提供的许可标为“许可未确认”，来源引用不等于允许转载；本项目 MIT 许可证仅覆盖代码。公开发布或商用前应自行核实原作者的图片许可。网页接口限流、验证码或字段变化会产生 warnings 并回退，不能作为稳定 SLA 的搜图服务。

## 开发和测试

```powershell
npm test
npm run test:coverage
npm run typecheck
npm run build
npm run format:check
npm run pack:check
```

`npm run check` 串行运行格式、类型、覆盖率和构建检查；CI 在 Windows、Linux、macOS 使用 Node 24 验证。日常测试完全离线：解析、预算、路由等单元测试使用小型输入与注入依赖；集成测试使用真实 Cordis 注册和官方本地附件后端，覆盖重启读图。维护约定与迭代指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 效果预览

执行 `npm run preview:generate` 后，打开本地生成的 `preview.html`。此页使用真实搜图，经本插件和官方附件服务保存/读取后内嵌图片，可离线查看、切换深色模式和放大图片。它演示回答排版，不能替代完整 DSH 模型会话验收。由于搜索结果可能没有确认转载许可，预览 HTML 和图片文件仅保留在本地，不提交到 Git 仓库。

需要更新图片时执行 `npm run preview:generate`；Fake-IP 网络可显式附加 `-- --allow-fake-ip-dns`。该命令联网搜索荷花/睡莲，只有两张图片都成功后才覆盖预览，诊断和附件保存在忽略的 `.preview/` 中。

## 官方规范依据

对照本机 `D:\project\deepseek-harness` 的开发规范和以下官方文档实现：

- [打包与安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)：bundle manifest、patch、peer 依赖和 profile 安装。
- [工具编写](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.zh.md)：`defineTool`、规范 JSON 返回值、取消和纯展示函数。
- [附件子系统](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/attachment.zh.md)：保存、校验和读取不可变附件。

本项目是独立社区插件，不是 DeepSeek 或 OpenAI 的官方插件，也不会安装进 ChatGPT 产品。
