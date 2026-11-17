# Reply-with-images plugin design

## Goal

Add a TypeScript plugin to DeepSeek Harness that searches for real images when they improve understanding and inserts them beside related answer paragraphs. Display at most two images by default; continue with a text-only answer when no reliable result is available.

## Approach

The plugin depends only on the official Harness SDK. It queries Baidu Images, 360 Images, and Bing Images in that order by default; Wikimedia Commons is an explicit optional provider and is excluded from the default search. Mainland search endpoints are web interfaces rather than stable public keyword APIs, so each provider has an independent parser and test suite, and a provider failure can fall back to later providers.

The plugin exposes two tools: `reply_image_search` returns a bounded list of candidates with unique IDs, titles, source pages, and license status; `reply_images_embed` accepts candidate IDs, downloads and validates images through `ctx.attachments.saveImage()`, persists them, and returns Markdown ready for the answer. The tools limit total searches and displayed images per turn; the model decides whether images add value, selects candidates, and places them beside the relevant text.

Display URLs use an authenticated same-origin WebServer route. The path carries a content-addressed attachment ID and validated type and size; requests call `ctx.attachments.readImage()`. The persistent assistant Markdown stores these fields, so images can be reconstructed after reload or restart without an in-memory image cache.

Configuration provides the provider list and per-turn search/image limits. Wikimedia is excluded by default; when explicitly enabled, availability still depends on API reachability. Source pages and authors are emitted as attribution; missing license metadata is marked unknown rather than implying free republication.

## Failure handling

- Upstream HTTP errors, format changes, or timeouts: ignore the provider failure, continue with later providers, and ultimately return an empty result.
- Image download, decoding, or attachment-storage failures: the candidate cannot be displayed; return the error to the model while allowing the original text answer to continue.
- Missing or expired candidate IDs: return a clear recoverable tool error without guessing or downloading an arbitrary URL.
- No usable provider: the model follows the prompt and completes a text-only answer.
- Per-turn budget exceeded: the tool layer rejects additional search or display calls.

## Verification

Use provider response fixtures to test Baidu/360/Bing/Wikimedia parsing, source deduplication, candidate limits, budget rejection, and image URL validation. Use Harness attachment and WebServer test doubles to verify image save/read routes, and build the TypeScript bundle. Also provide a static illustrated-answer preview using real search results for manual inspection.
