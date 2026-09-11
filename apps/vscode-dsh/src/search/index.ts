/**
 * Session search package exports (AD-CUX-9).
 * @module @deepseek-ai/dsh-vscode-dsh/search
 */

export {
  PATH_SESSION_INDEX_STATE_KEY,
  PathSessionIndex,
  normalizeSearchPath,
  type PathSessionIndexEntry,
  type PathSessionIndexSnapshot,
} from './path-session-index.ts'
export {
  TIER3_FULL_TEXT_SEARCH_API,
  matchTier1Field,
  searchSessions,
  type SearchHit,
  type SearchMatchTier,
  type SearchQuery,
  type Tier1MatchField,
} from './session-search.ts'
