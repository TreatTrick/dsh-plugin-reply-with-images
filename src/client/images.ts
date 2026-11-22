import { IMAGE_STYLES } from './styles.js'

const RESPONSE = '[data-chat-group-part="response"]'
const INTERACTIVE = 'a, button, [role="button"], [role="link"], [contenteditable="true"]'
const MARKDOWN_IMAGE = /(?:^|_)image(?:_|$)/u
const NATIVE_IMAGE_BUTTON = /(?:^|_)imageButton(?:_|$)/u
const COLLAGE_ALT_MARK = '\u200B\u200C'
const STRIP_ALT_MARK = '\u200B\u200D'
const SOURCE_CAPTION = /^(?:Image sources?[:：]|图片来源[:：])/iu
const SOURCE_SEPARATOR = /^[\s·•|,]+$/u
const cleanAlt = (alt: string) => alt.replace(/[\u200B-\u200D]+$/u, '').trimEnd()

type GalleryLayout = 'collage' | 'strip'
interface GalleryTile {
  image: HTMLImageElement
  element: Element
}
interface Gallery {
  layout: GalleryLayout
  tiles: GalleryTile[]
}
interface MountedGallery extends Gallery {
  badge?: HTMLButtonElement
  restore: () => void
}
interface SourceListItem {
  tile: Element
  image: HTMLImageElement
  source: HTMLElement
}
interface MountedSourceList {
  items: SourceListItem[]
  restore: () => void
}
interface MountedZoom {
  label: string
  originalTitle: string | null
  restore: () => void
}

type LayoutMarker = { layout: GalleryLayout; group: string; channel: 'hash' | 'title' | 'alt' }
type GalleryRejection =
  'no-marker' | 'mixed-text' | 'class-mismatch' | 'single-image' | 'inconsistent-group'

const parseMarker = (text: string, channel: 'hash' | 'title'): LayoutMarker | undefined => {
  const params = new URLSearchParams(text.trim())
  const layout = params.get('dsh-layout')
  const group = params.get('group')
  if ((layout === 'collage' || layout === 'strip') && group) return { layout, group, channel }
}

const parseAltMarker = (alt: string): LayoutMarker | undefined => {
  if (alt.endsWith(COLLAGE_ALT_MARK))
    return { layout: 'collage', group: 'alt-collage', channel: 'alt' }
  if (alt.endsWith(STRIP_ALT_MARK)) return { layout: 'strip', group: 'alt-strip', channel: 'alt' }
}

const setAttributes = (element: Element, attributes: Record<string, string>) => {
  const previous = Object.entries(attributes).map(([key, value]) => {
    const original = element.getAttribute(key)
    element.setAttribute(key, value)
    return [key, original] as const
  })
  return () => {
    for (const [key, value] of previous) {
      if (value === null) element.removeAttribute(key)
      else element.setAttribute(key, value)
    }
  }
}

const inResponse = (element: Element) =>
  element.closest('[data-chat-group-part]')?.matches(RESPONSE) === true

const nativeImageButton = (image: HTMLImageElement): HTMLButtonElement | null => {
  const button = image.closest('button')
  return button &&
    [...button.classList].some((name) => NATIVE_IMAGE_BUTTON.test(name)) &&
    button.querySelectorAll('img').length === 1
    ? button
    : null
}

const markdownImage = (image: HTMLImageElement) => {
  if (!inResponse(image) || ![...image.classList].some((name) => MARKDOWN_IMAGE.test(name)))
    return false
  const nativeButton = nativeImageButton(image)
  const host = nativeButton ?? image
  if (host.parentElement?.closest(INTERACTIVE) !== null) return false
  return (
    nativeButton !== null ||
    image.hasAttribute('data-reply-image-zoom') ||
    !image.matches(INTERACTIVE)
  )
}

const isAvailable = (image: HTMLImageElement) => !image.complete || image.naturalWidth > 0

