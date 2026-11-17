# 维护与迭代

## 模块职责

| 模块                                    | 职责                                          | 优先运行的测试                                     |
| --------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| `search/providers.ts`、`search/urls.ts` | 校验外部结果、提取来源、限制图片 CDN          | `tests/search/providers.spec.ts`                   |
| `search/search.ts`                      | 有界请求、按配置回退、去重                    | `tests/search/search.spec.ts`                      |
| `http.ts`                               | HTTPS、DNS 固定、重定向、取消、字节和时间上限 | `tests/http*.spec.ts`                              |
| `candidates.ts`                         | Agent/轮次隔离、同步预算预留                  | `tests/candidates.spec.ts`                         |
| `replyImages.ts`                        | 编排搜索和附件保存、Markdown、关闭时排空      | `tests/replyImages.spec.ts`                        |
| `media.ts`                              | 从持久引用读取附件和 HTTP 状态                | `tests/media.spec.ts`、`tests/persistence.spec.ts` |
| `tools.ts`、`index.ts`                  | 官方 SDK 适配、插件生命周期                   | `tests/plugin.spec.ts`                             |

核心流程只依赖注入的网络读取器与官方附件接口。不要把测试开关或测试专用分支放进生产代码，不要为了单测扩展公开 API。避免跨模块共享可变 mock；测试中的 reader/store 必须在测试结束前完成，临时目录需释放。

## 测试规则

- 修复缺陷先加入能复现问题的失败测试；新增能力先描述可观察行为，再实现最小改动。
- 单元测试禁止真实联网，使用小型响应 fixtures 和可控依赖。上游网页变更时，记录脱敏的最小响应并更新对应解析测试，不依赖结果数量或实时排名。
- 用参数化测试覆盖同类输入。断言输出、错误码、调用副作用和清理结果；不要断言私有字段或 UUID 的具体值。
- 并发与取消测试用受控 Promise/信号推进，不使用真实 sleep。存储集成测试使用真实官方后端，避免 mock 掉要验证的持久化行为。
- 覆盖率门槛：行/语句/函数 95%，分支 85%。门槛防回归；不通过时补有意义的测试或修复不可达代码，不降低阈值掩盖问题。

## 典型迭代

增加图源时依次修改 provider 联合类型、配置枚举、HTTPS 端点、CDN 白名单和响应解析；覆盖成功、单条损坏、空结果、许可缺失、恶意地址以及回退路径。添加持久字段时同步修改工具输出 schema、类型、Markdown/路由引用和重启测试。改变每轮预算时覆盖并发预留、失败消费、旧轮次和其他 Agent。

SDK 升级时同时更新所有官方 peer/dev 版本和 lockfile，检查官方发布说明，运行插件集成与持久化测试，并在真实 Web profile 中验证图像能经过认证读取。不要把静态预览当作真实模型会话测试。

提交前执行 `npm run check` 和 `npm run pack:check`；更新中英文 README。涉及视觉效果时重新生成预览并检查 1440 px 和 390 px、浅色/深色主题、放大关闭以及键盘焦点。实际图源烟测独立运行 `npm run preview:generate`，不加入离线 CI。
