// "Install the app" (0.29.0): the steps for the phone or computer in use, and the browser's own Install button where it offers one.
// On the public Try page and on Start here. Inside the iPhone and Android apps there is nothing to install.
import { useEffect, useState } from 'react'
import { isNative } from '../app/native'
import { canPromptInstall, howToInstall, isInstalled, onInstallChange, promptInstall } from '../lib/install'
import { Btn } from './ui'

export function InstallSteps() {
  const [, bump] = useState(0); useEffect(() => onInstallChange(() => bump(n => n + 1)), [])
  const [msg, setMsg] = useState<string | null>(null)
  if (isNative()) return <p className="note" style={{ margin: 0 }}>You are using the Cresari app — nothing to install.</p>
  if (isInstalled()) return <p style={{ margin: 0 }}><span className="pill good">Installed</span> You opened Cresari from its own icon — it is installed on this device.</p>
  const how = howToInstall(navigator.userAgent, navigator.maxTouchPoints || 0)
  return <div className="install">
    <p style={{ marginTop: 0 }}>Cresari is not in the App Store or Google Play yet — add it from your browser instead. It then opens from its own icon, in its own window, like any other app, and keeps working without a connection.</p>
    {canPromptInstall() && <p><Btn primary onClick={() => void promptInstall().then(ok => setMsg(ok ? 'Installed — open Cresari from its new icon.' : 'Not installed — you can do it any time.'))}>Install app</Btn> <span className="note">one click — this browser offers it</span></p>}
    <div className="note" style={{ margin: '0 0 6px' }}>{canPromptInstall() ? 'Or by hand, on' : 'On'} this {how.device}:</div>
    <ol>{how.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
    {how.note && <p className="note">{how.note}</p>}
    {msg && <div className="msg good" role="status">{msg}</div>}
  </div>
}
