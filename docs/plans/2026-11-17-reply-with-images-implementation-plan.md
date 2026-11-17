# Reply With Images Implementation Plan

**Goal:** Build a TypeScript DSH bundle that selects relevant pictures for assistant answers and persists inline images through official Harness services.

**Architecture:** A Host plugin registers image-search and image-embed tools, automatic visual-answer guidance, turn-scoped budgets, and a same-origin authenticated media route backed by the durable attachment store. Provider adapters query Baidu, 360, Bing, and optional Wikimedia; returned Markdown is rendered by the existing assistant Markdown renderer.

**Tech Stack:** TypeScript ESM, Cordis, DSH tool and attachment APIs, Zod for source payloads, Cheerio for Bing HTML, Vitest, tsdown.

---

### Task 1: Package and design assets

**Status:** Complete. Added the bundle manifest, strict TS build, offline test setup, English usage/maintenance documentation, and a real-search preview generated through the official attachment backend. Preview photographs stay in the source checkout and are excluded from the installable tarball.

**Files:** `package.json`, `cordis.patch.yml`, `tsconfig.json`, `tsdown.config.ts`, `docs/plans/*`, `preview.html`.

Add the DSH bundle manifest and TypeScript build, configuration schema, and a static image-in-answer preview using real source thumbnails.

**Verify:** `npm run typecheck`, `npm run build`, and open the preview in a browser at desktop and mobile widths.

### Task 2: Search providers and parser tests

**Status:** Complete. Each provider parser has bounded, offline response tests for valid, empty, malformed, incomplete metadata, and unsafe URL cases.

**Files:** `src/search/providers.ts`, `src/search/parse.ts`, `src/search/types.ts`, `tests/search/*.spec.ts`.

Test malformed and successful Baidu, 360, Bing, and optional Wikimedia payloads before implementing provider adapters. Bound search results and filter invalid schemes or disallowed thumbnail hosts.

**Verify:** Run the focused Vitest suite with recorded response fixtures and no network.

### Task 3: Durable candidate and media route tests

**Status:** Complete. Candidate budgets and identity are turn-scoped; the authenticated media route reads persisted images, with integration coverage across backend reopen.

**Files:** `src/candidates.ts`, `src/media-route.ts`, `tests/media-route.spec.ts`.

Test unknown candidate rejection, session-scoped candidate ownership, media URL validation, attachment persistence, and authenticated retrieval after reconstructing a route from the Markdown attachment reference.

**Verify:** Run the route and candidate tests before wiring Cordis.

### Task 4: Cordis plugin and per-turn budget

**Status:** Complete. The plugin registers both tools, answer guidance and the authenticated media route using only official services. Disposal, model-facing schemas and graceful text fallback are covered.

**Files:** `src/index.ts`, `src/config.ts`, `tests/plugin.spec.ts`.

Register the two model tools, system-prompt instructions and authenticated Connection route. Reserve search/image budgets synchronously inside the service before asynchronous work. Derive the turn from the official Agent turn boundary; only a new turn resets the budget, and agent disposal clears candidates.

**Verify:** Test configured provider order, optional Wikimedia, automatic image policy, maximum images, maximum search calls, plugin disposal, and graceful text-only fallback.

### Task 5: Build, package, and visual verification

**Status:** Complete. Documentation and preview are present; typecheck, 81+ offline tests, coverage, build, pack check, and desktop/mobile browser inspection passed. Preview images are excluded from the package because provider licenses are unknown.

**Files:** `README.md`, `README.zh.md`, `preview.html`, bundled outputs.

Document installation, configuration, source attribution, unofficial search endpoint limitations, and the local preview. Build a release bundle and inspect the preview with a real browser.

**Verify:** `npm test`, `npm run typecheck`, `npm run build`, `npm pack --dry-run`, and desktop/mobile visual inspection.