const DIRECTORY_HEADERS = [
  /^(?:images?|photos?|pictures?|portraits?|people|person|图片|图像|照片|肖像|人物)$/iu,
  /^(?:description|details|name|person|people|描述|说明|简介|介绍|名称|姓名|人物)$/iu,
  /^(?:source(?:s)?(?: and licen[cs]e)?|来源(?:与许可|和许可)?|来源及许可)$/iu,
]

/** 仅识别通用首列图片目录；复杂表头、合并单元格与嵌套表保留原始语义。 */
const isImageDirectory = (table: HTMLTableElement) => {
  if (
    !inResponse(table) ||
    table.parentElement?.closest('table') ||
    table.querySelector('table, [data-chat-group-part]') ||
    table.tFoot
  )
    return false
  const head = table.tHead
  const headers = head?.rows[0]?.cells
  if (!head || head.rows.length !== 1 || !headers || headers.length < 2 || headers.length > 3)
    return false
  if (
    ![...headers].every(
      (cell, index) =>
        cell.tagName === 'TH' &&
        cell.colSpan === 1 &&
        cell.rowSpan === 1 &&
        !cell.querySelector('img') &&
        DIRECTORY_HEADERS[index]?.test(
          (cell.textContent ?? '').trim().replace(/\s+/gu, ' ').replace(/&/gu, 'and'),
        ),
    )
  )
    return false
  const rows = [...table.tBodies].flatMap((body) => [...body.rows])
  let imageCount = 0
  const matches = rows.every((row) => {
    const cells = [...row.cells]
    if (
      cells.length !== headers.length ||
      cells.some((cell) => cell.tagName !== 'TD' || cell.colSpan !== 1 || cell.rowSpan !== 1) ||
      cells.slice(1).some((cell) => cell.querySelector('img'))
    )
      return false
    const first = cells[0]!
    const images = first.querySelectorAll('img')
    if (!images.length)
      return /^(?:[—–-]|no image(?: available)?|暂无图片|无图)?$/iu.test(
        first.textContent?.trim() ?? '',
      )
    if (images.length !== 1) return false
    imageCount++
    return true
  })
  return matches && imageCount > 0
}

/** 仅对独立的图片段落布局，保留包装器、正文与失败图片的宿主回退。 */
const readGallery = (
  block: HTMLParagraphElement,
  imageMarker: (image: HTMLImageElement) => LayoutMarker | undefined,
  existingBadge: HTMLButtonElement | undefined,
): Gallery | GalleryRejection => {
  const tiles: GalleryTile[] = []
  let token: LayoutMarker | undefined
  let sawUnmarked = false
  for (const node of block.childNodes) {
    if (node === existingBadge || node.nodeType === Node.COMMENT_NODE) continue
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue
    if (!(node instanceof Element) || node.textContent?.trim()) return 'mixed-text'
    const images = node instanceof HTMLImageElement ? [node] : node.querySelectorAll('img')
    const image = images[0]
    if (images.length !== 1 || !image || !markdownImage(image)) return 'class-mismatch'
    const marker = imageMarker(image)
    if (!marker) {
      if (token) return 'inconsistent-group'
      sawUnmarked = true
    } else {
      if (
        sawUnmarked ||
        (token && (token.group !== marker.group || token.layout !== marker.layout))
      )
        return 'inconsistent-group'
      token = marker
    }
    if (isAvailable(image)) tiles.push({ image, element: node })
  }
  if (!token) {
    const caption = !block.closest('table') ? imageCaption(block) : undefined
    if (!caption || tiles.length < 2) return 'no-marker'
    const inferred: GalleryLayout =
      tiles.length === 3 && /(?:collage|拼贴)/i.test(caption.textContent ?? '')
        ? 'collage'
        : 'strip'
    return { layout: inferred, tiles }
  }
  if (tiles.length < 2) return 'single-image'
  const layout = token.layout === 'collage' && tiles.length <= 3 ? 'collage' : 'strip'
  return { layout, tiles }
}

