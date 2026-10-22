---
description: "Japanese-first Web UI fonts: Anago Gothic (an OFL-renamed subset of UDEV Gothic) for kana, kanji, and full-width forms, Intel One Mono for Latin and code, and Noto Sans JP as the broad fallback."
kind: "package-reference"
---

# @anago-harness/client-ui-fonts-anago

English | [中文](README.zh.md)

## Summary

Mount this package in a Web profile and the Anago UI draws Japanese with Japanese glyph shapes: Anago Gothic for kana, kanji, and full-width forms, Intel One Mono for Latin and code, and Noto Sans JP for every remaining character. The package ships the woff2 faces with their SIL OFL licenses, overrides `--dsh-font-family-text-default` and `--dsh-font-family-code-default`, and sets the text stack on the application root, so existing components inherit it unchanged. A font list saved in Settings still leads the stack. The faces cost about 5 MiB of woff2, or 6.7 MiB inside the client bundle.

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

Mount `@anago-harness/anago-web` in a Web profile: it inserts this row as `anago-fonts`, so the fonts mount with the other browser rows. A composition that lists rows directly can add the same entry:

```yaml
- insert:
    - id: anago-fonts
      name: '@anago-harness/client-ui-fonts-anago'
```

The browser half then mounts one stylesheet and keeps it for the plugin lifetime. No component changes and no new settings: the fonts are the default the UI renders with.

| Family | Files | Weight | Drawn characters | Size |
|---|---|---|---|---|
| Anago Gothic | `anago-gothic-regular.woff2` | 400 | Kana, CJK ideographs, full-width forms | 1.4 MiB |
| Noto Sans JP | `noto-sans-jp-latin.woff2`, `noto-sans-jp-kana.woff2`, `noto-sans-jp-kanji.woff2` | 100–900 | Latin, kana, CJK ideographs | 3.6 MiB |
| Intel One Mono | `intel-one-mono-latin.woff2`, `intel-one-mono-latin-ext.woff2`, `intel-one-mono-symbols.woff2` | 300–700 | Latin, punctuation, box drawing | 41 KiB |

Anago Gothic is the renamed woff2 subset of UDEV Gothic: the SIL OFL reserves the upstream font name to unmodified versions, so the shipped name table carries a derivative name while the copyright record and the OFL text stay intact. Its `unicode-range` stops before Latin, so Latin text falls through to Noto Sans JP and code Latin to Intel One Mono; the code stack names both Japanese faces ahead of the upstream Chinese-first entries, so a code span never falls back to Chinese glyphs. A font list the user saves in Settings leads the stack, because `base.css` composes that list ahead of the overridden defaults on `body`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The node half is an empty `apply`, present so the package holds a Loader row whose bare specifier the client module system serves the `./client` bundle for. The browser half imports `src/styles/fonts.css?inline`, replaces its `__DSH_FONT_*__` placeholders with the imported font bytes, and appends one `<style data-plugin="…">` through `ctx.effect`; disposal removes the tag.

The font bytes arrive as data URLs because the client bundle has no font route: the Host serves `/plugins/<package>/` only for `client.*.js` chunks, so a relative `url()` would 404. `tsdown.config.ts` adds one plugin that turns a `*.woff2` import into `data:font/woff2;base64,…`, and `src/client/font-assets.ts` maps each file to its placeholder. The stylesheet is injected, not linked, for the same reason: `apps/web` imports only ui-theme's `brand-font.css`, which this package does not modify.

The token override uses `:root:root` so it beats ui-theme's `:root` defaults without depending on stylesheet order. The stylesheet also sets `font-family: var(--dsw-font-family)` on `body` and `#root`, so components that declare no family inherit the text stack; code blocks keep `--ds-font-family-code`, which resolves the overridden code default.

Font provenance, glyph counts, advances, and file hashes live in `src/fonts/fonts.json`; the licenses sit beside them as `UDEV-Gothic-OFL.txt`, `Noto-Sans-JP-OFL.txt`, and `Intel-One-Mono-OFL.txt`. The subsets were cut with `pyftsubset --flavor=woff2`, so the shipped files are modified versions of the upstream fonts. The UDEV Gothic subset is shipped as `Anago Gothic`, a derivative name that satisfies the reserved-font-name clause; its name table and the CSS family agree, and the upstream copyright record stays in the font.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-theme](../../client/ui-theme/README.md) — the package that owns the token defaults this one overrides.
- [anago-web](../anago-web/README.md) — the browser bundle that should insert this row.
- [fork group](../README.md) — the package map for this group.
- [Project guideline](../../../PROJECT_GUIDELINE.md) — section 6.4 specifies the font roles and the terminal check.

-----

<a id="model-experience"></a>
## Model Experience

### No model-context contribution

#### What the model sees

Nothing. The package injects `@font-face` rules and two CSS custom properties into the browser document; it registers no prompt section, tool, session event, or model-visible text.

#### Token effect

None. The font files and the stylesheet never enter a model request; they change only how existing text is painted in the browser.

#### KV Cache effect

None. The package adds no request prefix and rewrites no request field, so it cannot shift a cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The client bundle inlines every face as base64, so `client.js` grows to about 6.7 MiB for 5.0 MiB of woff2; a Host font route would let the browser fetch ranges on demand.
- Anago Gothic ships at weight 400 only, so bold Japanese text renders as synthetic bold; Noto Sans JP supplies real weights only for the characters it does not cover.
- The package is private to this fork and is not published to npm.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Upstream sources: UDEV Gothic v2.2.0 `UDEVGothic-Regular.ttf` from its GitHub release, Noto Sans JP variable `NotoSansJP-VF.ttf` from `notofonts/noto-cjk`, and Intel One Mono variable woff2 files from the `@fontsource-variable/intel-one-mono` 5.3.0 tarball. The UDEV and Noto files were subset per range: kana and full-width forms, CJK ideographs, and, for Noto only, Latin. Intel One Mono ships unchanged.

To regenerate, run `pyftsubset` from fontTools with `--unicodes` for the recorded ranges, `--flavor=woff2`, and `--drop-tables+=DSIG`, then rewrite the UDEV subset's name records to `Anago Gothic` (`fontTools.ttLib`: nameIDs 1, 3, 4, 5, and 6) and re-record bytes, hashes, and advances in `src/fonts/fonts.json`. The tests recompute each hash, so an edited font without a metrics update fails.

The tests stay file-static on purpose: they read the stylesheet, the licenses, the manifest, and the font binaries instead of importing the browser half, so they run without a browser. The `全角` check asserts that the terminal face advances a full-width glyph by exactly twice its half-width advance, which is the cell ratio xterm measures.

</details>
