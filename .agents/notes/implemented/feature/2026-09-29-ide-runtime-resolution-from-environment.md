# Agent Note: The IDE extension resolves its dsh runtime from the environment

Status: implemented

English | [中文](2026-09-29-ide-runtime-resolution-from-environment.zh.md)

## Problem

A window that is not the dsh checkout could not start a session. The extension looked for the CLI only by walking up from the workspace for `apps/cli/lib/bin.js`, and otherwise let the SDK client fall back to `import.meta.resolve('@deepseek-ai/dsh/package.json')` from the extension's own directory, which a standalone VSIX answers with `Cannot find package '@deepseek-ai/dsh'`. No setting, environment variable, or diagnostic named what was missing, so every project outside the repository failed with a module resolution error.

The Node executable beside it already had a pre-flight with two levers (`DSH_NODE_BIN`, `dsh.nodeBin`) and a five-element diagnostic. The runtime the IDE actually launches had none.

## Decision

`apps/vscode-dsh/src/dsh-entry-guard.ts` resolves the dsh CLI entry point per window — at activation and again at every start — in this order: the `dshBin` start option, `DSH_BIN`, the `dsh.cliPath` setting, the workspace's own `node_modules/@deepseek-ai/dsh`, a dsh checkout above the workspace, the `dsh` executable on `PATH`, and finally the extension's own installation. The automatic sources run from the most specific to the least, and the last one is where a self-contained VSIX would be found without changing anything else.

A configured path that does not exist fails the resolution instead of falling through to an automatic source, because a silently ignored `DSH_BIN` is the misconfiguration the diagnostic exists to surface. Every failure names the source, the entry it inspected or the sources it probed, the actual state, the expectation, and a remedy that names both levers.

A `PATH` install resolves to the entry point through the link a global install writes or the npm/pnpm layout beside the shim, so a `dsh` the user already runs in a terminal works without configuration. The entry is then launched with the Node the pre-flight validated, not with the one that shim would pick, so the Node requirement stays checked.

Activation writes one line to the `DeepSeek Harness` output channel: the entry, the source that provided it, and the version its package declares, beside the extension's own version and without blocking on a mismatch. A window where no source provides a runtime reports the full diagnostic at load time and offers the settings page and the channel; a start in such a window fails as the new `dsh-entry` class before any bridge socket is opened.

## Alternatives considered

**Keep the checkout walk-up and document the setup.** The extension already worked inside the repository. Rejected: it makes the extension usable only where its own source lives, and that is the defect being fixed.

**Launch the `dsh` shim found on `PATH` as the command.** That skips resolving a package layout at all. Rejected: the shim picks its own Node from `PATH`, so the Node pre-flight could no longer stand between a bad Node and the runtime.

**Block a start whose runtime version differs from the extension's.** The SDK client's own install path enforces version equality. Rejected: rebuilding dsh and the extension at different times is normal while both are developed together, so the mismatch is reported in the load-time line and left unblocked.

**Bundle the runtime into the VSIX.** No environment dependency at all, and the resolution chain becomes unnecessary. Rejected: the runtime is a package tree with platform-specific parts and its own release cadence, so shipping it would move packaging, upgrades, and the platform matrix into the extension.

## Consequences

The runtime is now a configuration surface of the extension: `dsh.cliPath` (machine-overridable) and `DSH_BIN` name it, and the automatic sources cover a project dependency, a checkout, and the user's `PATH` install.

`HostFailureKind` gained `dsh-entry`, `StartErrorKind` gained the matching member, and `HOST_DIAGNOSTIC_SCHEMA_VERSION` moved to 3; the record field set is unchanged, with the entry path in `detail` and the remedy in `hint`. A `dsh-entry` failure also offers the settings deep link, which until now only missing credentials did.

Every start now needs a resolvable entry point, so a window that loses its runtime between starts reports `dsh-entry` rather than a child exit.

## Testing

`CAP-SESSION-HOST-153`–`162` cover the resolution order, the `PATH` shapes, the fail-loud rule for a configured path, the probed-source report, relative paths, and a version-less entry; `CAP-SESSION-HOST-163` covers the `dsh-entry` start failure, its record, and that no socket is opened; `CAP-SESSION-HOST-164` and `CAP-SESSION-HOST-165` cover the load-time line and the load-time failure with its actions.
