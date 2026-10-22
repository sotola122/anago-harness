---
description: "Exa search provider that resolves its key through the credentials service."
kind: "package-reference"
---

# @anago-harness/web-search-exa

English | [中文](README.zh.md)

## Summary

`@anago-harness/web-search-exa` registers an Exa-backed search provider with `ctx.web` under the id `exa`. It is a thin wrapper around the upstream `ExaSearchProvider` exported by `@deepseek-ai/dsh-web-search-exa`: the wrapper resolves the API key for every search and delegates the HTTP request and response mapping to a fresh upstream instance. An upstream failure is rewritten before it leaves the wrapper, so its message names the provider and the credential reference and carries only a redacted, bounded detail.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add the row and select the provider in the `web` row:

```yaml
- id: web-search-exa
  name: '@anago-harness/web-search-exa'
  config:
    apiKeyEnv: EXA_API_KEY
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: exa
    fetchProvider: http
```

Do not load the upstream `@deepseek-ai/dsh-web-search-exa` plugin at the same time. Both register the id `exa`, and `ctx.web` rejects a duplicate id.

### Key resolution order

Every search resolves the key in this order:

1. The configured `apiKey` when it is non-empty.
2. `ctx.credentials.resolve(credentialRef(apiKeyEnv))` when `apiKeyEnv` is a valid reference name and the credentials service exists.
3. `launchEnvironmentOf(ctx).get(apiKeyEnv)` from the launch environment.

When none supplies a key, the search fails with `WEB_PROVIDER_CREDENTIAL_MISSING` naming only the reference. The provider never logs, echoes, or embeds a resolved key in an error message.

`available()` returns `URL.canParse(baseURL)` and does not require a key. The credentials service is asynchronous and cannot be read from the synchronous provider-selection path; requiring a locally visible key there would make a credentials-only key unusable. A missing key surfaces at search time instead.

### Configuration

