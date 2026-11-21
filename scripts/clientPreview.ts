import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const client = await readFile(new URL('lib/client.cjs', root), 'utf8')
const output = fileURLToPath(new URL('client-preview.html', root))
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>回复配图客户端预览</title>
  <style>
    * { box-sizing: border-box; }
    body { --preview-muted: #5a626a; --preview-caption: #69717a; --preview-link: #276f91; margin: 0; color: #25282b; background: #f6f7f8; font: 15px/1.65 system-ui, sans-serif; }
    main { max-width: 1024px; margin: 0 auto; padding: 24px 32px 56px; background: white; }
    h1 { margin: 0 0 8px; font-size: 25px; line-height: 1.25; }
    h2 { margin: 28px 0 10px; font-size: 18px; }
    p { margin: 8px 0 14px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; vertical-align: top; border-bottom: 1px solid #e1e4e6; }
    th:first-child, td:first-child { padding-left: 0; }
    th { color: var(--preview-muted); font-size: 12px; font-weight: 600; }
    td { min-width: 0; overflow-wrap: anywhere; }
    td p { margin: 6px 0; }
    img { max-width: 100%; }
    .caption { color: var(--preview-caption); font-size: 12px; }
    a { color: var(--preview-link); }
    @media (prefers-color-scheme: dark) {
      body { --preview-muted: #c2cac5; --preview-caption: #c2cac5; --preview-link: #75c9ea; color: #e4e8e5; background: #171a18; }
      main { background: #232825; }
      th, td { border-color: #414a45; }
    }
    @media (max-width: 600px) { main { padding: 18px 16px 40px; } h1 { font-size: 21px; } }
  </style>
</head>
<body>
  <main>
    <div data-chat-group-part="response">
    <h1>花卉与水域植物：看叶片和生长位置</h1>
    <p>快速区分两类常见水生植物，可以先观察叶片是否漂浮，以及花朵和叶柄相对水面的高度。以下图片是用于版式预览的通用示例，不代表对某个物种的鉴定。</p>
    <h2>Anthropic 风格人物目录卡片</h2>
    <p>以下为人物目录排版示意。素材肖像不代表 Anthropic 的员工、创始人或任何已核实身份，简介仅说明版式。</p>
    <table>
      <thead><tr><th scope="col">Image</th><th scope="col">Description</th><th scope="col">Source and license</th></tr></thead>
      <tbody>
        <tr><td><img class="dsh_image" alt="目录排版示例肖像一，身份未核实" src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&amp;fit=crop&amp;w=336&amp;q=80"></td><td><strong>示例人物一</strong><p>左侧竖版肖像，右侧保留完整人物介绍；通用列头仅在视觉上收起，读屏器仍可读取。</p></td><td>素材示意<br><a href="https://unsplash.com/license">Unsplash License</a></td></tr>
        <tr><td><img class="dsh_image" alt="目录排版示例肖像二，身份未核实" src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&amp;fit=crop&amp;w=336&amp;q=80"></td><td><strong>示例人物二</strong><p>细线区分卡片，末列来源降低视觉权重，让肖像和正文成为阅读重点。</p></td><td>素材示意<br><a href="https://unsplash.com/license">Unsplash License</a></td></tr>
        <tr><td>—</td><td><strong>无图占位示例</strong><p>图片不可用时仍保留实体说明与原始占位行。</p></td><td>—</td></tr>
      </tbody>
    </table>
    <h2>两列目录：简介保留正常对比度</h2>
    <table>
      <thead><tr><th scope="col">人物</th><th scope="col">说明</th></tr></thead>
      <tbody><tr><td><img class="dsh_image" alt="两列目录素材肖像，身份未核实" src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&amp;fit=crop&amp;w=336&amp;q=80"></td><td><strong>示例人物</strong><p>两列表格的末列是简介，维持正文字号与对比度。</p></td></tr></tbody>
    </table>
    <h2>主题索引</h2>
    <table>
      <thead><tr><th>主题</th><th>观察要点与来源</th></tr></thead>
      <tbody>
        <tr><td><img class="dsh_image" alt="粉色花朵的近景" src="https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&amp;fit=crop&amp;w=640&amp;q=80"></td><td><strong>花朵与叶片</strong><p>颜色只能作为辅助线索，花型和叶片结构更有区分度。</p><p class="caption">图片示例：<a href="https://unsplash.com/license">Unsplash License</a></p></td></tr>
        <tr><td><img class="dsh_image" alt="池塘边的绿色植物" src="https://images.unsplash.com/photo-1497250681960-ef046c08a56e?auto=format&amp;fit=crop&amp;w=640&amp;q=80"></td><td><strong>生长位置</strong><p>叶片漂浮或伸出水面，会影响观察角度，也能帮助比较整体形态。</p><p class="caption">图片示例：<a href="https://unsplash.com/license">Unsplash License</a></p></td></tr>
      </tbody>
    </table>
    <h2>一大两小拼贴</h2>
    <p><img class="dsh_image" alt="池塘主场景" src="https://images.unsplash.com/photo-1439405326854-014607f694d7?auto=format&amp;fit=crop&amp;w=960&amp;q=80#dsh-layout=collage&amp;group=pond"><img class="dsh_image" alt="湿地植物细节" src="https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?auto=format&amp;fit=crop&amp;w=640&amp;q=80#dsh-layout=collage&amp;group=pond"><img class="dsh_image" alt="水面生态" src="https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&amp;fit=crop&amp;w=640&amp;q=80#dsh-layout=collage&amp;group=pond"></p>
    <p><em>Image sources: 1–3. <a href="https://unsplash.com/license">Unsplash License</a></em></p>
    <h2>四图横向图集（Desktop title 标记）</h2>
    <p>点击图片或数字角标打开图集。用方向键或分页圆点切换图片，按 Esc 返回正文。</p>
    <p><img class="dsh_image" alt="花叶近景" src="https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&amp;fit=crop&amp;w=640&amp;q=80" title="dsh-layout=strip&amp;group=flowers"><img class="dsh_image" alt="池塘绿叶" src="https://images.unsplash.com/photo-1497250681960-ef046c08a56e?auto=format&amp;fit=crop&amp;w=640&amp;q=80" title="dsh-layout=strip&amp;group=flowers"><img class="dsh_image" alt="野花场景" src="https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&amp;fit=crop&amp;w=640&amp;q=80" title="dsh-layout=strip&amp;group=flowers"><img class="dsh_image" alt="湖畔景观" src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&amp;fit=crop&amp;w=640&amp;q=80" title="dsh-layout=strip&amp;group=flowers"></p>
    <p><em>图片来源：<a href="https://unsplash.com/license">Unsplash License</a></em></p>
    <h2>正文单图</h2>
    <p><img class="dsh_image" alt="水边花朵" src="https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&amp;fit=crop&amp;w=1000&amp;q=80"></p>
    <p><em>Image source: <a href="https://unsplash.com/license">Unsplash License</a></em></p>
    <h2>并列场景</h2>
    <table>
      <thead><tr><th>叶片与花朵</th><th>水面与植被</th></tr></thead>
      <tbody><tr>
        <td><img class="dsh_image" alt="水边花朵" src="https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&amp;fit=crop&amp;w=640&amp;q=80"><p>花色变化范围大，单凭颜色容易误判。</p></td>
        <td><img class="dsh_image" alt="湖畔绿色植物" src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&amp;fit=crop&amp;w=640&amp;q=80"><p>观察叶片与水面的关系，再核对花和茎的结构。</p></td>
      </tr></tbody>
    </table>
    </div>
  </main>
  <script>
    window.__ModuleLoader__ = { load(registration) { window.replyImageClient = registration.factory(() => { throw new Error('Unexpected external module') }) } }
  </script>
  <script>${client}</script>
  <script>
    window.replyImageClient.apply({ effect(register) { window.disposeReplyImageClient = register() } })
  </script>
</body>
</html>
`
await writeFile(output, html)
process.stdout.write(`Generated ${output} with the built DSH client entry\n`)
