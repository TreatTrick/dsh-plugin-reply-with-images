// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installImageEnhancements } from '../src/client/images.js'
import { apply as applyClient } from '../src/client/index.js'

let cleanup: (() => void) | undefined

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false
      this.dispatchEvent(new Event('close'))
    },
  })
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.replaceChildren()
  localStorage.removeItem('reply-images:debug')
  document.head.querySelectorAll('style[data-reply-images]').forEach((style) => style.remove())
  vi.restoreAllMocks()
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close
})

it('caches Desktop title markers across refreshes, styles source captions, and cleans up', async () => {
  const title = ' dsh-layout=collage&group=desktop '
  const section =
    response(`<p>${[1, 2, 3].map((id) => `<img class="dsh_image" src="local-${id}.png" title="${title}" alt="View ${id}">`).join('')}</p>
    <p id="caption"><em>图片来源：<a href="https://example.com/">Public source</a></em></p>
    <p><em>Image source: unrelated</em></p>`)
  const [block, caption, unrelated] = section.querySelectorAll('p')
  const first = section.querySelector('img')!
  const output = vi.spyOn(console, 'debug').mockImplementation(() => {})
  localStorage.setItem('reply-images:debug', '1')
  cleanup = installImageEnhancements(document)
  const debug = Reflect.get(window, '__replyImagesDebug')
  expect(Object.getOwnPropertyDescriptor(window, '__replyImagesDebug')?.writable).toBe(false)
  expect(Object.isFrozen(debug)).toBe(true)
  expect(block?.dataset.replyImageGroup).toBe('collage')
  expect(first.title).toBe('View image: View 1')
  expect(caption?.hasAttribute('data-reply-image-caption')).toBe(true)
  expect(unrelated?.hasAttribute('data-reply-image-caption')).toBe(false)
  expect(caption?.querySelector('a')?.href).toBe('https://example.com/')
  first.src = 'local-rewritten.png'
  await Promise.resolve()
  expect(debug.snapshot()).toMatchObject({
    mounted: true,
    paragraphs: [{ status: 'matched', layout: 'collage', imageCount: 3 }],
  })
  expect(debug.snapshot().images[0].marker).toEqual({
    layout: 'collage',
    group: 'desktop',
    channel: 'title',
  })
  expect(output).toHaveBeenCalledTimes(1)
  caption!.insertBefore(document.createTextNode('Extra text'), caption!.firstChild)
  await Promise.resolve()
  expect(caption?.hasAttribute('data-reply-image-caption')).toBe(false)
  cleanup()
  expect(first.title).toBe(title)
  expect(block?.hasAttribute('data-reply-image-group')).toBe(false)
  expect(Reflect.has(window, '__replyImagesDebug')).toBe(false)
  expect(debug.snapshot()).toMatchObject({ mounted: false, images: [], paragraphs: [] })
})

it('reports precise rejection reasons and prefers hash markers over titles', () => {
  const img = (group: string, name = 'dsh_image') =>
    `<img class="${name}" src="pic.png#dsh-layout=strip&amp;group=${group}" title="dsh-layout=collage&amp;group=override">`
  response(`<p><img class="dsh_image" src="plain.png"></p><p>text ${img('a')}</p>
    <p>${img('a', 'other')}</p><p>${img('a')}</p><p>${img('a')}${img('b')}</p>`)
  cleanup = installImageEnhancements(document)
  const snapshot = Reflect.get(window, '__replyImagesDebug').snapshot()
  expect(snapshot.paragraphs.map(({ reason }: { reason: string }) => reason)).toEqual([
    'no-marker',
    'mixed-text',
    'class-mismatch',
    'single-image',
    'inconsistent-group',
  ])
  expect(snapshot.images[1].marker).toEqual({ layout: 'strip', group: 'a', channel: 'hash' })
})

it('reconciles a Desktop marker added to an already mounted image by the host', async () => {
  const section = response(
    '<p><img class="dsh_image" src="a.png"><img class="dsh_image" src="b.png"></p>',
  )
  cleanup = installImageEnhancements(document)
  const title = 'dsh-layout=strip&group=late'
  for (const image of section.querySelectorAll('img')) image.title = title
  await Promise.resolve()
  expect(section.querySelector('p')?.dataset.replyImageGroup).toBe('strip')
  expect(section.querySelector('img')?.title).toBe('View image: image')
  cleanup()
  expect(section.querySelector('img')?.title).toBe(title)
})

const response = (content: string) => {
  const section = document.createElement('section')
  section.dataset.chatGroupPart = 'response'
  section.innerHTML = `<div class="_7x_markdown">${content}</div>`
  for (const image of section.querySelectorAll('img')) {
    Object.defineProperty(image, 'complete', { configurable: true, value: false })
  }
  document.body.append(section)
  return section
}