const imageCaption = (block: HTMLParagraphElement) => {
  const caption = block.nextElementSibling
  if (!(caption instanceof HTMLParagraphElement)) return
  const emphasis = caption.firstElementChild
  if (emphasis?.tagName !== 'EM' || caption.childElementCount !== 1) return
  if ([...caption.childNodes].some((node) => node !== emphasis && node.textContent?.trim())) return
  if (SOURCE_CAPTION.test(emphasis.textContent?.trim() ?? '')) return caption
}

/** 兜底修复误将多图 tableMarkdown 直接粘贴到段落中的“图 + 来源 · 图 + 来源”排布。 */
const readSourceList = (block: HTMLParagraphElement): SourceListItem[] | undefined => {
  if (block.closest('table')) return undefined
  const items: SourceListItem[] = []
  let pending: { tile: Element; image: HTMLImageElement } | undefined
  let expecting: 'tile' | 'source' | 'separator' = 'tile'
  for (const node of block.childNodes) {
    if (node.nodeType === Node.COMMENT_NODE) continue
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (!text.trim()) continue
      if (expecting === 'separator' && SOURCE_SEPARATOR.test(text)) {
        expecting = 'tile'
        continue
      }
      return undefined
    }
    if (!(node instanceof Element)) return undefined
    if (expecting === 'source') {
      if (node.tagName !== 'EM' || !SOURCE_CAPTION.test(node.textContent?.trim() ?? ''))
        return undefined
      if (pending && isAvailable(pending.image))
        items.push({ tile: pending.tile, image: pending.image, source: node as HTMLElement })
      pending = undefined
      expecting = 'separator'
      continue
    }
    if (node.textContent?.trim()) return undefined
    const images = node instanceof HTMLImageElement ? [node] : node.querySelectorAll('img')
    const image = images[0]
    if (images.length !== 1 || !image || !markdownImage(image)) return undefined
    pending = { tile: node, image }
    expecting = 'source'
  }
  if (expecting === 'source' || items.length < 2 || items.length > 6) return undefined
  return items
}

const sameSourceList = (current: MountedSourceList, next: SourceListItem[]) =>
  current.items.length === next.length &&
  next.every(
    ({ tile, image, source }, index) =>
      current.items[index]?.tile === tile &&
      current.items[index]?.image === image &&
      current.items[index]?.source === source,
  )

const mountSourceList = (
  block: HTMLParagraphElement,
  items: SourceListItem[],
): MountedSourceList => {
  const restore = [
    setAttributes(block, {
      'data-reply-image-source-list': '',
      'data-reply-image-count': String(items.length),
    }),
  ]
  items.forEach(({ tile, source }, index) => {
    const position = String(index + 1)
    restore.push(setAttributes(tile, { 'data-reply-image-list-tile': position }))
    restore.push(setAttributes(source, { 'data-reply-image-list-source': position }))
  })
  return {
    items,
    restore: () => restore.forEach((reset) => reset()),
  }
}

const sameGallery = (current: MountedGallery, next: Gallery) =>
  current.layout === next.layout &&
  current.tiles.length === next.tiles.length &&
  next.tiles.every(
    ({ image, element }, index) =>
      current.tiles[index]?.image === image && current.tiles[index]?.element === element,
  )

const makeButton = (document: Document, label: string, text: string) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', label)
  button.textContent = text
  return button
}

