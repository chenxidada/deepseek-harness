# Repository Exploration Report — phase-6-session-search

## 1. Task Context

Phase 6 delivers **session search tier 1 + tier 2** (AC-50–53 / AD-CUX-9 / X7 / constitution §7.3): tier 1 queries over existing ExtensionIndex `title` + `firstUserPreview` (fields READY); tier 2 a new **path→session** reverse index derived from Change metadata (not a second body store); opening hits must reuse `openFromHistory` / activate existing Tab and **must not** auto-Start; tier 3 / silent JSONL body scan is explicitly out. Phase Entry: no inherited 🔴 debt; last Phase of `vscode-dsh-chat-ux`.

## 2. Repository Overview

| Item | Reality |
|------|---------|
| Package | `apps/vscode-dsh` — VS Code extension (TypeScript / vitest) |
| Index | `ExtensionIndex` → workspaceState key `dsh.conversationIndex` (metadata only) |
| Changes | `src/change/*` — per-session `ChangeStore` + durable `change-index.ts` (`…/<sessionId>/index.json`) |
| History UI | TreeView `dsh.history` + command `dsh.openHistory` |
| Search module | **Absent** — `apps/vscode-dsh/src/search/` does not exist |
| code2prompt | Not installed in this environment; exploration used targeted Grep/Read |

High-level layout (relevant only):

```
apps/vscode-dsh/src/
  extension-index.ts          # SessionIndexEntry title / firstUserPreview
  history-view.ts             # list + TreeView → openHistory
  conversation-controller.ts  # openFromHistory / upsertSession / change persist
  extension.ts                # commands incl. dsh.openHistory
  change/{change-store,change-index,types}.ts
  chat-panel/protocol.ts      # no action/search-sessions yet
  search/                     # ❌ MISSING (design target)
```

## 3. Most Relevant Areas

| Path | Role | Source |
|------|------|:------:|
| `apps/vscode-dsh/src/extension-index.ts` | `SessionIndexEntry`, `upsertSession`, `listHistorySessions`, eligibility | 👁 |
| `apps/vscode-dsh/src/conversation-controller.ts` | Writes title/preview on prompt; `openFromHistory`; `persistChangeIndex` / `deleteSession` | 👁 |
| `apps/vscode-dsh/src/history-view.ts` | History TreeView → `dsh.openHistory` | 👁 |
| `apps/vscode-dsh/src/extension.ts` | `dsh.openHistory` QuickPick + open path; auto-start matrix | 👁 |
| `apps/vscode-dsh/src/change/change-store.ts` | Session-scoped records; `listByPath(sessionId, path)` only | 👁 |
| `apps/vscode-dsh/src/change/change-index.ts` | Per-session durable Change metadata | 👁 |
| `apps/vscode-dsh/src/change/types.ts` | `ChangeRecord.path` + `sessionId` | 👁 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | Webview actions — **no** `action/search-sessions` | 👁 |
| `apps/vscode-dsh/package.json` | Contributed commands — **no** search command | 👁 |
| `apps/vscode-dsh/README.md` | Auto-start matrix: Query/browse ≠ Start | 👁 |
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` | AC-1c: openHistory offline does not Start | 👁 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | History list / openHistory / cold index | 👁 |
| `.specdev/.../design.md` AD-CUX-9 | Target `path-session-index.ts` + `action/search-sessions` | 👁 |
| `.specdev/.../exploration-findings.md` X7 | Tier1 READY / Tier2 NEED_INDEX | 👁 |

## 4. Key Entry Points / Call Paths

### Path A — Tier 1 index fields (READY; query API missing)

```
User first prompt
  → ConversationController.promptTab()
  → titleFromFirstMessage(text) / preview(80)
  → ExtensionIndex.upsertSession({ title, firstUserPreview, mtime, … })
  → workspaceState persist (no message bodies)

List / browse today:
  → ExtensionIndex.listHistorySessions()
  → history-view / dsh.openHistory QuickPick (label=title)
  ✗ No searchSessions(query) filtering title|firstUserPreview
```

### Path B — Change metadata (tier 2 source; reverse index missing)

```
Attribution / review / revert
  → ChangeStore.upsert(record)   # keyed by sessionId
  → ConversationController.persistChangeIndex(sessionId)
  → writeChangeIndex(storageRoot, sessionId, records)
      → …/snapshots/<sessionId>/index.json

Query today:
  → ChangeStore.listByPath(sessionId, path)  # WITHIN one session only
  ✗ No workspace path → sessionIds reverse map
  ✗ apps/vscode-dsh/src/search/path-session-index.ts MISSING
