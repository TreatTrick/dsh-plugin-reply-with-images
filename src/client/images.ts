import { IMAGE_STYLES } from './styles.js'

const RESPONSE = '[data-chat-group-part="response"]'
const INTERACTIVE = 'a, button, [role="button"], [role="link"], [contenteditable="true"]'
const MARKDOWN_IMAGE = /_image$/u

/** 为普通回答图片补充可访问的放大交互，保留宿主原生按钮和链接的所有权。 */
export const installImageEnhancements = (document: Document): (() => void) => {
  const style = document.createElement('style')
  style.dataset.replyImages = ''
  style.textContent = IMAGE_STYLES
  document.head.append(style)
  const previous = new Map<HTMLImageElement, Map<string, string | null>>()
  let viewer: HTMLDialogElement | undefined
  let origin: HTMLImageElement | undefined
  let disposed = false

  const eligible = (image: HTMLImageElement) =>
    image.closest(RESPONSE) !== null &&
    [...image.classList].some((name) => MARKDOWN_IMAGE.test(name)) &&
    image.parentElement?.closest(INTERACTIVE) === null &&
    (!image.complete || image.naturalWidth > 0)

  const restore = (image: HTMLImageElement, attributes: Map<string, string | null>) => {
    for (const [key, value] of attributes) {
      if (value === null) image.removeAttribute(key)
      else image.setAttribute(key, value)
    }
    previous.delete(image)
  }
  const refresh = () => {
    if (disposed) return
    for (const [image, attributes] of previous) {
      if (!image.isConnected || !eligible(image)) restore(image, attributes)
    }
    for (const image of document.querySelectorAll<HTMLImageElement>(`${RESPONSE} img`)) {
      if (!eligible(image) || previous.has(image)) continue
      const attributes = new Map<string, string | null>()
      for (const key of [
        'tabindex',
        'role',
        'aria-haspopup',
        'aria-label',
        'title',
        'data-reply-image-zoom',
      ]) {
        attributes.set(key, image.getAttribute(key))
      }
      previous.set(image, attributes)
      image.tabIndex = 0
      image.setAttribute('role', 'button')
      image.setAttribute('aria-haspopup', 'dialog')
      image.setAttribute('aria-label', `View image: ${image.alt || 'image'}`)
      image.title = `View image: ${image.alt || 'image'}`
      image.dataset.replyImageZoom = ''
    }
  }
  const close = () => {
    if (viewer?.open) viewer.close()
  }
  const clearViewer = () => {
    viewer?.remove()
    viewer = undefined
    if (origin?.isConnected) origin.focus()
    origin = undefined
  }
  const open = (image: HTMLImageElement) => {
    if (viewer || !eligible(image)) return
    const dialog = document.createElement('dialog')
    if (typeof dialog.showModal !== 'function') return
    const header = document.createElement('header')
    const caption = document.createElement('p')
    caption.textContent = image.alt || 'Image preview'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Close'
    button.addEventListener('click', close)
    const enlarged = document.createElement('img')
    enlarged.alt = image.alt
    enlarged.decoding = 'async'
    enlarged.referrerPolicy = 'no-referrer'
    enlarged.src = image.currentSrc || image.src
    enlarged.addEventListener('error', () => {
      enlarged.hidden = true
      caption.textContent = `${image.alt || 'Image'} · Image unavailable`
    })
    dialog.className = 'reply-images-viewer'
    dialog.setAttribute('aria-label', image.alt || 'Image preview')
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      close()
    })
    dialog.addEventListener('close', clearViewer, { once: true })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close()
    })
    header.append(caption, button)
    dialog.append(header, enlarged)
    document.body.append(dialog)
    origin = image
    viewer = dialog
    dialog.showModal()
    button.focus()
  }
  const activate = (event: MouseEvent | KeyboardEvent) => {
    const target = event.target
    if (!(target instanceof Element) || target.tagName !== 'IMG') return
    const image = target as HTMLImageElement
    if (!previous.has(image) || !eligible(image) || event.defaultPrevented) return
    if (event instanceof MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return
    } else if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    open(image)
  }
  const observer = new MutationObserver(refresh)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'href', 'data-chat-group-part'],
  })
  document.addEventListener('click', activate)
  document.addEventListener('keydown', activate)
  document.addEventListener('load', refresh, true)
  document.addEventListener('error', refresh, true)
  refresh()
  return () => {
    disposed = true
    observer.disconnect()
    document.removeEventListener('click', activate)
    document.removeEventListener('keydown', activate)
    document.removeEventListener('load', refresh, true)
    document.removeEventListener('error', refresh, true)
    close()
    clearViewer()
    for (const [image, attributes] of previous) restore(image, attributes)
    style.remove()
  }
}
