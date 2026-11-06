// Stale-tab recovery (0.20.1). Every page is its own file with a content hash in its name (Insights-CilgOzys.js); a deploy publishes
// new names. A tab opened before the deploy still knows the old names, so the first time it opens a page it had not loaded yet the
// file is missing ("Failed to fetch dynamically imported module"). Two defences: the deploy keeps earlier files (gh-pages --add), and
// the app reloads itself once to pick up the new version — at most once every 30 seconds, so a real outage can never loop.
const PATTERNS = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Outdated Optimize Dep/i
export const isChunkError = (e: unknown): boolean => PATTERNS.test(e instanceof Error ? `${e.name} ${e.message}` : String(e ?? ''))
export const RELOAD_KEY = 'wealthpilot.chunkReload'
export const RELOAD_WINDOW_MS = 30000
type Store = Pick<Storage, 'getItem' | 'setItem'>
/** Reload to load the new release. Returns false (and does nothing) when this tab already reloaded for this reason in the last 30 s. */
export function reloadForNewVersion(now = Date.now(), store: Store | null = safeSession(), reload: () => void = () => location.reload()): boolean {
  let last = 0; try { last = +(store?.getItem(RELOAD_KEY) || 0) || 0 } catch { /* storage blocked */ }
  if (now - last < RELOAD_WINDOW_MS) return false
  try { store?.setItem(RELOAD_KEY, String(now)) } catch { /* storage blocked: still reload once */ }
  reload(); return true
}
function safeSession(): Store | null { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null } catch { return null } }
/** Wrap a dynamic import: a missing file after a deploy triggers one reload instead of an error page. */
export function retryingImport<T>(load: () => Promise<T>): () => Promise<T> {
  return () => load().catch((e: unknown) => { if (isChunkError(e) && reloadForNewVersion()) return new Promise<T>(() => { /* the page is reloading */ }); throw e })
}
