// Last line of defence (0.19.0): a render error anywhere in the app shows this page instead of a blank screen, and is reported to app_errors.
import { Component, type ReactNode } from 'react'
import { captureError } from '../lib/errors'
import { isChunkError, reloadForNewVersion } from '../lib/chunks'
export class RootBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: unknown) { return { err: e instanceof Error ? e.message : String(e) } }
  componentDidCatch(e: unknown, info: { componentStack?: string }) { if (isChunkError(e)) { reloadForNewVersion(); return } captureError(e, { kind: 'boundary', componentStack: (info.componentStack || '').slice(0, 2000) }) }
  render() {
    if (!this.state.err) return this.props.children
    if (isChunkError(this.state.err)) return <div className="auth"><div className="box"><h2 style={{ marginTop: 0 }}>WealthPilot was updated</h2>
      <div className="note" style={{ marginTop: 0 }}>A new version was published while this tab was open, so this page needs a fresh copy. Loading it now — your data is safe.</div>
      <div className="btnrow" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => location.reload()}>Load the new version</button></div></div></div>
    return <div className="auth"><div className="box"><h2 style={{ marginTop: 0 }}>Something went wrong</h2><div className="msg crit">{this.state.err}</div>
      <div className="note">The error has been recorded (Settings → Security → Errors). Reloading usually clears it; your data is safe — nothing is written when a page fails to draw.</div>
      <div className="btnrow" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => location.reload()}>Reload</button><button className="btn" onClick={() => { location.hash = '#/'; location.reload() }}>Go to the Dashboard</button></div></div></div>
  }
}
