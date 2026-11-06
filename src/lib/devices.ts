// Device list labels (0.20.0): a user-agent string → "Chrome on Windows", "Safari on iPhone". Pure; no lookups, nothing sent anywhere.
export function describeDevice(ua: string | null | undefined): { label: string; icon: string; os: string; browser: string } {
  const u = String(ua || '')
  if (!u) return { label: 'Unknown device', icon: '💻', os: '', browser: '' }
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /CrOS/.test(u) ? 'Chromebook' : /Linux/.test(u) ? 'Linux' : ''
  const browser = /Edg\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /Firefox\/|FxiOS/.test(u) ? 'Firefox' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : /supabase|node|deno|curl|python/i.test(u) ? 'app or script' : 'Browser'
  const phone = os === 'iPhone' || (os === 'Android' && /Mobile/.test(u))
  return { label: os ? `${browser} on ${os}` : browser, icon: phone ? '📱' : os === 'iPad' || (os === 'Android' && !phone) ? '📲' : '💻', os, browser }
}
