# DSH Reply with images

Documentation is maintained in English.

An independent TypeScript community bundle that adds relevant real images to DeepSeek Harness answers. It uses official Harness services, with no dependency on third-party DSH search/display plugins. This project owns provider adapters, downloading and candidate handling; ordinary runtime dependencies include Zod, Cheerio and ipaddr.js.

Detailed answers about people, organizations, news, products and places receive guidance to use relevant images only when they add visual value. In one `reply_images_prepare` call, the model can create standard Markdown tables, three-image collages, strips of up to five views, or ordinary inline images. The default per-turn budgets are six searches and eight images. Failed or duplicate candidates are skipped, successful images retain source and license captions, and unavailable images leave a useful text answer.

An optional DSH Web client entry presents image tables as compact, responsive image rows or comparison groups and adds keyboard-accessible zoom for ordinary Markdown images. It does not replace host Markdown: without the client, images remain standard Markdown. DSH's own image viewer remains in place wherever the host already provides one.

## Install

Requires Node ≥24.9 and the official `agents`, `tools`, `systemPrompt`, `attachments`, `connection`, and `webServer` services from a Web/Desktop profile. The tested SDK baseline is DSH `0.2.2-rc.3`; other versions within the declared range require compatibility verification. A headless-only profile cannot supply the display environment.

```sh
npm ci
npm run check
npm pack
dsh plugin --profile web add ./dsh-plugin-reply-with-images-0.1.3.tgz
dsh --profile web --dump-config
dsh --profile web
```

Use an existing Web-capable profile in place of `web`. This package has not been published to npm. For linked development, build first, then use `dsh plugin --profile web add .`.

For Desktop, fully quit the application, run `plugin --profile desktop add <tarball-path>` with that installation's bundled `dsh`, then reopen Desktop. On Windows, the command is under `resources/runtime/cli/bin/dsh.cmd` in the installation directory. Version `0.1.1` fixes Desktop image authentication; version `0.1.2` enables licensed Wikimedia search by default and accepts its current thumbnail URLs; version `0.1.3` tells the model to use three distinct images across detailed multi-section answers. Generate a new answer after upgrading; existing answer URLs are not migrated.

## Configure

Override the installed row in your profile's `cordis.patch.yml`:

```yaml
- id: reply-with-images
  config:
    providers: [wikimedia, baidu, so360, bing]
    automatic: true
    maxImagesPerTurn: 8
    maxSearchesPerTurn: 6
    maxCandidates: 10
    requestTimeoutMs: 8000
    maxImageBytes: 5242880
    maxSearchBytes: 3145728
    allowFakeIpDns: false
    publicBaseUrl: ''
```

Set `automatic: false` to guide the model to search only on explicit image requests. Wikimedia runs first to provide source license metadata; Baidu, 360, and Bing are fallbacks. If Commons is unreachable from the current network, search continues with the configured providers. All providers can fail or throttle; queries are sent to the configured providers.

In Web profiles, leave `publicBaseUrl` empty to use the official WebServer origin. For remote/reverse-proxy deployments, set the exact browser-facing same-origin URL, including any path prefix, and forward `/api/reply-images` under that prefix to Harness with official authentication. No auth token is embedded in image URLs. Changing the origin/path requires migrating absolute URLs in existing answers; stored attachments remain intact. Desktop automatically uses provider-owned local image paths through its authenticated native file-image channel, ignoring `publicBaseUrl`; the local attachment backend and client filesystem must refer to the same host.

Enable `allowFakeIpDns` only for a known proxy Fake-IP setup. It additionally allows `198.18.0.0/15` and `2001:2::/48`; all other private addresses remain blocked. Requests use Node HTTPS and do not automatically consume `HTTP_PROXY`/`HTTPS_PROXY`.

## Behavior and limits

`reply_images_prepare` reserves the complete batch against the remaining search and image budgets before network access. Each topic accepts `{ topic, query, alt, layout?, count? }` or `{ topic, layout?, items: [{ query, alt, caption? }] }`. A query with `count` uses one search. Each item uses one search and one image slot. Insert each successful topic's `markdown` after the matching section. Use `tableMarkdown` for existing image-table cells. `reply_image_search({ query })` and `reply_images_embed({ candidates: [{ candidateId, alt? }] })` support exact candidate selection. Saved images use Harness attachments and authenticated Web or Desktop image paths. Preserve attachment storage to retain access after restart.

Tool use and placement depend on the model following instructions. Selection uses titles and sources; the plugin does not inspect visual contents or guarantee relevance. Search thumbnails limit resolution. PNG/JPEG/WebP/GIF are supported and may be re-encoded by the attachment backend. Disabling the plugin removes its Web image route; re-enable it with the attachment store preserved to display old images. Desktop paths follow the official filesystem access policy and become invalid if attachment storage moves.

Baidu, 360 and Bing use unofficial web endpoints that may change or return CAPTCHAs. Failures return bounded diagnostics and allow text fallback. Unknown image licenses stay marked as unconfirmed; this caption does not block downloads or display. Source attribution does not grant republication rights. The MIT license covers code only. Verify image rights before public/commercial reuse.

## Develop

`npm run check` runs formatting, strict TypeScript, offline coverage tests and the build. `npm run pack:check` inspects package contents. CI targets Node 24 on Windows, Linux and macOS. Tests cover adapters, DNS/download constraints, turn budgets, concurrent selection, cancellation, disposal, tool rendering and durable storage through the real official attachment backend. See [CONTRIBUTING.md](CONTRIBUTING.md) for iteration guidance.

## Preview

Run `npm run preview:generate`, then open the locally generated `preview.html` for a self-contained illustrated answer. Run `npm run preview:client`, then open `client-preview.html` to inspect the compiled DSH Web client against a two-column subject index and an image comparison table. The latter uses remote Unsplash preview images; it does not download or package them. Both previews are demonstrations, not full model-session acceptance tests, and generated HTML stays local.

Regenerate with `npm run preview:generate`, optionally appending `-- --allow-fake-ip-dns` for a known Fake-IP network. This sends two example queries online. Both images must succeed before replacing the preview; diagnostics and attachments live in ignored `.preview/`.

Implementation follows the official [bundle installation](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md), [tool authoring](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md), and [attachment](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/attachment.md) documentation, checked against the local Harness checkout. This is a community plugin, unaffiliated with DeepSeek/OpenAI, and does not install into ChatGPT.