Every field is `Volatile`, so a settings change reaches the next search. `apiKey` has `role: secret`; `apiKeyEnv` has `role: credential-ref`.

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKey` | (unset) | Literal Exa API key; prefer `apiKeyEnv` so no secret enters configuration files. |
| `apiKeyEnv` | `EXA_API_KEY` | Credential reference name used by both the credentials service and the launch environment. |
| `baseURL` | `https://api.exa.ai` | Endpoint base; `/search` is appended. An unparseable value makes `available()` false. |
| `searchType` | `auto` | Retrieval mode sent as Exa's `type`: `auto`, `keyword`, or `neural`. |
| `numResults` | (unset) | Default result count when a request carries no `maxResults`; must be a positive integer. |
| `highlightsPerResult` | `1` | Highlight sentences requested per result (Exa's `highlightsPerUrl`); must be a positive integer. |

A request's `maxResults` wins over the configured `numResults` and is sent to Exa as a cost and latency optimization; the web service enforces the final bound and sets `truncated`.

### Error codes

| Situation | Code | Message behavior |
| --- | --- | --- |
| No key from any source | `WEB_PROVIDER_CREDENTIAL_MISSING` | Names the reference and the three places a key can live; never a value. |
| Credentials service failure | `WEB_PROVIDER_ERROR` | Names the reference and carries the resolver failure as `cause`. |
| Query longer than `2000` characters | `WEB_PROVIDER_ERROR` | Reports the size and the limit; never echoes the query. |
| Blank query | `WEB_PROVIDER_ERROR` | Asks for a non-empty query. |
| HTTP error from Exa | `WEB_PROVIDER_ERROR` | Names `Exa search`, the reference, and a 200-character upstream detail redacted with the resolved key. |
| Transport failure or unparseable body | `WEB_PROVIDER_ERROR` | The same rewritten form, with the upstream failure kept as `cause`. |
| Caller cancellation | `WEB_ABORTED` | No additional detail. |

The wrapper never passes an upstream message through unchanged. `upstreamFailure` in `src/provider.ts` applies `redactSecret` and `boundedProviderDetail` from `@anago-harness/web-search-credentials` to the upstream message, so a key or base64 encoding echoed by a proxy, gateway, or provider becomes `[REDACTED]` and the detail is capped at 200 characters. When nothing printable survives, the message states the failure class alone. Cancellation keeps `WEB_ABORTED`; every other failure keeps the upstream code, and `cause` retains the upstream error for logs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The upstream plugin builds its provider once from `config.apiKey ?? launchEnvironmentOf(ctx).get('EXA_API_KEY')`. It never reads `ctx.credentials`, so a key saved from the settings surface is invisible to it, and a key stored only in credentials makes the upstream provider unavailable at selection time. This fork package closes that gap: it resolves through the credentials service first, keeps the provider selectable when no key is locally visible, and re-resolves the key for each search so a key change needs no restart.

The `anago-core` bundle owns the row and selects `exa` as the search provider; this package does not ship a `cordis.patch.yml`.

| File | Role |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Plugin entry: `Volatile` config schema, provider registration through `ctx.effect`, and the per-search option projection. |
| [`src/provider.ts`](src/provider.ts) | `ExaCredentialSearchProvider`: `available()`, per-search key resolution, query bounds, delegation to the upstream class, and the failure rewrite. |
| [`tests/index.spec.ts`](tests/index.spec.ts) | Unit suite with an injected `fetch` supplied through `globalThis.fetch`. |

`search()` checks cancellation and the query bound, snapshots the settings once, resolves the key, and then constructs exactly one `new ExaSearchProvider({ apiKey, baseURL, searchType, numResults, highlightsPerResult })` for that search. Nothing is retained between searches. Concurrent searches therefore cannot share a key or an option snapshot, and each one gets its own upstream instance. The wrapper does not call the upstream `available()`; the upstream `search()` validates the values it receives and maps its own failures.

`upstreamFailure` reads the upstream `code` without requiring the harness class, keeps `WEB_ABORTED` (also for a rejection named `AbortError`), and defaults an unknown code to `WEB_PROVIDER_ERROR`. It builds the message from the provider name, the reference, the code, and the redacted bounded detail, and never from the raw body or the key.

The upstream class consumes `globalThis.fetch`, so the tests install a fake there and restore the global after each case.

-----

<a id="further-exploration"></a>
## Further Exploration

- [fork group](../README.md) — the package map for this group.
- [upstream Exa provider](../../web/web-search-exa/README.md) — the request/response mapping this wrapper delegates to.
- [web service](../../web/web/README.md) — provider selection and the `WebError` taxonomy.
- [tool-web](../../web/tool-web/README.md) — the model-facing `web_search` tool that renders these sources.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-web`: the model sees the upstream provider's `maxResults`-bounded URLs, titles, first non-blank highlights, and publication dates, or the wrapper's `WebError` text under the tool's error wrapper — `Exa search failed for "<reference>" (<code>): <redacted detail>` or `Exa search aborted`. No upstream message, key, or raw body reaches the model. Results with no non-blank highlight are dropped, so a call can return fewer sources than requested.

#### KV Cache effect

The provider itself adds no request prefix; the search tool owns any cache effect, and a changed result set changes only the appended tool result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Query validation is wrapper-owned.** The upstream `ExaSearchProvider` does not validate the query. This wrapper rejects a blank query and one longer than `2000` characters (the documented Exa field limit) with `WEB_PROVIDER_ERROR`; the limit is a constant, not a config field.
- **No generated answer.** Exa returns sources only, so `content` is never set.
- **Highlights are required for a source.** A result with no non-blank highlight is dropped rather than given an invented snippet.
- **Only a narrow Exa surface is exposed.** `livecrawl`, category, domain/date filters, and full-text contents are not available because the seam has no provider-neutral fields for them.
- **Abort classification is name-based.** A failure whose code is `WEB_ABORTED`, or whose `name` is `AbortError`, maps to `WEB_ABORTED`; an abort with another shape surfaces as `WEB_PROVIDER_ERROR`.
- **Duplicate ids are rejected.** Do not mount this package together with the upstream `@deepseek-ai/dsh-web-search-exa` plugin.
- **No package-owned display metadata or settings card.** The bundle owns the row, and a separate settings card owns the key form.
- **No real-key end-to-end run in this suite.** The tests use an injected `fetch` and never open a socket.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The wrapper deliberately does not delegate `available()` to the upstream class: the upstream `available()` requires a non-empty key, which would make a credentials-only key fail selection before the asynchronous resolver could run. The upstream class is constructed once per search so concurrent calls never share options. `EXA_QUERY_MAX_CHARS` is defined in `src/provider.ts`; the upstream class and its wire types remain unmodified. Upstream failures are rewritten rather than passed through: the wrapper owns the model-visible message and keeps the upstream failure as `cause`.
</details>