const mountGallery = (
  block: HTMLParagraphElement,
  gallery: Gallery,
  canOpenDialog: boolean,
): MountedGallery => {
  const restore = [
    setAttributes(block, {
      'data-reply-image-group': gallery.layout,
      'data-reply-image-count': String(gallery.tiles.length),
    }),
  ]
  gallery.tiles.forEach(({ element }, index) => {
    restore.push(
      setAttributes(element, {
        'data-reply-image-tile': String(index + 1),
        ...(canOpenDialog && gallery.layout === 'strip' && index >= 3
          ? { 'data-reply-image-overflow': '' }
          : {}),
      }),
    )
  })
  let badge: HTMLButtonElement | undefined
  if (canOpenDialog && gallery.layout === 'strip' && gallery.tiles.length > 3) {
    const count = gallery.tiles.length
    badge = makeButton(block.ownerDocument, `View all ${count} images`, String(count))
    badge.dataset.replyImageBadge = ''
    badge.setAttribute('aria-haspopup', 'dialog')
    block.append(badge)
  }
  return {
    ...gallery,
    ...(badge ? { badge } : {}),
    restore: () => {
      badge?.remove()
      restore.forEach((reset) => reset())
    },
  }
}

const buildViewer = (document: Document, images: HTMLImageElement[], start: number) => {
  const dialog = document.createElement('dialog')
  dialog.className = 'reply-images-viewer'
  const header = document.createElement('header')
  const caption = document.createElement('p')
  caption.setAttribute('aria-live', 'polite')
  const close = makeButton(document, 'Close', 'Close')
  close.addEventListener('click', () => dialog.close())
  header.append(caption, close)
  const stage = document.createElement('div')
  stage.className = 'reply-images-stage'
  dialog.append(header, stage)
  const dots: HTMLButtonElement[] = []
  let index = start

  const show = (next: number) => {
    index = (next + images.length) % images.length
    const image = images[index]!
    const enlarged = document.createElement('img')
    const clean = cleanAlt(image.alt)
    const title = clean || 'Image preview'
    const position = images.length > 1 ? ` · ${index + 1} / ${images.length}` : ''
    enlarged.alt = clean
    enlarged.decoding = 'async'
    enlarged.referrerPolicy = 'no-referrer'
    caption.textContent = `${title}${position}`
    dialog.setAttribute('aria-label', title)
    enlarged.addEventListener('error', () => {
      if (!stage.contains(enlarged)) return
      enlarged.hidden = true
      caption.textContent = `${clean || 'Image'} · Image unavailable${position}`
    })
    stage.replaceChildren(enlarged)
    enlarged.src = image.currentSrc || image.src
    dots.forEach((dot, dotIndex) => dot.setAttribute('aria-current', String(dotIndex === index)))
  }

  if (images.length > 1) {
    const controls = document.createElement('footer')
    const pagination = document.createElement('div')
    pagination.className = 'reply-images-pagination'
    pagination.setAttribute('role', 'group')
    pagination.setAttribute('aria-label', 'Image pagination')
    images.forEach((_, dotIndex) => {
      const dot = makeButton(document, `Show image ${dotIndex + 1}`, '')
      dot.addEventListener('click', () => show(dotIndex))
      dots.push(dot)
      pagination.append(dot)
    })
    const previous = makeButton(document, 'Previous image', '‹')
    const next = makeButton(document, 'Next image', '›')
    previous.addEventListener('click', () => show(index - 1))
    next.addEventListener('click', () => show(index + 1))
    controls.append(previous, pagination, next)
    dialog.append(controls)
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      show(index + (event.key === 'ArrowRight' ? 1 : -1))
    })
  }
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    dialog.close()
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
  show(start)
  return { dialog, close }
}