const portrait = '<img class="_7x_image" src="portrait.png" alt="示例肖像">'
const directoryRow = `<tr><td>${portrait}</td><td>人物简介</td><td><a href="https://example.com/">来源</a></td></tr>`
const directoryTable = (
  headers = ['Image', 'Description', 'Source and license'],
  rows = directoryRow,
) =>
  `<table><thead><tr>${headers.map((header) => `<th scope="col">${header}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`

it.each([
  ['Image', 'Description', 'Source and license'],
  [' PHOTO ', ' Description\n ', 'Source & license'],
  ['图片', '说明', '来源'],
  ['人物', '简介', '来源与许可'],
  ['图片', '人物', '来源及许可'],
  ['Image', 'Description'],
  ['人物', '说明'],
])('recognizes generic directory headers %j without changing table semantics', (first, ...rest) => {
  const headers = [first, ...rest]
  const row = headers.length === 2 ? `<tr><td>${portrait}</td><td>人物简介</td></tr>` : directoryRow
  const table = response(directoryTable(headers, row)).querySelector('table')!
  const original = table.outerHTML
  const head = table.tHead!
  const cell = table.tBodies[0]!.rows[0]!.cells[0]!
  cleanup = installImageEnhancements(document)
  expect(table.getAttribute('data-reply-image-directory')).toBe('')
  expect(table.tHead).toBe(head)
  expect(head.querySelectorAll('th[scope="col"]')).toHaveLength(headers.length)
  expect(head.hasAttribute('hidden')).toBe(false)
  expect(head.hasAttribute('aria-hidden')).toBe(false)
  expect(table.tBodies[0]!.rows[0]!.cells[0]).toBe(cell)
  cleanup()
  cleanup = undefined
  expect(table.outerHTML).toBe(original)
})

it.each(['', '—', '–', '-', 'No image available', '暂无图片', '无图'])(
  'keeps a text placeholder %j alongside successful directory rows',
  (placeholder) => {
    const table = response(
      directoryTable(
        undefined,
        `${directoryRow}<tr><td>${placeholder}</td><td>未找到图片，保留说明</td><td>—</td></tr>`,
      ),
    ).querySelector('table')!
    cleanup = installImageEnhancements(document)
    expect(table.hasAttribute('data-reply-image-directory')).toBe(true)
    expect(table.tBodies[0]!.rows).toHaveLength(2)
    expect(table.tBodies[0]!.rows[1]!.textContent).toContain('未找到图片，保留说明')
  },
)

it.each([
  '<img src="portrait.png" alt="示例肖像">',
  `<a href="https://example.com/">${portrait}</a>`,
  '<button class="_imageButton_13jw0_471"><img class="_image_13jw0_300" src="portrait.png" alt="示例肖像"></button>',
])('recognizes a single portrait with preserved host wrappers: %s', (image) => {
  const table = response(
    directoryTable(undefined, `<tr><td>${image}</td><td>简介</td><td>来源</td></tr>`),
  ).querySelector('table')!
  const original = table.outerHTML
  cleanup = installImageEnhancements(document)
  expect(table.getAttribute('data-reply-image-directory')).toBe('')
  cleanup()
  cleanup = undefined
  expect(table.outerHTML).toBe(original)
})

it.each([
  ['custom business headers', directoryTable(['Product', 'Price', 'Source'])],
  ['one custom header', directoryTable(['Image', 'Revenue', 'Source'])],
  ['a third business column', directoryTable(['Image', 'Description', 'Decision'])],
  [
    'a four-column generic comparison',
    directoryTable(
      ['Image', 'Description', 'Source', 'Name'],
      `<tr><td>${portrait}</td><td>简介</td><td>来源</td><td>姓名</td></tr>`,
    ),
  ],
  [
    'images in multiple columns',
    directoryTable(undefined, `<tr><td>${portrait}</td><td>${portrait}</td><td>来源</td></tr>`),
  ],
  [
    'an image in the source column',
    directoryTable(undefined, `<tr><td>${portrait}</td><td>简介</td><td>${portrait}</td></tr>`),
  ],
  [
    'multiple first-cell images',
    directoryTable(undefined, `<tr><td>${portrait}${portrait}</td><td>简介</td><td>来源</td></tr>`),
  ],
  [
    'a non-placeholder text row',
    directoryTable(undefined, `${directoryRow}<tr><td>Revenue</td><td>100</td><td>报告</td></tr>`),
  ],
  [
    'a missing first-cell image in a later row',
    directoryTable(
      undefined,
      `${directoryRow}<tr><td>Another person</td><td>简介</td><td>来源</td></tr>`,
    ),
  ],
  [
    'placeholder-only rows',
    directoryTable(undefined, '<tr><td>—</td><td>简介</td><td>—</td></tr>'),
  ],
  [
    'incomplete streamed cells',
    directoryTable(undefined, `<tr><td>${portrait}</td><td>简介</td></tr>`),
  ],
  ['merged headers', directoryTable().replace('<th scope="col">', '<th scope="col" colspan="2">')],
  ['merged body cells', directoryTable().replace('<td>', '<td rowspan="2">')],
  [
    'multiple header rows',
    directoryTable().replace('</thead>', '<tr><th>Details</th></tr></thead>'),
  ],
  ['an image in the header', directoryTable([`Image${portrait}`, 'Description', 'Source'])],
  [
    'a footer summary',
    directoryTable().replace('</table>', '<tfoot><tr><td>Total</td></tr></tfoot></table>'),
  ],
  ['a missing header', `<table><tbody>${directoryRow}</tbody></table>`],
  ['no body rows', directoryTable(undefined, '')],
])('preserves %s instead of marking it as a directory', (_name, markup) => {
  const table = response(markup).querySelector('table')!
  const head = table.tHead
  const original = table.outerHTML
  cleanup = installImageEnhancements(document)
  expect(table.hasAttribute('data-reply-image-directory')).toBe(false)
  expect(table.tHead).toBe(head)
  expect(head?.hasAttribute('hidden')).not.toBe(true)
  expect(head?.hasAttribute('aria-hidden')).not.toBe(true)
  cleanup()
  cleanup = undefined
  expect(table.outerHTML).toBe(original)
})

it('leaves nested tables and tables outside the response scope unmarked', () => {
  const section = response(`
    <div data-chat-group-part="reasoning">${directoryTable()}</div>
    <div data-chat-group-part="tool">${directoryTable()}</div>
    <table><thead><tr><th>Image</th><th>Description</th></tr></thead><tbody>
      <tr><td>${portrait}</td><td>${directoryTable()}</td></tr>
    </tbody></table>
    ${directoryTable().replace('<td>人物简介', '<td><span data-chat-group-part="reasoning">内部说明</span>人物简介')}
  `)
  const outside = document.createElement('div')
  outside.innerHTML = directoryTable()
  document.body.append(outside)
  cleanup = installImageEnhancements(document)
  expect(section.querySelector('[data-reply-image-directory]')).toBeNull()
  expect(outside.querySelector('[data-reply-image-directory]')).toBeNull()
})

it('reconciles streamed rows, header text, comparison images, spans and nested tables', async () => {
  const section = response('')
  cleanup = installImageEnhancements(document)
  section.querySelector('div')!.innerHTML = directoryTable()
  await Promise.resolve()
  const table = section.querySelector('table')!
  const header = table.tHead!.rows[0]!.cells[1]!
  const row = table.tBodies[0]!.rows[0]!
  const first = row.cells[0]!
  const description = row.cells[1]!
  const marked = () => table.hasAttribute('data-reply-image-directory')
  expect(marked()).toBe(true)

  header.firstChild!.textContent = 'Revenue'
  await Promise.resolve()
  expect(marked()).toBe(false)
  header.firstChild!.textContent = 'Description'
  await Promise.resolve()
  expect(marked()).toBe(true)

  description.insertAdjacentHTML('beforeend', portrait)
  await Promise.resolve()
  expect(marked()).toBe(false)
  description.querySelector('img')!.remove()
  await Promise.resolve()
  expect(marked()).toBe(true)

  first.insertAdjacentHTML('beforeend', portrait)
  await Promise.resolve()
  expect(marked()).toBe(false)
  first.querySelector('img')!.remove()
  await Promise.resolve()
  expect(marked()).toBe(true)

  first.colSpan = 2
  await Promise.resolve()
  expect(marked()).toBe(false)
  first.removeAttribute('colspan')
  await Promise.resolve()
  expect(marked()).toBe(true)
  first.rowSpan = 2
  await Promise.resolve()
  expect(marked()).toBe(false)
  first.removeAttribute('rowspan')
  await Promise.resolve()
  expect(marked()).toBe(true)

  description.insertAdjacentHTML('beforeend', directoryTable())
  await Promise.resolve()
  expect(section.querySelector('[data-reply-image-directory]')).toBeNull()
  description.querySelector('table')!.remove()
  await Promise.resolve()
  expect(marked()).toBe(true)

  const image = first.querySelector('img')!
  image.remove()
  await Promise.resolve()
  expect(marked()).toBe(false)
  first.append(image)
  await Promise.resolve()
  expect(marked()).toBe(true)

  table.tBodies[0]!.insertAdjacentHTML(
    'beforeend',
    '<tr><td>Unfinished</td><td>简介</td><td>来源</td></tr>',
  )
  await Promise.resolve()
  expect(marked()).toBe(false)
  table.tBodies[0]!.rows[1]!.cells[0]!.innerHTML = portrait
  await Promise.resolve()
  expect(marked()).toBe(true)
})

it('restores directory attributes when leaving the response, detaching, and unloading', async () => {
  const section = response(directoryTable())
  const table = section.querySelector('table')!
  table.setAttribute('data-reply-image-directory', 'host-value')
  const original = table.outerHTML
  const head = table.tHead!
  cleanup = installImageEnhancements(document)
  expect(table.getAttribute('data-reply-image-directory')).toBe('')

  head.rows[0]!.cells[0]!.textContent = 'Product'
  await Promise.resolve()
  expect(table.getAttribute('data-reply-image-directory')).toBe('host-value')
  head.rows[0]!.cells[0]!.textContent = 'Image'
  await Promise.resolve()
  expect(table.getAttribute('data-reply-image-directory')).toBe('')

  section.dataset.chatGroupPart = 'reasoning'
  await Promise.resolve()
  expect(table.outerHTML).toBe(original)
  section.dataset.chatGroupPart = 'response'
  await Promise.resolve()
  expect(table.getAttribute('data-reply-image-directory')).toBe('')

  const parent = table.parentElement!
  document.body.append(table)
  await Promise.resolve()
  expect(table.outerHTML).toBe(original)
  parent.append(table)
  await Promise.resolve()
  expect(table.getAttribute('data-reply-image-directory')).toBe('')

  table.remove()
  await Promise.resolve()
  expect(table.outerHTML).toBe(original)
  parent.append(table)
  await Promise.resolve()
  expect(table.getAttribute('data-reply-image-directory')).toBe('')
  cleanup()
  cleanup = undefined
  expect(table.outerHTML).toBe(original)
  expect(table.tHead).toBe(head)
  expect(document.querySelector('style[data-reply-images], dialog')).toBeNull()
  table.tHead!.rows[0]!.cells[0]!.textContent = 'Image'
  await Promise.resolve()
  expect(table.getAttribute('data-reply-image-directory')).toBe('host-value')
})

it('fully restores pre-existing directory, caption, and image attributes on unload', () => {
  const section = response(`
    ${directoryTable()}
    ${directoryTable(['图片', '说明'], `<tr><td>${portrait}</td><td>简介</td></tr>`)}
    <p><img class="_7x_image" src="solo.png" alt="示例" tabindex="4" role="presentation" title="原有标题" aria-label="原有说明" aria-haspopup="false" data-reply-image-zoom="host"></p>
    <p data-reply-image-caption="host-caption"><em>图片来源：<a href="https://example.com/">来源链接</a></em></p>
  `)
  section.querySelector('table')!.setAttribute('data-reply-image-directory', 'host-directory')
  const original = section.innerHTML
  cleanup = installImageEnhancements(document)
  expect(section.querySelectorAll('table[data-reply-image-directory=""]')).toHaveLength(2)
  expect(section.querySelector('p[data-reply-image-caption=""]')).not.toBeNull()
  cleanup()
  cleanup = undefined
  expect(section.innerHTML).toBe(original)
  expect(document.querySelector('style[data-reply-images], dialog')).toBeNull()
  expect(Reflect.has(window, '__replyImagesDebug')).toBe(false)
})

it('styles accessible editorial cards and capsule sources without subduing two-column descriptions', () => {
  const section = response(`
    ${directoryTable()}
    ${directoryTable(['Image', 'Description'], `<tr><td>${portrait}</td><td>完整简介</td></tr>`)}
    ${directoryTable(['Product', 'Price', 'Source'])}
    <p>${portrait}</p><p><em>Image source: <a href="https://example.com/">Source</a></em></p>
  `)
  cleanup = installImageEnhancements(document)
  const style = document.querySelector<HTMLStyleElement>('style[data-reply-images]')!
  const rules = [...style.sheet!.cssRules].filter(
    (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
  )
  const matching = (element: Element, selector: string) =>
    rules.filter(
      (rule) => rule.selectorText.includes(selector) && element.matches(rule.selectorText),
    )
  const property = (element: Element, selector: string, name: string) =>
    matching(element, selector)
      .map((rule) => rule.style.getPropertyValue(name))
      .filter(Boolean)
      .at(-1)
  const [three, two, custom] = section.querySelectorAll('table')
  const head = three!.tHead!
  expect(property(head, '[data-reply-image-directory]', 'position')).toBe('absolute')
  expect(property(head, '[data-reply-image-directory]', 'clip-path')).toBe('inset(50%)')
  expect(property(head, '[data-reply-image-directory]', 'overflow')).toBe('hidden')
  expect(property(head, '[data-reply-image-directory]', 'width')).toBe('1px')
  expect(property(head, '[data-reply-image-directory]', 'height')).toBe('1px')
  expect(property(head, '[data-reply-image-directory]', 'display')).toBeUndefined()
  expect(property(head, '[data-reply-image-directory]', 'visibility')).toBeUndefined()
  expect(property(three!, '[data-reply-image-directory]', 'border')).toBe('0')
  expect(property(three!, '[data-reply-image-directory]', 'position')).toBe('relative')
  expect(property(three!, '[data-reply-image-directory]', 'table-layout')).toBe('auto')
  expect(property(three!.querySelector('td')!, 'table:where(', 'width')).toBe('112px')
  expect(
    property(three!.querySelector('td')!, '[data-reply-image-directory]', 'border-block-start'),
  ).toBe('1px solid var(--reply-image-border)')
  expect(property(three!.querySelector('img')!, 'table:where(', 'aspect-ratio')).toBe('3 / 4')
  const source = three!.querySelector('td:nth-child(3)')!
  expect(property(source, '[data-reply-image-directory]', 'font-size')).toBe('12px')
  expect(property(source, '[data-reply-image-directory]', 'width')).toBe('160px')
  expect(property(source, '[data-reply-image-directory]', 'opacity')).toBe('0.68')
  expect(
    property(two!.querySelector('td:last-child')!, '[data-reply-image-directory]', 'opacity'),
  ).toBeUndefined()
  expect(
    property(two!.querySelector('td:last-child')!, '[data-reply-image-directory]', 'font-size'),
  ).toBeUndefined()
  expect(matching(custom!.tHead!, '[data-reply-image-directory]')).toHaveLength(0)
  expect(matching(custom!.querySelector('td')!, '[data-reply-image-directory]')).toHaveLength(0)
  const caption = section.querySelector('[data-reply-image-caption]')!
  const link = caption.querySelector('a')!
  expect(property(caption, '[data-reply-image-caption]', 'font-size')).toBe('11.5px')
  expect(property(caption, '[data-reply-image-caption]', 'opacity')).toBe('0.65')
  expect(property(link, '[data-reply-image-caption]', 'padding')).toBe('1px 6px')
  expect(property(link, '[data-reply-image-caption]', 'border-radius')).toBe('999px')
  expect(property(link, '[data-reply-image-caption]', 'background')).toBe(
    'color-mix(in srgb, currentColor 8%, transparent)',
  )
  expect(link.getAttribute('href')).toBe('https://example.com/')
})

it.each([
  ['创始人', '职位与背景'],
  ['主题', '观察要点与来源'],
])('keeps a compact portrait column with custom headers %s / %s', (first, second) => {
  const section = response(`
    ${directoryTable([first, second], `<tr><td>${portrait}</td><td>完整说明</td></tr>`)}
    ${directoryTable(['方案 A', '方案 B'], `<tr><td>${portrait}</td><td>${portrait}</td></tr>`)}
  `)
  cleanup = installImageEnhancements(document)
  const [custom, comparison] = section.querySelectorAll('table')
  const style = document.querySelector<HTMLStyleElement>('style[data-reply-images]')!
  const rules = [...style.sheet!.cssRules].filter(
    (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
  )
  const property = (element: Element, name: string) =>
    rules
      .filter(
        (rule) =>
          rule.selectorText.includes('[data-chat-group-part="response"]') &&
          element.matches(rule.selectorText),
      )
      .map((rule) => rule.style.getPropertyValue(name))
      .filter(Boolean)
      .at(-1)

  expect(custom!.hasAttribute('data-reply-image-directory')).toBe(false)
  expect(property(custom!, 'table-layout')).toBe('fixed')
  expect(property(custom!.tHead!, 'position')).toBeUndefined()
  for (const cell of [custom!.querySelector('th')!, custom!.querySelector('td')!])
    expect(property(cell, 'width')).toBe('112px')
  const mobileRules = [...style.sheet!.cssRules]
    .filter(
      (rule): rule is CSSMediaRule =>
        rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 480px)',
    )
    .flatMap((rule) => [...rule.cssRules])
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
  expect(
    mobileRules
      .filter((rule) => custom!.querySelector('td')!.matches(rule.selectorText))
      .map((rule) => rule.style.getPropertyValue('width'))
      .filter(Boolean)
      .at(-1),
  ).toBe('84px')
  const image = custom!.querySelector('img')!
  expect(property(image, 'aspect-ratio')).toBe('3 / 4')
  expect(property(image, 'object-fit')).toBe('cover')
  expect(property(image, 'width')).toBe('min(100%, 112px)')
  expect(property(image, 'max-height')).toBe('none')
  expect(property(comparison!.querySelector('th')!, 'width')).toBeUndefined()
  expect(property(comparison!.querySelector('td')!, 'width')).toBeUndefined()
  expect(property(comparison!.querySelector('img')!, 'aspect-ratio')).toBeUndefined()
  expect(property(comparison!, 'table-layout')).toBe('fixed')
})

it('marks only ordinary Markdown images in final answers as keyboard-accessible zoom controls', () => {
  const section = response(
    '<p><img class="_7x_image" src="https://example.com/lotus.png" alt="Lotus flower"></p>',
  )
  const [image] = section.querySelectorAll('img')
  const linked = document.createElement('img')
  linked.className = '_7x_image'
  linked.alt = 'Linked image'
  const anchor = document.createElement('a')
  anchor.href = 'https://example.com'
  anchor.append(linked)
  section.append(anchor)
  const toolCard = document.createElement('aside')
  toolCard.innerHTML = '<img class="_7x_image" alt="Tool image">'
  const navigation = document.createElement('div')
  navigation.dataset.chatGroupPart = 'reasoning'
  navigation.append(toolCard)
  section.after(navigation)

  cleanup = installImageEnhancements(document)

  expect(image?.getAttribute('role')).toBe('button')
  expect(image?.getAttribute('tabindex')).toBe('0')
  expect(image?.getAttribute('aria-label')).toBe('View image: Lotus flower')
  expect(linked.hasAttribute('role')).toBe(false)
  expect(toolCard.querySelector('img')?.hasAttribute('role')).toBe(false)
})

it('opens a bounded image dialog by mouse or keyboard and restores focus on Escape or close', () => {
  const section = response(
    '<p><img class="_7x_image" src="https://example.com/lotus.png" alt="Lotus flower"></p>',
  )
  cleanup = installImageEnhancements(document)
  const image = section.querySelector('img')!
  image.focus()
  image.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
  const dialog = document.querySelector('dialog')!
  expect(dialog.open).toBe(true)
  expect(dialog.getAttribute('aria-label')).toBe('Lotus flower')
  expect(dialog.querySelector('img')).toMatchObject({ alt: 'Lotus flower' })
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://example.com/lotus.png')
  expect(document.activeElement?.textContent).toBe('Close')
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
  expect(document.querySelector('dialog')).toBeNull()
  expect(document.activeElement).toBe(image)
  image.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
  expect(document.querySelector('dialog')?.open).toBe(true)
  document.querySelector<HTMLButtonElement>('dialog button')!.click()
  expect(document.querySelector('dialog')).toBeNull()
  expect(document.activeElement).toBe(image)
})

it('keeps image tables responsive, with directory image columns and comparison cells', () => {
  response(`<div><table><thead><tr><th>Person</th><th>Role and source</th></tr></thead><tbody><tr><td><img class="_7x_image" src="person.png" alt="Portrait"></td><td>Executive profile</td></tr></tbody></table></div>
  <div><table><thead><tr><th>Lotus</th><th>Water lily</th></tr></thead><tbody><tr><td><img class="_7x_image" src="lotus.png" alt="Lotus"><p>Rises above water</p></td><td><img class="_7x_image" src="lily.png" alt="Water lily"><p>Floats on water</p></td></tr></tbody></table></div>`)
  cleanup = installImageEnhancements(document)
  const style = document.querySelector('style[data-reply-images]')!
  expect(style.textContent).toContain('table:has(img)')
  expect(style.textContent).toContain('width: 84px')
  expect(style.textContent).toContain('max-height: 380px')
  expect(style.textContent).toContain('@media (max-width: 480px)')
  expect(
    document.querySelectorAll('[data-chat-group-part="response"] table img[data-reply-image-zoom]'),
  ).toHaveLength(3)
})

it('preserves the Markdown error fallback and restores prior attributes when an image becomes unavailable', () => {
  const section = response(
    '<img class="_7x_image" src="https://example.com/lotus.png" alt="Lotus" role="presentation">',
  )
  cleanup = installImageEnhancements(document)
  const image = section.querySelector('img')!
  expect(image.getAttribute('role')).toBe('button')
  Object.defineProperty(image, 'complete', { configurable: true, value: true })
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 0 })
  image.dispatchEvent(new Event('error'))
  expect(image.getAttribute('role')).toBe('presentation')
  expect(image.hasAttribute('data-reply-image-zoom')).toBe(false)
  expect(section.querySelector('img')?.getAttribute('alt')).toBe('Lotus')
})

it('cleans observers, listeners, injected styles, open dialogs and temporary image attributes on unload', () => {
  const section = response(
    '<img class="_7x_image" src="https://example.com/lotus.png" alt="Lotus" tabindex="3">',
  )
  cleanup = installImageEnhancements(document)
  const image = section.querySelector('img')!
  image.click()
  expect(document.querySelector('dialog')).not.toBeNull()
  cleanup()
  cleanup = undefined
  expect(document.querySelector('dialog')).toBeNull()
  expect(document.querySelector('style[data-reply-images]')).toBeNull()
  expect(image.getAttribute('tabindex')).toBe('3')
  expect(image.hasAttribute('role')).toBe(false)
  image.click()
  expect(document.querySelector('dialog')).toBeNull()
})

it('enhances image tables added after mount and leaves ordinary tables unchanged', async () => {
  const section = response('<table><tbody><tr><td>Plain</td><td>Text</td></tr></tbody></table>')
  cleanup = installImageEnhancements(document)
  const block = document.createElement('div')
  block.innerHTML =
    '<table><tbody><tr><td><img class="_7x_image" src="new.png" alt="New image"></td><td>Caption</td></tr></tbody></table>'
  section.querySelector('._7x_markdown')?.append(block)
  await Promise.resolve()
  await Promise.resolve()
  expect(block.querySelector('img')?.getAttribute('role')).toBe('button')
  expect(document.querySelector('style[data-reply-images]')?.textContent).toContain(
    'table:has(img)',
  )
  expect(section.querySelector('table:not(:has(img))')).not.toBeNull()
})

it('preserves native image buttons and link navigation, and keeps modified clicks inert', () => {
  const section = response(
    '<button type="button"><img class="_7x_image" src="native.png" alt="Native"></button><a href="https://example.com"><img class="_7x_image" src="linked.png" alt="Linked"></a><img class="_7x_image" src="plain.png" alt="Plain">',
  )
  const native = section.querySelector('button')!
  const clicked = vi.fn()
  native.addEventListener('click', clicked)
  cleanup = installImageEnhancements(document)
  native.click()
  expect(clicked).toHaveBeenCalledTimes(1)
  expect(section.querySelector('a img')?.getAttribute('role')).toBeNull()
  expect(native.querySelector('img')?.getAttribute('role')).toBeNull()
  const plain = section.querySelector<HTMLImageElement>('img[alt="Plain"]')!
  plain.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
  plain.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
  expect(document.querySelector('dialog')).toBeNull()
})

it('shows a readable failure message if the enlarged image fails and closes by its backdrop', () => {
  const section = response('<img class="_7x_image" src="plain.png" alt="Lotus">')
  cleanup = installImageEnhancements(document)
  section
    .querySelector('img')!
    .dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
  const dialog = document.querySelector('dialog')!
  dialog.querySelector('img')!.dispatchEvent(new Event('error'))
  expect(dialog.querySelector('img')!.hidden).toBe(true)
  expect(dialog.textContent).toContain('Lotus · Image unavailable')
  expect(document.querySelector('style[data-reply-images]')?.textContent).toContain(
    'img[hidden] { display: none; }',
  )
  dialog.click()
  expect(document.querySelector('dialog')).toBeNull()
})

it('keeps ordinary Markdown intact and still mounts non-overflow gallery layouts without native dialog', () => {
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal
  const section = response(
    `<p><img class="_7x_image" src="plain.png" alt="Lotus"></p><p>${gallery('collage', 3)}</p><p>${gallery('strip', 4)}</p>`,
  )
  cleanup = installImageEnhancements(document)
  section.querySelector('img')!.click()
  expect(document.querySelector('dialog')).toBeNull()
  expect(section.querySelector('img')?.src).toContain('plain.png')
  expect(section.querySelector('[data-reply-image-group="collage"]')).not.toBeNull()
  const strip = section.querySelector('[data-reply-image-group="strip"]')!
  expect(strip).not.toBeNull()
  expect(strip.querySelector('[data-reply-image-overflow]')).toBeNull()
  expect(strip.querySelector('[data-reply-image-badge]')).toBeNull()
})

it('mounts the optional client enhancement through Cordis effect and removes it on disposal', () => {
  const section = response('<img class="_7x_image" src="plain.png" alt="Lotus">')
  let dispose: (() => void) | undefined
  applyClient({
    effect: (register: () => () => void) => {
      dispose = register()
      return undefined
    },
  } as unknown as Context)
  expect(document.querySelector('style[data-reply-images]')).not.toBeNull()
  expect(section.querySelector('img')?.getAttribute('role')).toBe('button')
  dispose?.()
  expect(document.querySelector('style[data-reply-images]')).toBeNull()
  expect(section.querySelector('img')?.hasAttribute('role')).toBe(false)
})

const gallery = (layout: 'collage' | 'strip', count: number, group = 'gallery') =>
  Array.from({ length: count }, (_, index) => {
    const n = index + 1
    const image = `<img class="_7x_image" src="https://example.com/${n}.png#dsh-layout=${layout}&amp;group=${group}" alt="View ${n}">`
    return n % 2 ? image : `<span><span>${image}</span></span>`
  }).join(' ')

it('provides portrait cropping, comparison cells, and responsive collage styles', () => {
  cleanup = installImageEnhancements(document)
  const rules = document.querySelector('style[data-reply-images]')?.textContent
  expect(rules).toContain('aspect-ratio: 3 / 4')
  expect(rules).toContain('object-position: center 20%')
  expect(rules).toContain('table-layout: fixed')
  expect(rules).toContain('grid-row: 1 / 3')
  expect(rules).toContain('@media (max-width: 480px)')
  expect(rules).toContain('grid-column: 1 / 3')
})

it('enhances a streamed collage and falls back as images fail, preserving host markup', async () => {
  const section = response(`<p>${gallery('collage', 2)}</p>`)
  const paragraph = section.querySelector('p')!
  cleanup = installImageEnhancements(document)
  expect(paragraph.dataset.replyImageGroup).toBe('collage')
  expect(paragraph.dataset.replyImageCount).toBe('2')
  paragraph.insertAdjacentHTML(
    'beforeend',
    ' <span><img class="_7x_image" src="https://example.com/3.png#dsh-layout=collage&amp;group=gallery" alt="View 3"></span>',
  )
  const third = paragraph.querySelectorAll('img')[2]!
  Object.defineProperty(third, 'complete', { configurable: true, value: false })
  await Promise.resolve()
  expect(paragraph.dataset.replyImageCount).toBe('3')
  expect(paragraph.querySelectorAll('[data-reply-image-tile]')).toHaveLength(3)
  const fail = (image: HTMLImageElement) => {
    Object.defineProperty(image, 'complete', { configurable: true, value: true })
    image.dispatchEvent(new Event('error'))
  }
  fail(third)
  expect(paragraph.dataset.replyImageCount).toBe('2')
  expect(third.closest('[data-reply-image-tile]')).toBeNull()
  fail(paragraph.querySelectorAll('img')[1]!)
  expect(paragraph.dataset.replyImageGroup).toBeUndefined()
  expect(paragraph.querySelectorAll('img')).toHaveLength(3)
  expect(third.alt).toBe('View 3')
})

it('keeps independent fragment groups, links, mixed prose, and other chat parts unchanged', () => {
  const section = response(`
    <p>${gallery('collage', 1, 'first')} ${gallery('collage', 1, 'second')}</p>
    <p>Caption ${gallery('strip', 2)}</p>
    <p><a href="/elsewhere">${gallery('strip', 2)}</a></p>
    <div data-chat-group-part="reasoning"><p>${gallery('strip', 2)}</p></div>
  `)
  cleanup = installImageEnhancements(document)
  expect(section.querySelector('[data-reply-image-group]')).toBeNull()
  expect(section.querySelector('a img')?.hasAttribute('data-reply-image-zoom')).toBe(false)
  expect(
    section
      .querySelector('[data-chat-group-part="reasoning"] img')
      ?.hasAttribute('data-reply-image-zoom'),
  ).toBe(false)
})

it('opens the full strip from its overflow badge and navigates with buttons, keys and dots', () => {
  const paragraph = response(`<p>${gallery('strip', 4)}</p>`).querySelector('p')!
  cleanup = installImageEnhancements(document)
  expect(paragraph.dataset.replyImageGroup).toBe('strip')
  expect(paragraph.dataset.replyImageCount).toBe('4')
  expect(paragraph.querySelector('[data-reply-image-overflow] img')?.getAttribute('alt')).toBe(
    'View 4',
  )
  const badge = paragraph.querySelector('button')!
  expect(badge.textContent).toBe('4')
  badge.focus()
  badge.click()
  const dialog = document.querySelector('dialog')!
  const preview = () => dialog.querySelector('img')?.alt
  expect(preview()).toBe('View 4')
  expect(dialog.textContent).toContain('4 / 4')
  const button = (label: string) =>
    dialog.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
  button('Next image').click()
  expect(preview()).toBe('View 1')
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(preview()).toBe('View 2')
  button('Previous image').click()
  expect(preview()).toBe('View 1')
  button('Show image 3').click()
  expect(preview()).toBe('View 3')
  expect(button('Show image 3').getAttribute('aria-current')).toBe('true')
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  expect(preview()).toBe('View 2')
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
  expect(document.querySelector('dialog')).toBeNull()
  expect(document.activeElement).toBe(badge)
  paragraph.querySelector('img')!.click()
  expect(document.querySelector('dialog img')?.getAttribute('alt')).toBe('View 1')
})

it('restricts table navigation to eligible images in the same table', () => {
  const section = response(`
    <table><tr><td>${gallery('strip', 1)}</td><td><img class="_7x_image" src="other.png" alt="View B"></td></tr></table>
    <table><tr><td><img class="_7x_image" src="outside.png" alt="Outside"></td></tr></table>
  `)
  cleanup = installImageEnhancements(document)
  const image = section.querySelector('img')!
  image.click()
  const dialog = document.querySelector('dialog')!
  expect(dialog.textContent).toContain('1 / 2')
  dialog.querySelector<HTMLButtonElement>('[aria-label="Next image"]')!.click()
  expect(dialog.querySelector('img')?.alt).toBe('View B')
  dialog.querySelector<HTMLButtonElement>('header button')!.click()
  expect(document.activeElement).toBe(image)
  section.querySelector<HTMLImageElement>('img[alt="Outside"]')!.click()
  expect(document.querySelectorAll('dialog button')).toHaveLength(1)
})

it('restores gallery attributes, removes the badge and dialog, and retains original wrapper nodes on unload', () => {
  const paragraph = response(
    `<p data-reply-image-count="original">${gallery('strip', 5)}</p>`,
  ).querySelector('p')!
  const original = paragraph.innerHTML
  cleanup = installImageEnhancements(document)
  paragraph.querySelector('button')!.click()
  expect(document.querySelector('dialog')).not.toBeNull()
  cleanup()
  cleanup = undefined
  expect(paragraph.innerHTML).toBe(original)
  expect(paragraph.dataset.replyImageCount).toBe('original')
  expect(paragraph.dataset.replyImageGroup).toBeUndefined()
  expect(document.querySelector('dialog, style[data-reply-images]')).toBeNull()
})

it('enhances DSH 44.7+ _imageButton/_image DOM with alt markers, caption-inferred strips, and group lightbox capture', () => {
  const nativeTile = (n: number, alt: string) =>
    `<button type="button" class="_imageButton_13jw0_471" title="Open"><img class="_image_13jw0_300" src="http://127.0.0.1:11346/api/file?path=C%3A%2Fimg${n}.png&amp;load=${n}" alt="${alt}"></button>`
  const section = response(`
    <p id="collage">${[1, 2, 3].map((n) => nativeTile(n, `Scene ${n}\u200B\u200C`)).join(' ')}</p>
    <p id="legacy-strip">${[1, 2, 3].map((n) => nativeTile(n + 3, `Photo ${n}`)).join(' ')}</p>
    <p id="legacy-caption"><em>图片来源：<a href="https://example.com/">News</a></em></p>
    <p id="single">${nativeTile(7, 'Solo')}</p>
  `)
  const collage = section.querySelector<HTMLParagraphElement>('#collage')!
  const legacyStrip = section.querySelector<HTMLParagraphElement>('#legacy-strip')!
  const legacyCaption = section.querySelector<HTMLParagraphElement>('#legacy-caption')!
  const singleButton = section.querySelector<HTMLButtonElement>('#single button')!
  const collageButton = collage.querySelector<HTMLButtonElement>('button')!
  const singleHostClick = vi.fn()
  const collageHostClick = vi.fn()
  singleButton.addEventListener('click', singleHostClick)
  collageButton.addEventListener('click', collageHostClick)

  cleanup = installImageEnhancements(document)

  expect(collage.dataset.replyImageGroup).toBe('collage')
  expect(collage.dataset.replyImageCount).toBe('3')
  expect(legacyStrip.dataset.replyImageGroup).toBe('strip')
  expect(legacyCaption.hasAttribute('data-reply-image-caption')).toBe(true)
  expect(singleButton.querySelector('img')?.hasAttribute('data-reply-image-single')).toBe(true)
  expect(singleButton.querySelector('img')?.hasAttribute('role')).toBe(false)

  // Single native image delegates to host button click.
  singleButton.click()
  expect(singleHostClick).toHaveBeenCalledTimes(1)
  expect(document.querySelector('dialog')).toBeNull()

  // Multi-image collage intercepts native button click to open multi-image lightbox with cleaned alt.
  collageButton.click()
  expect(collageHostClick).not.toHaveBeenCalled()
  const dialog = document.querySelector('dialog')!
  expect(dialog.open).toBe(true)
  expect(dialog.getAttribute('aria-label')).toBe('Scene 1')
  expect(dialog.querySelector('img')?.alt).toBe('Scene 1')
  expect(dialog.textContent).toContain('Scene 1 · 1 / 3')

  cleanup()
  cleanup = undefined
  expect(collage.hasAttribute('data-reply-image-group')).toBe(false)
  expect(singleButton.querySelector('img')?.hasAttribute('data-reply-image-single')).toBe(false)
})

it('rescues inline image-and-source list paragraphs into a responsive grid with group lightbox and full cleanup', async () => {
  const nativeTile = (n: number, alt: string) =>
    `<button type="button" class="_imageButton_13jw0_471" title="Open"><img class="_image_13jw0_300" src="http://127.0.0.1:11346/api/file?path=C%3A%2Fperson${n}.png" alt="${alt}"></button>`
  const sourceItem = (n: number, alt: string) =>
    `${nativeTile(n, alt)} <em>Image source: <a href="https://example.com/${n}">source-${n}.org</a> · License unconfirmed</em>`
  const section = response(`
    <p id="rescued">${[1, 2, 3, 4, 5].map((n) => sourceItem(n, `Scientist ${n}`)).join(' · ')}</p>
    <p id="web-pair"><img class="_7x_image" src="a.png" alt="A"> <em>图片来源：<a href="https://example.com/a">A</a></em> · <img class="_7x_image" src="b.png" alt="B"> <em>图片来源：<a href="https://example.com/b">B</a></em></p>
    <p id="prose">Intro text ${sourceItem(6, 'Mixed')} · ${sourceItem(7, 'Mixed 2')}</p>
    <p id="dangling">${sourceItem(8, 'Dangling')} · ${nativeTile(9, 'No source')}</p>
    <table><tbody><tr><td><p id="in-table">${sourceItem(10, 'Cell 1')} · ${sourceItem(11, 'Cell 2')}</p></td></tr></tbody></table>
  `)
  const rescued = section.querySelector<HTMLParagraphElement>('#rescued')!
  const webPair = section.querySelector<HTMLParagraphElement>('#web-pair')!
  const prose = section.querySelector<HTMLParagraphElement>('#prose')!
  const dangling = section.querySelector<HTMLParagraphElement>('#dangling')!
  const inTable = section.querySelector<HTMLParagraphElement>('#in-table')!
  const original = rescued.innerHTML

  cleanup = installImageEnhancements(document)

  expect(rescued.hasAttribute('data-reply-image-source-list')).toBe(true)
  expect(rescued.dataset.replyImageCount).toBe('5')
  expect(rescued.querySelectorAll('[data-reply-image-list-tile]')).toHaveLength(5)
  expect(rescued.querySelectorAll('[data-reply-image-list-source]')).toHaveLength(5)
  expect(webPair.hasAttribute('data-reply-image-source-list')).toBe(true)
  expect(webPair.dataset.replyImageCount).toBe('2')
  expect(prose.hasAttribute('data-reply-image-source-list')).toBe(false)
  expect(dangling.hasAttribute('data-reply-image-source-list')).toBe(false)
  expect(inTable.hasAttribute('data-reply-image-source-list')).toBe(false)

  // Clicking a native tile inside the rescued list opens the 5-image lightbox.
  const secondButton = rescued.querySelectorAll<HTMLButtonElement>('button')[1]!
  const hostClick = vi.fn()
  secondButton.addEventListener('click', hostClick)
  secondButton.click()
  expect(hostClick).not.toHaveBeenCalled()
  const dialog = document.querySelector('dialog')!
  expect(dialog.open).toBe(true)
  expect(dialog.textContent).toContain('Scientist 2 · 2 / 5')
  dialog.querySelector<HTMLButtonElement>('header button')!.click()
  expect(document.querySelector('dialog')).toBeNull()

  // Failing an image reconciles counts and falls back if fewer than 2 remain.
  const webImages = webPair.querySelectorAll('img')
  Object.defineProperty(webImages[1]!, 'complete', { configurable: true, value: true })
  Object.defineProperty(webImages[1]!, 'naturalWidth', { configurable: true, value: 0 })
  webImages[1]!.dispatchEvent(new Event('error'))
  await Promise.resolve()
  expect(webPair.hasAttribute('data-reply-image-source-list')).toBe(false)

  // Adding non-separator text unmounts the rescued list cleanly.
  const extra = document.createTextNode(' extra prose')
  rescued.append(extra)
  await Promise.resolve()
  expect(rescued.hasAttribute('data-reply-image-source-list')).toBe(false)
  extra.remove()
  await Promise.resolve()
  expect(rescued.hasAttribute('data-reply-image-source-list')).toBe(true)

  cleanup()
  cleanup = undefined
  expect(rescued.hasAttribute('data-reply-image-source-list')).toBe(false)
  expect(rescued.innerHTML).toBe(original)
})
