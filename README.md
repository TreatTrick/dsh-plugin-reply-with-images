# DSH Reply with images

English | [中文](README.zh.md)

An independent TypeScript community bundle that adds relevant real images to DeepSeek Harness answers. It uses official Harness services, with no dependency on third-party DSH search/display plugins. This project owns provider adapters, downloading and candidate handling; ordinary runtime dependencies include Zod, Cheerio and ipaddr.js.

Images use Markdown immediately after related paragraphs, similar to an illustrated ChatGPT answer. The default budget is two searches and two images per turn. The model decides when images help, and can finish in text when acquisition fails.

## Install

Requires Node ≥24.9 and the official `agents`, `tools`, `systemPrompt`, `attachments`, `connection`, and `webServer` services from a Web/Desktop profile. The tested SDK baseline is DSH `0.2.2-rc.3`; other versions within the declared range require compatibility verification. A headless-only profile cannot supply the display environment.

```sh
npm ci
npm run check
npm pack
dsh plugin --profile web add ./dsh-plugin-reply-with-images-0.1.2.tgz
dsh --profile web --dump-config
dsh --profile web
```

Use an existing Web-capable profile in place of `web`. This package has not been published to npm. For linked development, build first, then use `dsh plugin --profile web add .`.

For Desktop, fully quit the application, run `plugin --profile desktop add <tarball-path>` with that installation's bundled `dsh`, then reopen Desktop. On Windows, the command is under `resources/runtime/cli/bin/dsh.cmd` in the installation directory. Version `0.1.1` fixes Desktop image authentication; version `0.1.2` enables licensed Wikimedia search by default and accepts its current thumbnail URLs. Generate a new answer after upgrading; existing answer URLs are not migrated.

## Configure

Override the installed row in your profile's `cordis.patch.yml`:

```yaml
- id: reply-with-images
  config:
    providers: [wikimedia, baidu, so360, bing]
    automatic: true
    maxImagesPerTurn: 2
    maxSearchesPerTurn: 2
    maxCandidates: 6
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

`reply_image_search({ query })` returns current-agent/current-turn candidate IDs and source metadata. `reply_images_embed({ candidates: [{ candidateId, alt? }] })` reserves budget before downloading from known provider CDNs, validates and saves images through `attachments.saveImage()`, and returns Markdown. In Web profiles, an official Connection route authenticates access and reads through `attachments.readImage()`, using durable reference fields in the URL. Desktop obtains persistent file paths through `attachments.imageHostPath()` and lets the native `/api/file` channel authenticate and read them. Preserve attachment storage to retain access after restart.

Tool use and placement depend on the model following instructions. Selection uses titles and sources; the plugin does not inspect visual contents or guarantee relevance. Search thumbnails limit resolution. PNG/JPEG/WebP/GIF are supported and may be re-encoded by the attachment backend. Disabling the plugin removes its Web image route; re-enable it with the attachment store preserved to display old images. Desktop paths follow the official filesystem access policy and become invalid if attachment storage moves.

Baidu, 360 and Bing use unofficial web endpoints that may change or return CAPTCHAs. Failures return bounded diagnostics and allow text fallback. Unknown image licenses stay marked as unconfirmed; this caption does not block downloads or display. Source attribution does not grant republication rights. The MIT license covers code only. Verify image rights before public/commercial reuse.

## Develop

`npm run check` runs formatting, strict TypeScript, offline coverage tests and the build. `npm run pack:check` inspects package contents. CI targets Node 24 on Windows, Linux and macOS. Tests cover adapters, DNS/download constraints, turn budgets, concurrent selection, cancellation, disposal, tool rendering and durable storage through the real official attachment backend. See [CONTRIBUTING.md](CONTRIBUTING.md) for iteration guidance.

## Preview

Run `npm run preview:generate`, then open the locally generated `preview.html` for a self-contained illustrated answer with light/dark mode and image zoom. Images are acquired through the real plugin and official local attachment store; the layout is a demonstration, not a full model-session acceptance test. Preview HTML and image files stay local and are excluded from Git because search results may have unconfirmed reuse rights.

Regenerate with `npm run preview:generate`, optionally appending `-- --allow-fake-ip-dns` for a known Fake-IP network. This sends two example queries online. Both images must succeed before replacing the preview; diagnostics and attachments live in ignored `.preview/`.

Implementation follows the official [bundle installation](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md), [tool authoring](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md), and [attachment](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/attachment.md) documentation, checked against the local Harness checkout. This is a community plugin, unaffiliated with DeepSeek/OpenAI, and does not install into ChatGPT.