/** 为普通回答图片补充可访问的放大交互，保留宿主原生按钮和链接的所有权。 */
export const installImageEnhancements = (document: Document): (() => void) => {
  const style = document.createElement('style')
  style.dataset.replyImages = ''
  style.textContent = IMAGE_STYLES
  document.head.append(style)
  const zoom = new Map<HTMLImageElement, MountedZoom>()
  const nativeImages = new Map<HTMLImageElement, () => void>()
  const galleries = new Map<HTMLParagraphElement, MountedGallery>()
  const sourceLists = new Map<HTMLParagraphElement, MountedSourceList>()
  const captions = new Map<HTMLParagraphElement, () => void>()
  const directories = new Map<HTMLTableElement, () => void>()
  const markers = new WeakMap<
    HTMLImageElement,
    { rawSrc: string; src: string; title: string; alt: string; marker: LayoutMarker | undefined }
  >()
  const hasDialog = typeof document.createElement('dialog').showModal === 'function'
  let closeViewer: (() => void) | undefined
  let disposed = false
  const mountedAt = new Date().toISOString()
  const view = document.defaultView
  let lastSummary: string | undefined

  const imageMarker = (image: HTMLImageElement) => {
    const rawSrc = image.getAttribute('src') ?? ''
    const src = image.src
    const control = zoom.get(image)
    const title = control?.label === image.title ? (control.originalTitle ?? '') : image.title
    const alt = image.alt
    const cached = markers.get(image)
    if (
      cached?.rawSrc === rawSrc &&
      cached.src === src &&
      cached.title === title &&
      cached.alt === alt
    )
      return cached.marker
    let marker: LayoutMarker | undefined
    for (const source of [rawSrc, src]) {
      const hash = source.indexOf('#')
      if (hash < 0) continue
      marker = parseMarker(source.slice(hash + 1), 'hash')
      if (marker) break
    }
    marker ??= parseMarker(title, 'title') ?? parseAltMarker(alt)
    markers.set(image, { rawSrc, src, title, alt, marker })
    return marker
  }

  const responseImages = () =>
    [...document.querySelectorAll<HTMLImageElement>(`${RESPONSE} img`)].filter(inResponse)
  const snapshot = () => {
    const images = disposed ? [] : responseImages()
    const paragraphs = new Set(images.map((image) => image.closest('p')))
    return {
      mounted: !disposed,
      mountedAt,
      images: images.map((image) => {
        const marker = imageMarker(image)
        return {
          src: image.src.slice(0, 180),
          classList: [...image.classList],
          marker: marker && { ...marker },
          markdownImage: markdownImage(image),
          available: isAvailable(image),
        }
      }),
      paragraphs: [...paragraphs]
        .filter((block) => block !== null)
        .map((block) => {
          const result = readGallery(block, imageMarker, galleries.get(block)?.badge)
          const imageCount = block.querySelectorAll('img').length
          return typeof result === 'string'
            ? { status: 'rejected' as const, reason: result, imageCount }
            : { status: 'matched' as const, layout: result.layout, imageCount }
        }),
    }
  }
  const debug = Object.freeze({ snapshot })
  if (view) Object.defineProperty(view, '__replyImagesDebug', { value: debug, configurable: true })

  const logSnapshot = () => {
    try {
      if (view?.localStorage.getItem('reply-images:debug') !== '1') return
      const state = snapshot()
      const summary = { imageCount: state.images.length, paragraphs: state.paragraphs }
      const signature = JSON.stringify(summary)
      if (signature === lastSummary) return
      lastSummary = signature
      console.debug('[reply-with-images]', summary)
    } catch {
      // The client can restrict localStorage access.
    }
  }

  const restoreZoom = (image: HTMLImageElement, control: MountedZoom) => {
    control.restore()
    if (image.title !== control.label) return
    if (control.originalTitle === null) image.removeAttribute('title')
    else image.title = control.originalTitle
  }

  const refresh = () => {
    if (disposed) return
    const nextDirectories = new Set(
      [...document.querySelectorAll<HTMLTableElement>(`${RESPONSE} table`)].filter(
        isImageDirectory,
      ),
    )
    for (const [table, restore] of directories) {
      if (nextDirectories.has(table)) continue
      restore()
      directories.delete(table)
    }
    for (const table of nextDirectories) {
      if (!directories.has(table))
        directories.set(table, setAttributes(table, { 'data-reply-image-directory': '' }))
    }
    for (const [image, control] of zoom) {
      if (
        image.isConnected &&
        markdownImage(image) &&
        !nativeImageButton(image) &&
        isAvailable(image)
      )
        continue
      restoreZoom(image, control)
      zoom.delete(image)
    }
    for (const [image, restore] of nativeImages) {
      if (
        image.isConnected &&
        markdownImage(image) &&
        nativeImageButton(image) &&
        isAvailable(image)
      )
        continue
      restore()
      nativeImages.delete(image)
    }
    const paragraphs = new Set<HTMLParagraphElement>()
    const sourceListBlocks = new Set<HTMLParagraphElement>()
    const nextCaptions = new Set<HTMLParagraphElement>()
    for (const image of responseImages()) {
      if (!markdownImage(image)) continue
      const marker = imageMarker(image)
      const block = image.closest('p')
      if (block) {
        const caption = imageCaption(block)
        if (caption) nextCaptions.add(caption)
        if (!block.closest('table')) sourceListBlocks.add(block)
        if (marker || (caption && !block.closest('table'))) paragraphs.add(block)
      }
      const hasNativeButton = nativeImageButton(image) !== null
      if (hasNativeButton) {
        if (isAvailable(image) && !nativeImages.has(image))
          nativeImages.set(image, setAttributes(image, { 'data-reply-image-single': '' }))
      } else if (hasDialog && isAvailable(image)) {
        let control = zoom.get(image)
        if (!control) {
          const label = `View image: ${cleanAlt(image.alt) || 'image'}`
          control = {
            label,
            originalTitle: image.getAttribute('title'),
            restore: setAttributes(image, {
              tabindex: '0',
              role: 'button',
              'aria-haspopup': 'dialog',
              'aria-label': label,
              'data-reply-image-zoom': '',
            }),
          }
          zoom.set(image, control)
        }
        if (image.title !== control.label) {
          control.originalTitle = image.getAttribute('title')
          image.title = control.label
        }
      }
    }
    for (const [caption, restore] of captions) {
      if (nextCaptions.has(caption)) continue
      restore()
      captions.delete(caption)
    }
    for (const caption of nextCaptions) {
      if (!captions.has(caption))
        captions.set(caption, setAttributes(caption, { 'data-reply-image-caption': '' }))
    }
    for (const block of new Set([...galleries.keys(), ...paragraphs])) {
      const current = galleries.get(block)
      const result = paragraphs.has(block)
        ? readGallery(block, imageMarker, current?.badge)
        : undefined
      const next = typeof result === 'object' ? result : undefined
      if (
        next &&
        current &&
        sameGallery(current, next) &&
        (!current.badge || current.badge.parentElement === block)
      )
        continue
      current?.restore()
      if (next) galleries.set(block, mountGallery(block, next, hasDialog))
      else galleries.delete(block)
    }
    for (const block of new Set([...sourceLists.keys(), ...sourceListBlocks])) {
      const current = sourceLists.get(block)
      const next =
        sourceListBlocks.has(block) && !galleries.has(block) ? readSourceList(block) : undefined
      if (next && current && sameSourceList(current, next)) continue
      current?.restore()
      if (next) sourceLists.set(block, mountSourceList(block, next))
      else sourceLists.delete(block)
    }
    logSnapshot()
  }

  const open = (trigger: HTMLElement, images: HTMLImageElement[], index: number) => {
    if (closeViewer || !images.length) return
    const { dialog, close } = buildViewer(document, images, index)
    const remove = () => {
      if (closeViewer !== dispose) return
      closeViewer = undefined
      dialog.remove()
      if (trigger.isConnected) trigger.focus()
    }
    const dispose = () => {
      if (dialog.open) dialog.close()
      remove()
    }
    dialog.addEventListener('close', remove, { once: true })
    document.body.append(dialog)
    closeViewer = dispose
    dialog.showModal()
    close.focus()
  }

  const groupMembersFor = (image: HTMLImageElement) => {
    const block = image.closest('p')
    const gallery = block ? galleries.get(block) : undefined
    if (gallery?.tiles.some(({ image: tile }) => tile === image))
      return gallery.tiles.map(({ image: tile }) => tile)
    const sourceList = block ? sourceLists.get(block) : undefined
    if (sourceList?.items.some(({ image: tile }) => tile === image))
      return sourceList.items.map(({ image: tile }) => tile)
    const table = image.closest('table')
    if (table)
      return [...table.querySelectorAll('img')].filter(
        (candidate) =>
          candidate.closest('table') === table &&
          (zoom.has(candidate) || nativeImages.has(candidate)) &&
          isAvailable(candidate),
      )
    return [image]
  }

  const isActivation = (event: MouseEvent | KeyboardEvent) =>
    event instanceof MouseEvent
      ? event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      : event.key === 'Enter' || event.key === ' '

  const activateNativeGroup = (event: MouseEvent | KeyboardEvent) => {
    if (!hasDialog || event.defaultPrevented || !isActivation(event)) return
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button')
    const image = button?.querySelector('img')
    if (
      !button ||
      !image ||
      nativeImageButton(image) !== button ||
      !markdownImage(image) ||
      !isAvailable(image)
    )
      return
    const members = groupMembersFor(image)
    if (members.length <= 1) return
    event.preventDefault()
    event.stopPropagation()
    open(button, members, members.indexOf(image))
  }

  const activate = (event: MouseEvent | KeyboardEvent) => {
    const trigger = event.target
    if (!(trigger instanceof HTMLElement) || event.defaultPrevented || !isActivation(event)) return
    const block = trigger.closest('p')
    const gallery = block ? galleries.get(block) : undefined
    if (gallery?.badge === trigger) {
      if (event instanceof MouseEvent)
        open(
          trigger,
          gallery.tiles.map(({ image }) => image),
          3,
        )
      return
    }
    if (
      !(trigger instanceof HTMLImageElement) ||
      !zoom.has(trigger) ||
      !isAvailable(trigger) ||
      !markdownImage(trigger)
    )
      return
    const members = groupMembersFor(trigger)
    event.preventDefault()
    open(trigger, members, members.indexOf(trigger))
  }

  const observer = new MutationObserver((records) => {
    if (
      records.some(
        ({ target }) => !(target instanceof Element && target.closest('.reply-images-viewer')),
      )
    )
      refresh()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
    attributeFilter: [
      'src',
      'srcset',
      'href',
      'title',
      'alt',
      'class',
      'colspan',
      'rowspan',
      'data-chat-group-part',
    ],
  })
  const refreshImage = (event: Event) => {
    if (event.target instanceof HTMLImageElement && inResponse(event.target)) refresh()
  }
  document.addEventListener('click', activateNativeGroup, true)
  document.addEventListener('keydown', activateNativeGroup, true)
  document.addEventListener('click', activate)
  document.addEventListener('keydown', activate)
  document.addEventListener('load', refreshImage, true)
  document.addEventListener('error', refreshImage, true)
  refresh()
  return () => {
    disposed = true
    observer.disconnect()
    document.removeEventListener('click', activateNativeGroup, true)
    document.removeEventListener('keydown', activateNativeGroup, true)
    document.removeEventListener('click', activate)
    document.removeEventListener('keydown', activate)
    document.removeEventListener('load', refreshImage, true)
    document.removeEventListener('error', refreshImage, true)
    closeViewer?.()
    for (const gallery of galleries.values()) gallery.restore()
    for (const list of sourceLists.values()) list.restore()
    for (const [image, control] of zoom) restoreZoom(image, control)
    for (const restore of nativeImages.values()) restore()
    for (const restore of captions.values()) restore()
    for (const restore of directories.values()) restore()
    galleries.clear()
    sourceLists.clear()
    zoom.clear()
    nativeImages.clear()
    captions.clear()
    directories.clear()
    if (view && Object.getOwnPropertyDescriptor(view, '__replyImagesDebug')?.value === debug)
      Reflect.deleteProperty(view, '__replyImagesDebug')
    style.remove()
  }
}
