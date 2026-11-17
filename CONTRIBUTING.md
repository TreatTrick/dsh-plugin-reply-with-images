# Maintenance and iteration

## Module responsibilities

| Module                                  | Responsibility                                                         | Priority tests                                     |
| --------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| `search/providers.ts`, `search/urls.ts` | Validate external results, extract sources, and restrict image CDNs    | `tests/search/providers.spec.ts`                   |
| `search/search.ts`                      | Bounded requests, configured fallback, and deduplication               | `tests/search/search.spec.ts`                      |
| `http.ts`                               | HTTPS, DNS pinning, redirects, cancellation, byte and time limits      | `tests/http*.spec.ts`                              |
| `candidates.ts`                         | Agent/turn isolation and synchronous budget reservation                | `tests/candidates.spec.ts`                         |
| `replyImages.ts`                        | Orchestrate search, attachment saving, Markdown, and shutdown draining | `tests/replyImages.spec.ts`                        |
| `media.ts`                              | Read attachments from durable references and return HTTP status        | `tests/media.spec.ts`, `tests/persistence.spec.ts` |
| `tools.ts`, `index.ts`                  | Official SDK integration and plugin lifecycle                          | `tests/plugin.spec.ts`                             |

The core workflow depends only on an injected network reader and official attachment interfaces. Keep test switches and test-only branches out of production code, and do not expand public APIs for unit tests. Avoid mutable mocks shared across modules; test readers and stores must finish before each test exits, and temporary directories must be released.

## Testing rules

- Add a failing reproducer before fixing a defect; describe observable behavior before implementing new capability.
- Unit tests must not access the real network. Use small response fixtures and controlled dependencies. When an upstream page changes, record a redacted minimal response and update its parser test without relying on result counts or live rankings.
- Use parameterized tests for related inputs. Assert outputs, error codes, side effects, and cleanup; do not assert private fields or exact UUID values.
- Drive concurrency and cancellation with controlled promises/signals, never real sleeps. Storage integration tests use the real official backend so the persistence behavior under test is not mocked away.
- Coverage thresholds are 95% for lines/statements/functions and 85% for branches. Add meaningful tests or fix unreachable code when a threshold fails; do not lower thresholds to hide a regression.

## Typical iteration

When adding a provider, update the provider union, configuration enum, HTTPS endpoint, CDN allowlist, and response parser in sequence. Cover success, malformed records, empty results, missing licenses, malicious URLs, and fallback. When adding durable fields, update the tool output schema, types, Markdown/route references, and restart tests together. When changing per-turn budgets, cover concurrent reservation, failed calls consuming budget, old turns, and other Agents.

When upgrading the SDK, update all official peer/dev versions and the lockfile, read the official release notes, run plugin integration and persistence tests, and verify authenticated image reads in a real Web profile. Do not treat the static preview as a real model-session test.

Before committing, run `npm run check` and `npm run pack:check`; update the English README files. For visual changes, regenerate the preview and inspect 1440px and 390px viewports, light/dark themes, zoom closing, and keyboard focus. Run real-provider smoke tests separately with `npm run preview:generate`; keep them out of offline CI.
