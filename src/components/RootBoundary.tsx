// Last line of defence (0.19.0): a render error anywhere in the app shows this page instead of a blank screen, and is reported to app_errors.
// 0.25.1: it no longer promises that nothing was written — a page can fail because of something that was saved (an empty date once did
// exactly that) — so it says what to try, the raw error text goes to the error log (the console in the demo) instead of the screen, it only
// says the problem was logged where it really was, and the offline demo, whose data
// lives in this browser, can be reset from here (after a confirmation) when the same failure comes back on every reload.
import { Component, type ReactNode } from 'react'
import { captureError } from '../lib/errors'
import { isChunkError, reloadForNewVersion } from '../lib/chunks'
import { LS } from '../app/config'

const inDemo = () => { try { return localStorage.getItem(LS('mode')) === 'demo' } catch { return false } }
export class RootBoundary extends Component<{ children: ReactNode }, { err: string | null; askReset: boolean }> {
  state = { err: null as string | null, askReset: false }
  static getDerivedStateFromError(e: unknown) { return { err: e instanceof Error ? e.message : String(e) } }
  componentDidCatch(e: unknown, info: { componentStack?: string }) { if (isChunkError(e)) { reloadForNewVersion(); return } captureError(e, { kind: 'boundary', componentStack: (info.componentStack || '').slice(0, 2000) }) }
  render() {
    if (!this.state.err) return this.props.children
    if (isChunkError(this.state.err)) return <div className="auth"><div className="box"><h2 style={{ marginTop: 0 }}>Cresari was updated</h2>
      <div className="note" style={{ marginTop: 0 }}>A new version was published while this tab was open, so this page needs a fresh copy. Loading it now — your data is safe.</div>
      <div className="btnrow" style={{ marginTop: 12 }}><button type="button" className="btn primary" onClick={() => location.reload()}>Load the new version</button></div></div></div>
    const demo = inDemo()
    const home = () => { location.hash = '#/'; location.reload() }
    const reset = () => { try { localStorage.removeItem(LS('demo')); localStorage.removeItem(LS('locked')) } catch { /* private mode: the reload starts fresh anyway */ } home() }
    return <div className="auth"><div className="box" role="alert" aria-labelledby="crash-h">
      <h2 id="crash-h" style={{ marginTop: 0 }}>Something went wrong</h2>
      <p className="note" style={{ marginTop: 0 }}>This page could not be shown.{demo ? '' : ' The problem was added to the error log (Settings → Security → Errors).'}</p>
      <p className="note">Reload to try again, or open the Dashboard. {demo
        ? 'If it happens again every time, something saved in the demo may be what the page cannot show — resetting the demo starts again from fresh sample data.'
        : 'If it happens again every time, something that was saved may be what the page cannot show: open the Dashboard, check the last change you made, and if it still fails, contact support. Nothing else in your household is changed by this screen.'}</p>
      {this.state.askReset ? <div className="msg warn" role="group" aria-label="Reset the demo?"><b>Reset the demo?</b> Every change you made in the demo is replaced by fresh sample data. This cannot be undone.
        <div className="btnrow" style={{ marginTop: 10 }}><button type="button" className="btn danger" onClick={reset}>Yes, reset the demo</button><button type="button" className="btn" onClick={() => this.setState({ askReset: false })}>Keep my changes</button></div></div>
        : <div className="btnrow" style={{ marginTop: 12 }}><button type="button" className="btn primary" onClick={() => location.reload()}>Reload</button><button type="button" className="btn" onClick={home}>Go to the Dashboard</button>{demo && <button type="button" className="btn" onClick={() => this.setState({ askReset: true })}>Reset the demo</button>}</div>}
    </div></div>
  }
}
