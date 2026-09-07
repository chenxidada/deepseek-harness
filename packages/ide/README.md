---
description: "The IDE package group: Host bridge plugin connecting the ide profile runtime to a VS Code Extension."
kind: "package-group"
---

# ide/ — IDE Host bridge

English | [中文](README.zh.md)

## Summary

The ide group provides the Host bridge plugin used by `dsh --profile ide`. The matching profile bundle lives in `bundle/ide`; the VS Code Extension host lives in `apps/vscode-dsh`.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`ide-bridge/`](ide-bridge/README.md) | Connects to the Extension socket and registers approval / user-questions terminal answerers |

-----

<a id="related-documentation"></a>
## Related documentation

- [dsh-ide bundle](../bundle/ide/README.md) — the profile patch that mounts this bridge.

<a id="dev-note"></a>
## Dev Note

None.
