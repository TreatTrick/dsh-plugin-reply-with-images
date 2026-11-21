import { IMAGE_STYLES } from './styles.js'

const RESPONSE = '[data-chat-group-part="response"]'
const INTERACTIVE = 'a, button, [role="button"], [role="link"], [contenteditable="true"]'
const MARKDOWN_IMAGE = /_image$/u

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

const imageFragment = (
  image: HTMLImageElement,
): { layout: GalleryLayout; group: string } | undefined => {
  for (const source of [image.getAttribute('src'), image.src]) {
    const hash = source?.indexOf('#') ?? -1
    if (!source || hash < 0) continue
    const fragment = new URLSearchParams(source.slice(hash + 1))
    const layout = fragment.get('dsh-layout')
    const group = fragment.get('group')
    if ((layout === 'collage' || layout === 'strip') && group) return { layout, group }
  }
  return undefined
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

const markdownImage = (image: HTMLImageElement) =>
  inResponse(image) &&
  [...image.classList].some((name) => MARKDOWN_IMAGE.test(name)) &&
  (image.hasAttribute('data-reply-image-zoom') || !image.matches(INTERACTIVE)) &&
  image.parentElement?.closest(INTERACTIVE) === null

const isAvailable = (image: HTMLImageElement) => !image.complete || image.naturalWidth > 0

/** 仅对独立的图片段落布局，保留包装器、正文与失败图片的宿主回退。 */
const readGallery = (
  block: HTMLParagraphElement,
  existingBadge?: HTMLButtonElement,
): Gallery | undefined => {
  const tiles: GalleryTile[] = []
  let token: ReturnType<typeof imageFragment>
  for (const node of block.childNodes) {
    if (node === existingBadge || node.nodeType === Node.COMMENT_NODE) continue
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue
    if (!(node instanceof Element) || node.textContent?.trim()) return undefined
    const images = node instanceof HTMLImageElement ? [node] : node.querySelectorAll('img')
    const image = images[0]
    if (images.length !== 1 || !image || !markdownImage(image)) return undefined
    const fragment = imageFragment(image)
    if (
      !fragment ||
      (token && (token.group !== fragment.group || token.layout !== fragment.layout))
    )
      return undefined
    token = fragment
    if (isAvailable(image)) tiles.push({ image, element: node })
  }
  if (!token || tiles.length < 2) return undefined
  const layout = token.layout === 'collage' && tiles.length <= 3 ? 'collage' : 'strip'
  return { layout, tiles }
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

const mountGallery = (block: HTMLParagraphElement, gallery: Gallery): MountedGallery => {
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
        ...(gallery.layout === 'strip' && index >= 3 ? { 'data-reply-image-overflow': '' } : {}),
      }),
    )
  })
  let badge: HTMLButtonElement | undefined
  if (gallery.layout === 'strip' && gallery.tiles.length > 3) {
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
    const title = image.alt || 'Image preview'
    const position = images.length > 1 ? ` · ${index + 1} / ${images.length}` : ''
    enlarged.alt = image.alt
    enlarged.decoding = 'async'
    enlarged.referrerPolicy = 'no-referrer'
    caption.textContent = `${title}${position}`
    dialog.setAttribute('aria-label', title)
    enlarged.addEventListener('error', () => {
      if (!stage.contains(enlarged)) return
      enlarged.hidden = true
      caption.textContent = `${image.alt || 'Image'} · Image unavailable${position}`
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
  const zoom = new Map<HTMLImageElement, () => void>()
  const galleries = new Map<HTMLParagraphElement, MountedGallery>()
  const hasDialog = typeof document.createElement('dialog').showModal === 'function'
  let closeViewer: (() => void) | undefined
  let disposed = false

  const refresh = () => {
    if (disposed || !hasDialog) return
    for (const [image, restore] of zoom) {
      if (image.isConnected && markdownImage(image) && isAvailable(image)) continue
      restore()
      zoom.delete(image)
    }
    const paragraphs = new Set<HTMLParagraphElement>()
    for (const image of document.querySelectorAll<HTMLImageElement>(`${RESPONSE} img`)) {
      if (!markdownImage(image) || !isAvailable(image)) continue
      if (!zoom.has(image)) {
        const label = `View image: ${image.alt || 'image'}`
        zoom.set(
          image,
          setAttributes(image, {
            tabindex: '0',
            role: 'button',
            'aria-haspopup': 'dialog',
            'aria-label': label,
            title: label,
            'data-reply-image-zoom': '',
          }),
        )
      }
      const block = image.closest('p')
      if (block && imageFragment(image)) paragraphs.add(block)
    }
    for (const block of new Set([...galleries.keys(), ...paragraphs])) {
      const current = galleries.get(block)
      const next = paragraphs.has(block) ? readGallery(block, current?.badge) : undefined
      if (
        next &&
        current &&
        sameGallery(current, next) &&
        (!current.badge || current.badge.parentElement === block)
      )
        continue
      current?.restore()
      if (next) galleries.set(block, mountGallery(block, next))
      else galleries.delete(block)
    }
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

  const activate = (event: MouseEvent | KeyboardEvent) => {
    const trigger = event.target
    if (!(trigger instanceof HTMLElement) || event.defaultPrevented) return
    if (event instanceof MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return
    } else if (event.key !== 'Enter' && event.key !== ' ') return
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
    const table = trigger.closest('table')
    const members = gallery?.tiles.some(({ image }) => image === trigger)
      ? gallery.tiles.map(({ image }) => image)
      : table
        ? [...table.querySelectorAll('img')].filter(
            (image) => image.closest('table') === table && zoom.has(image) && isAvailable(image),
          )
        : [trigger]
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
    attributeFilter: ['src', 'srcset', 'href', 'class', 'data-chat-group-part'],
  })
  const refreshImage = (event: Event) => {
    if (event.target instanceof HTMLImageElement && inResponse(event.target)) refresh()
  }
  document.addEventListener('click', activate)
  document.addEventListener('keydown', activate)
  document.addEventListener('load', refreshImage, true)
  document.addEventListener('error', refreshImage, true)
  refresh()
  return () => {
    disposed = true
    observer.disconnect()
    document.removeEventListener('click', activate)
    document.removeEventListener('keydown', activate)
    document.removeEventListener('load', refreshImage, true)
    document.removeEventListener('error', refreshImage, true)
    closeViewer?.()
    for (const gallery of galleries.values()) gallery.restore()
    for (const restore of zoom.values()) restore()
    galleries.clear()
    zoom.clear()
    style.remove()
  }
}
