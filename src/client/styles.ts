/** 仅增强回答中的图片布局；无客户端时由标准 Markdown 自然回退。 */
export const IMAGE_STYLES = `
[data-chat-group-part="response"] p:not([data-reply-image-group]) :is(img[data-reply-image-zoom], img[data-reply-image-single]) { max-width: 100%; max-height: 380px; height: auto; object-fit: contain; border-radius: 12px; outline: 1px solid color-mix(in srgb, currentColor 13%, transparent); outline-offset: -1px; }
[data-chat-group-part="response"] p[data-reply-image-caption] { margin-block: -4px 12px; font-size: 11.5px; line-height: 1.45; opacity: 0.65; overflow-wrap: anywhere; }
[data-chat-group-part="response"] p[data-reply-image-caption] > em { font-style: normal; }
[data-chat-group-part="response"] p[data-reply-image-caption] a { display: inline-block; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, currentColor 8%, transparent); font: inherit; text-decoration: none; }
[data-chat-group-part="response"] :has(> table:has(img)) { box-sizing: border-box; width: 100%; max-width: 100%; margin-inline: 0; padding-inline: 0; overflow-x: auto; }
[data-chat-group-part="response"] table:has(img) { width: 100%; max-width: 100%; table-layout: fixed; border-collapse: collapse; }
[data-chat-group-part="response"] table:has(img) :is(th, td) { min-width: 0; padding: 12px; vertical-align: top; overflow-wrap: anywhere; }
[data-chat-group-part="response"] table:has(img) td > button:has(> img) { display: block; width: 100%; margin: 0; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
[data-chat-group-part="response"] table:has(img) img { display: block; max-width: 100%; height: auto; max-height: 240px; margin: 0 0 8px; border-radius: 8px; object-fit: cover; }
/* 表格列宽使用确定长度，避免 clamp() 在列宽算法中按自动宽度处理。 */
[data-chat-group-part="response"] table:where(:has(> tbody > tr > td:first-child img):not(:has(> tbody > tr > td:not(:first-child) img))) > :is(thead, tbody) > tr > :is(th, td):first-child { width: 112px; }
[data-chat-group-part="response"] table:where(:has(> tbody > tr > td:first-child img):not(:has(> tbody > tr > td:not(:first-child) img))) > tbody > tr > td:first-child img { aspect-ratio: 3 / 4; width: min(100%, 112px); max-height: none; margin: 0; border-radius: 10px; object-fit: cover; object-position: center 20%; }
/* 表头脱离布局后，自动列宽才能采用正文单元格的肖像及来源宽度。 */
[data-chat-group-part="response"] table[data-reply-image-directory] { --reply-image-border: color-mix(in srgb, currentColor 12%, transparent); position: relative; table-layout: auto; border: 0; border-collapse: collapse; border-spacing: 0; border-radius: 0; box-shadow: none; background: transparent; }
[data-chat-group-part="response"] table[data-reply-image-directory] > :is(thead, tbody),
[data-chat-group-part="response"] table[data-reply-image-directory] > :is(thead, tbody) > tr,
[data-chat-group-part="response"] table[data-reply-image-directory] > :is(thead, tbody) > tr > :is(th, td) { border: 0; background: transparent; }
[data-chat-group-part="response"] table[data-reply-image-directory] > thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); clip-path: inset(50%); white-space: nowrap; }
[data-chat-group-part="response"] table[data-reply-image-directory] > tbody > tr > td { border-block-start: 1px solid var(--reply-image-border); }
[data-chat-group-part="response"] table[data-reply-image-directory] > :is(thead, tbody) > tr > :is(th, td):first-child { padding-inline-start: 0; }
[data-chat-group-part="response"] table[data-reply-image-directory] > tbody > tr > td:nth-child(3):last-child { width: 160px; font-size: 12px; opacity: 0.68; }
[data-chat-group-part="response"] p[data-reply-image-group] {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
[data-chat-group-part="response"] p[data-reply-image-group] > [data-reply-image-tile] {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  overflow: hidden;
  cursor: zoom-in;
}
[data-chat-group-part="response"] p[data-reply-image-group] :is(img[data-reply-image-tile], [data-reply-image-tile] img) {
  display: block;
  width: 100%;
  height: 100%;
  max-height: none;
  margin: 0;
  object-fit: cover;
  object-position: center 25%;
}
[data-chat-group-part="response"] p[data-reply-image-group] [data-reply-image-tile] img {
  position: absolute;
  inset: 0;
}
[data-chat-group-part="response"] p[data-reply-image-group] > :not([data-reply-image-tile], [data-reply-image-badge]) {
  grid-column: 1 / -1;
  order: 1;
}
[data-chat-group-part="response"] p[data-reply-image-group="collage"] {
  gap: 5px;
  border-radius: 12px;
  overflow: hidden;
}
[data-chat-group-part="response"] p[data-reply-image-group="collage"][data-reply-image-count="3"] {
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  grid-template-rows: repeat(2, minmax(0, 1fr));
  aspect-ratio: 5 / 3;
  max-height: 420px;
}
[data-chat-group-part="response"] p[data-reply-image-group="collage"][data-reply-image-count="3"] > [data-reply-image-tile="1"] {
  grid-row: 1 / 3;
}
[data-chat-group-part="response"] p:is([data-reply-image-group="strip"], [data-reply-image-count="2"][data-reply-image-group="collage"]) > [data-reply-image-tile] {
  aspect-ratio: 5 / 4;
  height: auto;
}
[data-chat-group-part="response"] p[data-reply-image-group="strip"]:not([data-reply-image-count="2"]) {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
[data-chat-group-part="response"] p[data-reply-image-group="strip"] > [data-reply-image-tile] {
  border-radius: 10px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 12%, transparent);
}
[data-chat-group-part="response"] p[data-reply-image-group="strip"] > [data-reply-image-overflow] {
  display: none !important;
}
[data-chat-group-part="response"] [data-reply-image-badge] {
  position: absolute;
  grid-column: 3;
  grid-row: 1;
  inset-block-end: 6px;
  inset-inline-end: 6px;
  min-width: 40px;
  min-height: 40px;
  border: 1px solid #fff9;
  border-radius: 8px;
  background: #202522dd;
  color: white;
  font: inherit;
  cursor: pointer;
}
[data-reply-image-zoom] { cursor: zoom-in; }
[data-reply-image-zoom]:focus-visible { outline: 2px solid #276f91; outline-offset: 3px; }
@media (hover: hover) {
  [data-reply-image-group] :is([data-reply-image-zoom]:hover, [data-reply-image-tile]:hover img) { filter: brightness(1.07); }
}
.reply-images-viewer { box-sizing: border-box; width: fit-content; max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); margin: auto; padding: 16px; border: 1px solid #b9bdc5; border-radius: 8px; background: Canvas; color: CanvasText; box-shadow: 0 16px 64px #0005; }
.reply-images-viewer::backdrop { background: #000a; }
.reply-images-viewer header, .reply-images-viewer footer { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 12px; }
.reply-images-viewer footer { margin-block: 12px 0; }
.reply-images-viewer p { flex: 1; margin: 0; overflow-wrap: anywhere; }
.reply-images-viewer button { flex: none; min-width: 44px; min-height: 44px; padding: 8px; border: 1px solid #b9bdc5; border-radius: 8px; background: inherit; color: inherit; font: inherit; cursor: pointer; }
.reply-images-pagination { display: flex; justify-content: center; flex-wrap: wrap; }
.reply-images-pagination button { min-width: 28px; min-height: 32px; padding: 0; border: 0; }
.reply-images-pagination button::after { content: ''; display: inline-block; width: 8px; height: 8px; border: 1px solid currentColor; border-radius: 50%; }
.reply-images-pagination button[aria-current="true"]::after { background: currentColor; }
.reply-images-viewer img { display: block; width: auto; height: auto; max-width: 100%; max-height: calc(100dvh - 200px); margin: auto; object-fit: contain; }
.reply-images-viewer img[hidden] { display: none; }
@media (max-width: 480px) {
  [data-chat-group-part="response"] table:has(img) :is(th, td) { padding: 8px; }
  [data-chat-group-part="response"] table:has(img) img { max-height: 160px; }
  [data-chat-group-part="response"] table:where(:has(> tbody > tr > td:first-child img):not(:has(> tbody > tr > td:not(:first-child) img))) > :is(thead, tbody) > tr > :is(th, td):first-child { width: 84px; }
  [data-chat-group-part="response"] table[data-reply-image-directory] > tbody > tr > td:nth-child(3):last-child { width: 100px; }
  [data-chat-group-part="response"] p[data-reply-image-group="collage"][data-reply-image-count="3"] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
    aspect-ratio: 1;
  }
  [data-chat-group-part="response"] p[data-reply-image-group="collage"][data-reply-image-count="3"] > [data-reply-image-tile="1"] {
    grid-column: 1 / 3;
    grid-row: 1;
  }
}
`
