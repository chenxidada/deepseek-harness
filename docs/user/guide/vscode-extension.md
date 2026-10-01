# VS Code extension

English | [中文](vscode-extension.zh.md)

## Summary

The `deepseek-ai.dsh-vscode-dsh` extension hosts the `dsh --profile ide` runtime inside VS Code: it starts one DSH process per window, drives it over SDK JSON-RPC on stdout, and serves the Conversation panel, Timeline, History, and Todo from a Host bridge socket. The extension ships no runtime of its own, so a working window is the extension plus a `dsh` CLI, Node.js, and model credentials — and the capabilities the model gets come from the profile that CLI boots.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Load the extension](#load-the-extension)
- [Starting and stopping](#starting-and-stopping)
- [Runtime resolution](#runtime-resolution)
- [Profiles](#profiles)
- [First run on a new machine](#first-run-on-a-new-machine)
- [Browser tools](#browser-tools)
- [Troubleshooting](#troubleshooting)
- [Further Exploration](#further-exploration)

<a id="prerequisites"></a>
## Prerequisites

| Requirement | Detail |
|---|---|
| VS Code | `^1.90.0` |
| Node.js | `^22.19.0 || >=24.0.0`; the extension validates `zlib.createZstdDecompress` and `Promise.withResolvers` before a start |
| A `dsh` runtime | a CLI build that carries the `ide` profile; the extension resolves one at every start |
| Model credentials | `DEEPSEEK_API_KEY` in the environment or the workspace `.env` |

The `ide` profile, its bundle, and this extension ship from the same branch, not from a published `@deepseek-ai/dsh` release; a deployment must provide the runtime from that checkout.

<a id="load-the-extension"></a>
## Load the extension

Build before loading — the host half and the Webview bundles are separate outputs:

```bash
pnpm install
pnpm run build
pnpm --filter dsh-vscode-dsh run build:webview
```

### Development host

Run the `Run dsh Extension (Cursor/VS Code)` launch configuration from `.vscode/launch.json`; it opens an Extension Development Host with `--extensionDevelopmentPath=apps/vscode-dsh` and passes the repository `.env`. The configuration pins a Node.js path in both `PATH` and `DSH_NODE_BIN`; change or remove those two values when the checkout moves to another machine.

### VSIX

```bash
pnpm --filter dsh-vscode-dsh run vscode:prepublish
cd apps/vscode-dsh
npx @vscode/vsce package
code --install-extension dsh-vscode-dsh-*.vsix
```

`vscode:prepublish` runs both builds, so a packaged VSIX carries the Webview bundles. A build that stops after `pnpm run build` leaves the panel empty because the Webview bundles are missing.

<a id="starting-and-stopping"></a>
## Starting and stopping

The extension owns the runtime lifecycle: activation only registers commands, views, and the status bar, and the first start reason launches one `dsh --profile ide` child for the window; later reasons reuse that child.

| Start reason | Trigger |
|---|---|
| `command-start` | the `dsh.startSession` command |
| `command-send` | sending a prompt, `dsh.newConversation`, `dsh.continueConversation`, `dsh.insertFileReference`, and the panel's New / Continue actions |
| `status-bar` | clicking the status-bar entry |
| Conversation visibility | revealing the Conversation panel (activity-bar open or `dsh.showPanel`) |

The extension listens on the Host bridge socket before spawning and passes `DSH_IDE_BRIDGE_SOCK` into the child, which is what carries approvals, user questions, and the bridge RPCs. Running `dsh --profile ide` by hand in a terminal therefore boots a runtime whose approval requests fail closed with `unavailable`, because no Host is listening; start an interactive session through the extension.

Stop the runtime with the `dsh.stopSession` command; deactivating the window also shuts the child down. The **DeepSeek Harness** output channel records activation and start facts, and `dsh.showHostDiagnostics` shows a start failure's structured record.

<a id="runtime-resolution"></a>
## Runtime resolution

Two inputs resolve per window, at activation and again at every start.

- Node.js: `DSH_NODE_BIN`, then the `dsh.nodeBin` setting, then the Extension Host's own Node.js.
- The dsh CLI entry: `DSH_BIN`, then the `dsh.cliPath` setting, then the workspace's own `@deepseek-ai/dsh` dependency, then a dsh checkout above the workspace, then `dsh` on `PATH`, then the extension's own installation.

A configured path that does not exist fails the start instead of falling through to an automatic source. When no source provides a runtime, activation prints one line to the **DeepSeek Harness** output channel naming every probed source, and a start fails as `dsh-entry` before any bridge socket opens.

<a id="profiles"></a>
## Profiles

`dsh --profile ide` boots one profile: a directory at `$DSH_HOME/profiles/ide` (`$DSH_HOME` defaults to `~/.dsh`).

The shipped `ide` template stacks `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-sdk-app`, `@deepseek-ai/dsh-ide`, and `@deepseek-ai/dsh-specdev-app`; optional bundles such as Agent Teams, voice input, auto-review, and schedule are added per profile.

| File | Role |
|---|---|
| `package.json` | `dsh.profile.bundles`, the ordered bundle list this profile boots |
| `cordis.yml` | the Loader root; the launcher rewrites it to `[]` at every start — do not edit it |
| `cordis.patch.yml` | the per-profile override layer |
| `pnpm-workspace.yaml` | the pnpm settings `dsh plugin` uses to install out-of-tree plugins |
| `compatibility.json` | exact-version exemptions for plugins whose DSH peer range does not match |
| `node_modules/` | packages installed with `dsh plugin`; bundle packages resolve from the installation first |

Layers compose in this order: each bundle's patch file in `dsh.profile.bundles` order, the profile's `cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml` (machine-local preferences, so it outranks the profile layer), then `--patch` overlays.

Three patch rules matter in practice: an id-targeted patch replaces its row's whole `config`, so restate the fields you keep; an empty or comments-only `cordis.patch.yml` fails boot, so disable the layer with `[]`; and `!!js` expressions are allowed only under `config` and `disabled`.

Profile initialization and bundle resolution:

- The first `dsh --profile ide` creates the profile from the shipped `ide` template; an existing profile is never rewritten, so a profile created by an earlier template keeps its recorded bundle list.
- A bundle package resolves from the running dsh installation first and from the profile directory second, so the composition always matches the CLI that boots it.
- A bundle whose `@deepseek-ai/dsh` peer range does not match is skipped for that boot and reported on stderr as `skipping profile bundle ...`; grant an exemption with `dsh plugin --profile ide allow-version <package@version> --dsh-version <version> --accept-risk`.
- `dsh plugin --profile ide add <package>` forwards to pnpm inside the profile directory and activates a bundle-declaring package automatically; a bundle the installation already carries is added by putting its name into `dsh.profile.bundles`.

Inspect the composition without booting the app:

```bash
dsh --profile ide --dump-config
dsh --profile ide --dump-default-config
```

`--dump-config` prints the composed rows grouped by source file and patch layer; `--dump-default-config` prints the bundle layers alone, which separates a broken user patch from a broken composition.

<a id="first-run-on-a-new-machine"></a>
## First run on a new machine

1. Check out this branch and run `pnpm install` followed by `pnpm run build`.
2. Point the extension at the runtime: set `dsh.cliPath` to the checkout's `apps/cli/lib/bin.js`, or link that entry onto `PATH`; set `dsh.nodeBin` to a supported Node.js.
3. Provide `DEEPSEEK_API_KEY` in the environment or the workspace `.env`.
4. Load the extension: F5 from the repository, or install a packaged VSIX.
5. Let the first start create `~/.dsh/profiles/ide` from the shipped template. Do not copy a profile directory from another machine — an existing profile keeps its recorded bundle list.
6. Verify with `dsh --profile ide --dump-config`: the composed rows of every bundle appear, and stderr shows no `skipping profile bundle` line.

<a id="browser-tools"></a>
## Browser tools

This branch carries two independent browser stacks.

| Stack | Packages | Model-facing tools | Enable |
|---|---|---|---|
| Browser seam with the Playwright provider | `dsh-browser`, `dsh-browser-playwright`, `dsh-tool-browser` | eleven `browser_*` tools for navigation, snapshot, clicks, typing, keys, console, network, screenshots, trace recording, and close | shipped enabled in the `ide` composition with a loopback-only allowlist; another deployment restates the `tool-browser` and `browser-playwright` rows in its own layer |
| Browser-use providers | `dsh-browser-use` plus one experimental provider | upstream MCP tool names such as `mcp__playwright-mcp__browser_*` and `mcp__chrome-devtools-mcp__*`, or Stagehand's `stagehand_*` tools | mount the service and exactly one provider row in a profile |

The `ide` composition enables the model-facing row over a loopback-only allowlist (`localhost`, `127.0.0.1`, and `0.0.0.0`, http and https), so a fresh IDE deployment can drive a local dev server; navigation admits absolute http(s) URLs only, so `file://` and every other scheme stay unreachable whatever the allowlist states. Widening the origins, opening a visible window, or adding a `traceDir` for trace archives means restating `browser-playwright` in the deployment's own patch layer, where an id-targeted patch replaces the row's whole `config`. Public pages are read with `web_fetch`, which admits public destinations only. The browser-use stack is mounted by no shipped composition: using it means installing an experimental provider package into the profile and adding one provider row, and the shared service rejects a second provider.

<a id="troubleshooting"></a>
## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Start fails as `dsh-entry` with `dsh runtime check failed — source: none` | no CLI source resolved | set `dsh.cliPath` or `DSH_BIN` to this branch's `apps/cli/lib/bin.js` |
| The start reports `profile "ide" does not exist` | the resolved CLI is a release build without the `ide` template | switch to this branch's build |
| The panel opens empty | the Webview bundles were never built | run `pnpm --filter dsh-vscode-dsh run build:webview` |
| The start fails on the Node.js check | the resolved Node.js is older than 22.19 or misses a required API | point `dsh.nodeBin` or `DSH_NODE_BIN` at a supported Node.js |
| stderr shows `skipping profile bundle ...` | a bundle's DSH peer range does not match this runtime | grant an exemption or use a matching build |
| Browser calls fail with `BROWSER_PROVIDER_UNAVAILABLE` | the `browser-playwright` allowlist resolved empty, or the row failed to load | check the row's `allowedOrigins` in `dsh --profile ide --dump-config` |

<a id="further-exploration"></a>
## Further Exploration

- [Extension host README](../../../apps/vscode-dsh/README.md) — commands, views, bridge transport, and the test hooks.
- [IDE profile bundle](../../../packages/bundle/ide/README.md) — what the `ide` profile stacks over `base` and `sdk-app`.
- [Profiles](../../../packages/boot/app-boot/README.md#profiles) — bundle composition, runtime resolution, and patch semantics.
- [Browser seam tools](../../../packages/browser/tool-browser/README.md) and [browser use](../../subsystems/browser-use.md) — the two browser stacks.
- [Configure models](providers.md) — model providers, routes, and credentials.
