/** 仅增强回答正文中的含图表格；原生 Markdown 内容和图片错误回退由宿主管理。 */
export const IMAGE_STYLES = `
[data-chat-group-part="response"] :has(> table:has(img)) {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  margin-inline: 0;
  padding-inline: 0;
  overflow-x: auto;
}
[data-chat-group-part="response"] table:has(img) {
  width: 100%;
  max-width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
[data-chat-group-part="response"] table:has(img) :is(th, td) {
  min-width: 0;
  max-width: none;
  padding: 12px;
  vertical-align: top;
  overflow-wrap: anywhere;
}
[data-chat-group-part="response"] table:has(img) img {
  display: block;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 240px;
  margin: 0 0 8px;
  border-radius: 8px;
  object-fit: contain;
}
[data-chat-group-part="response"] table:has(> tbody > tr > td:first-child img):not(:has(> tbody > tr > td:not(:first-child) img)) :is(th, td):first-child {
  width: clamp(80px, 22%, 132px);
  padding-inline-start: 0;
}
[data-chat-group-part="response"] table:has(> tbody > tr > td:first-child img):not(:has(> tbody > tr > td:not(:first-child) img)) td:first-child img {
  max-height: 132px;
}
[data-reply-image-zoom] { cursor: zoom-in; }
[data-reply-image-zoom]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4169e1);
  outline-offset: 3px;
}
.reply-images-viewer {
  box-sizing: border-box;
  width: fit-content;
  max-width: calc(100vw - 32px);
  max-height: calc(100dvh - 32px);
  margin: auto;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l2, #b9bdc5);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
  box-shadow: 0 16px 64px #0005;
}
.reply-images-viewer::backdrop { background: #000a; }
.reply-images-viewer header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 12px;
}
.reply-images-viewer p { margin: 0; overflow-wrap: anywhere; }
.reply-images-viewer button {
  flex: none;
  min-width: 44px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2, #b9bdc5);
  border-radius: 8px;
  background: inherit;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.reply-images-viewer img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: calc(100dvh - 160px);
  margin: auto;
  object-fit: contain;
}
.reply-images-viewer img[hidden] { display: none; }
@media (max-width: 480px) {
  [data-chat-group-part="response"] table:has(img) :is(th, td) { padding: 8px; }
  [data-chat-group-part="response"] table:has(img) img { max-height: 160px; }
}
`
