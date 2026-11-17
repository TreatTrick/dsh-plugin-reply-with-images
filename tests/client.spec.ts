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
  document.head.querySelectorAll('style[data-reply-images]').forEach((style) => style.remove())
  vi.restoreAllMocks()
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close
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
  expect(style.textContent).toContain('clamp(80px, 22%, 132px)')
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

it('keeps ordinary Markdown intact when the browser lacks a native dialog', () => {
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal
  const section = response('<img class="_7x_image" src="plain.png" alt="Lotus">')
  cleanup = installImageEnhancements(document)
  section.querySelector('img')!.click()
  expect(document.querySelector('dialog')).toBeNull()
  expect(section.querySelector('img')?.src).toContain('plain.png')
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
