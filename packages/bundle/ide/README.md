---
description: "IDE profile bundle for users and maintainers launching the SDK runtime with a Host bridge for VS Code."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-ide`

English | [中文](README.zh.md)

## Summary

The IDE application as a `dsh` profile bundle stacked on [`dsh-base`](../base/README.md) and [`dsh-sdk-app`](../sdk-app/README.md). The patch sets the SDK startup `profile` to `ide` and inserts [`dsh-ide-bridge`](../../ide/ide-bridge/README.md). Stdout remains exclusive to SDK JSON-RPC; Host approval and user-questions traffic uses `DSH_IDE_BRIDGE_SOCK`. The bundle must not mount `ui-approval` or `ui-user-questions`.

The patch also enables the model-facing browser row over a loopback-only origin allowlist, so an IDE deployment can drive a local dev server without another overlay. A deployment that needs other origins, a visible window, or trace archives restates the `browser-playwright` row in its own layer.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

`dsh --profile ide` auto-initializes from `PROFILE_TEMPLATES.ide` as `dsh-base` + `dsh-sdk-app` + `dsh-ide`. Launch from a Host that listens on the bridge socket and injects `DSH_IDE_BRIDGE_SOCK` before spawn. `dsh --profile ide --help` prints help without claiming stdio, matching sdk-app startup gating.

The patch also restates the `session-query-sqlite` row with `openAt: first-search`, so the runtime's full-text index opens on the user's first content search instead of staying closed as it does in `dsh-base`; the IDE search box then answers content hits, snippets, and paging from the index rather than scanning log bodies itself.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the rows the patch enables and inserts, whose packages own their model-facing behavior.

#### KV Cache effect

The bundle itself adds no request prefix; each enabled or inserted row's package owns any cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **User patches can violate mutual exclusion** — profile and `--patch` overlays are trusted; the shipped bundle asserts absence of Web UI answerer rows, but cannot contain arbitrary later inserts.
- **Replaceability scope** — transport / UI presenter / permission-presets are swappable without `agent-loop` edits; Spec/hooks product packs remain out of scope. See [`dsh-ide-bridge` replaceability](../../ide/ide-bridge/README.md#replaceability-contract-ad-8).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

**Runtime invariant:** No companion is published. Composition tests own the AC-5 exclusion; the ide profile e2e smoke owns dual-channel initialize.

</details>