```

### Path C — Open from result (reuse for AC-52; no auto Start)

```
dsh.openHistory(sessionId?) | History TreeItem.command
  → ConversationController.openFromHistory(sessionId)
       ├─ existing Tab by sessionId → switchConversation (activate)
       └─ else hydrate authority log → registry.create(..., 'replay')
  → Does NOT call IdeSessionHost.start / auto-start orchestrator
  (README Query/browse class; test AC-1c confirms offline openHistory ≠ Start)
```

## 5. Likely Impact Surface

| Area | Change expected | Risk |
|------|-----------------|:----:|
| **New** `src/search/path-session-index.ts` (+ persist) | Tier 2 PathSessionIndexEntry { path, sessionIds, mtime } | 🟠 High — new durable surface |
| **New** tier-1 query helper (filter `listHistorySessions` / sessions by title\|preview) | AC-50; must not read JSONL / MessageStore bodies | 🟡 Med |
| Wire index updates on `persistChangeIndex` + `deleteSession` / `markDeleted` | Keep path→session in sync | 🟠 High |
| `extension.ts` + `package.json` | e.g. `dsh.searchSessions` or QuickPick entry; keep Query/browse (no Start) | 🟡 Med |
| Optional `action/search-sessions` in `protocol.ts` + Host handler | design.md W→H; may be command-palette-only | 🟡 Med |
| `history-view` / chat chrome | Search UI vs extend History — product choice | 🟢 Low–Med |
| Layer B tests | AC-50 spy no body scan; AC-51 path hits; AC-52 no Start; AC-53 no tier-3 API | 🟡 Med |
| `message-store` / `replay-hydrator` / agent-loop | **Must not** become search backends | 🔴 Avoid |

## 6. Existing Constraints / Conventions

1. **ExtensionIndex never stores message bodies** (`extension-index.ts` header + AC-45/46) — tier 1 must query metadata fields only.
2. **Change index is metadata-only** (`change-index.ts`); blobs in SnapshotStore — do not index snapshot plaintext as “search”.
3. **ChangeStore is session-scoped** — `listByPath(sessionId, path)` is not a workspace reverse index (X7 NEED_INDEX).
4. **openFromHistory** activates or opens **replay**; Continue/retry/edit/fork are separate explicit user actions (AC-52).
5. **Auto-start matrix** (README): Query/browse commands must not Start; `dsh.openHistory` already classified correctly — new search open must stay in this class.
6. **Constitution §7.3**: no tier 3 / second body library; no silent JSONL body scan.
7. **AD-CUX-9**: open via history/replay/existing Tab, not Start.
8. **Fork change buckets**: design says fork does not copy parent Change index — path-session maintenance must not invent parent paths on child.
9. **Duck-typed vscode** + L2 hooks under `VSCODE_DSH_TEST` — follow existing command/test patterns.
10. **Orchestrator role**: implementer owns product code; do not touch agent-loop.

## 7. Risks / Unknowns

| Item | Confidence | Notes |
|------|:----------:|-------|
| Tier 1 fields `title` / `firstUserPreview` exist and are written on first prompt | ✅ CONFIRMED | Read `SessionIndexEntry` + `promptTab` upsert |
| `listHistorySessions` returns those fields but has no substring search API | ✅ CONFIRMED | Full method body read |
| Workspace path→session reverse index does not exist | ✅ CONFIRMED | No `src/search/`; ChangeStore is per-session |
| Per-session change `index.json` is the durable source to derive tier 2 | ✅ CONFIRMED | `writeChangeIndex` / `readChangeIndex` |
| `openFromHistory` activates existing Tab or opens replay; no Start in that path | ✅ CONFIRMED | Method body + AC-1c test + README matrix |
| `action/search-sessions` not in protocol yet | ✅ CONFIRMED | `protocol.ts` action union |
| Whether search UI is Webview vs Command Palette only | ⚠️ HYPOTHESIS | design allows either; spec says「搜索 UI 或命令面板」 |
| Persist location for path-session index (workspaceState vs extension storage file) | ⚠️ HYPOTHESIS | design shows type; not storage path |
| Cold rebuild: scan all session `index.json` once vs incremental-only | ⚠️ HYPOTHESIS | X7 said「新建或扫全 index」; prefer durable reverse index |
| Path normalization rules (relative, case, symlinks) for queries | ❓ UNKNOWN | Must align with ChangeRecord.path writers |
| Whether deleted/tombstoned sessions must drop from path index immediately | ⚠️ HYPOTHESIS | Spec: update on delete; `markDeleted` exists |

## 8. Uncertain / Unverified

| Symbol | Status | Guidance for downstream |
|--------|--------|-------------------------|
| Future `searchSessions` / `queryByPath` | Not present | Do not assume; implement in this Phase |
| `PathSessionIndexEntry` | Design-only type in `design.md` | Not compiled code |
| Full-workspace rebuild by walking every `changeIndexPath` | Not implemented | If used for migration, keep it **metadata** only — never open JSONL authority logs for “search” |
| Webview search chrome DOM | Absent | Layer A only if UI lands in extracted render modules |
| `ChangeStore.listByPath` cross-session | N/A — API is session-scoped | Do not misuse as AC-51 |

## 9. Stub Detection & Registry Cross-Validation

**Registry**: `.specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md` — **活跃债务 empty** (only `—` placeholder). Phase Entry: no 🔴 inheritance.

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — (active empty) | — | 无活跃项 | N/A | ✅ 匹配 |
| GAP-CUX-002 | (resolved) | 已解决 @ phase-5 | Not re-audited as stub | ✅ 已关闭 |
| DEBT-CUX-001 | (resolved) | 已解决 @ phase-4 | Not in scope | ✅ 已关闭 |
| GAP-CUX-001 | (resolved) | 已解决 @ phase-3 | Not in scope | ✅ 已关闭 |

### Product gaps (not registry stubs — missing modules)

| Gap | Evidence | AC |
|-----|----------|:--:|
| No tier-1 query API | Only `listHistorySessions` / QuickPick browse | AC-50 |
| No `path-session-index` module | `src/search/` missing; design path absent | AC-51 |
| No search command / `action/search-sessions` | `package.json` + `protocol.ts` | AC-50/51 UI |
| No tier-3 API (good) | No full-text / JSONL scan search surface | AC-53 ✅ |

### Stub Detection Summary

- ✅ Confirmed stubs: **0**（匹配 registry；活跃表空）
- ⚠️ Registry mismatch: **0**
- 🔴 Unregistered stubs: **0**（缺模块记为 **GAP**，非空壳函数桩）
- 📌 Implementer should register new intentional `@STUB`s if any deferral; otherwise deliver query + path index + open wiring fully.

**Negative check (AC-53):** Grep found no session-search full-text / JSONL body-scan product path. `message-store` documents projection-only (not a second authority DB). Do not add body-scan “search” to pass AC-50.

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `apps/vscode-dsh/src/extension-index.ts` (SessionIndexEntry + listHistorySessions)
2. ⭐ **MUST READ** — `apps/vscode-dsh/src/conversation-controller.ts` (`openFromHistory`, `promptTab` upsert, `persistChangeIndex`, `deleteSession`)
3. ⭐ **MUST READ** — `apps/vscode-dsh/src/change/change-index.ts` + `change-store.ts` + `types.ts` (`ChangeRecord.path`)
4. ⭐ **MUST READ** — Phase `spec.md` AC-50–53 + `design.md` AD-CUX-9 + PathSessionIndexEntry + file plan `src/search/path-session-index.ts`
5. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/extension.ts` (`dsh.openHistory`) + `history-view.ts` + README auto-start matrix
6. 🔷 **SHOULD READ** — `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` (AC-1c) + `phase2-multitab-history-replay.spec.ts`
7. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/chat-panel/protocol.ts` (add `action/search-sessions` only if Webview entry chosen)
8. 🔹 **OPTIONAL** — `exploration-findings.md` X7; constitution §7.3; prior phase-5 review note that search was correctly out of scope

---

### Key gaps (implementer checklist)

| # | Gap | Current | Needed |
|---|-----|---------|--------|
| G1 | Tier 1 query | Fields READY; list/browse only | Filter/search on `title` + `firstUserPreview`; layer B proves index-field hits |
| G2 | Tier 2 reverse index | Per-session change index only | `path-session-index` module + persist; maintain on change write/delete |
| G3 | Search entry | No command / no `action/search-sessions` | UI or Command Palette entry |
| G4 | Open path | `openFromHistory` ready | Wire results → openHistory/activate; assert no auto Start |
| G5 | Tier 3 | Absent (correct) | Keep absent; no JSONL body scan |

*Exploration date: 2026-09-11. Mode: per-Phase (phase-6-session-search). No prior repo-exploration.md in this phase folder (first write).*
