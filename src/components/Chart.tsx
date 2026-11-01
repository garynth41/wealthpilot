// Plotly wrapper with the readable-chart rules from CareerShift v1.26: bigger type, wrapped labels, legends above, dynamic height, ⤢ full-size view.
import { useEffect, useRef, type ReactNode } from 'react'
import Plotly from 'plotly.js-basic-dist-min'
import { MHead, MBody, useModal } from './ui'

type Data = Partial<Plotly.PlotData>[]; type Layout = Partial<Plotly.Layout>
export const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
export const C = () => ({ accent: cssVar('--accent'), blue: cssVar('--blue'), good: cssVar('--good'), warn: cssVar('--warn'), crit: cssVar('--crit'), soon: cssVar('--soon'), idle: cssVar('--idle'), wait: cssVar('--wait'), line: cssVar('--line'), ink2: cssVar('--ink-2'), ink3: cssVar('--ink-3'), accentSoft: cssVar('--accent-soft'), critSoft: cssVar('--crit-soft'), blueSoft: cssVar('--blue-soft') })
export const PALETTE = () => { const c = C(); return [c.blue, c.good, c.warn, c.soon, c.wait, c.crit, cssVar('--accent-deep'), c.idle] }
const isMobile = () => window.matchMedia('(max-width:900px)').matches
const wrap = (s: string, n: number) => { const words = String(s).split(/\s+/); const lines: string[] = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > n && cur) { lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim() } if (cur) lines.push(cur); return lines.slice(0, 3).join('<br>') }
export function base(): Layout { const c = C(); return { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'IBM Plex Sans, system-ui, sans-serif', size: isMobile() ? 12.5 : 13.5, color: c.ink2 }, margin: { l: 48, r: 18, t: 10, b: 40 }, xaxis: { gridcolor: c.line, zeroline: false, automargin: true, tickfont: { size: isMobile() ? 12 : 13, color: c.ink2 } }, yaxis: { gridcolor: c.line, zeroline: false, automargin: true, tickfont: { size: isMobile() ? 12 : 13, color: c.ink2 } }, hoverlabel: { font: { size: 13.5 } }, legend: { orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom', font: { size: isMobile() ? 12 : 13 } } } }
function readable(el: HTMLElement, data: Data, layout: Layout, big: boolean): { data: Data; layout: Layout } {
  const W = Math.max(260, el.clientWidth || 600); const L: Layout = { ...base(), ...layout, xaxis: { ...base().xaxis, ...(layout.xaxis || {}) }, yaxis: { ...base().yaxis, ...(layout.yaxis || {}) } }
  if (big) { L.font = { ...L.font, size: 15 }; (L.xaxis as Record<string, unknown>).tickfont = { size: 14.5 }; (L.yaxis as Record<string, unknown>).tickfont = { size: 14.5 }; L.legend = { ...L.legend, font: { size: 14.5 } } }
  let d = data.map(t => ({ ...t }))
  const money = (ax: Record<string, unknown>, vals: number[]) => { if (ax.tickprefix === '$' && !ax.tickformat) { const m = Math.max(0, ...vals.map(Math.abs)); ax.tickformat = m >= 10000 ? '$~s' : '$,.0f'; delete ax.tickprefix } }
  money(L.yaxis as Record<string, unknown>, d.flatMap(t => (t.orientation === 'h' ? [] : (t.y as number[]) || []).filter(v => typeof v === 'number'))); money(L.xaxis as Record<string, unknown>, d.flatMap(t => (t.orientation === 'h' ? (t.x as number[]) || [] : []).filter(v => typeof v === 'number')))
  const hb = d.filter(t => t.type === 'bar' && t.orientation === 'h' && Array.isArray(t.y))
  if (hb.length) { const ys = [...new Set(hb.flatMap(t => t.y as string[]))]; if (ys.every(v => typeof v === 'string')) { const n = big ? 40 : W < 520 ? 18 : 28; let lines = 1; d = d.map(t => t.type === 'bar' && t.orientation === 'h' ? { ...t, y: (t.y as string[]).map(v => { const w = wrap(v, n); lines = Math.max(lines, w.split('<br>').length); return w }), customdata: t.customdata || (t.y as string[]) } : t); const row = (big ? 30 : 24) + (lines - 1) * 14; L.height = Math.max((L.height as number) || 0, 70 + ys.length * row + (L.showlegend ? 30 : 0), big ? 0 : 220) } }
  const vx = d.filter(t => ((t.type === 'bar' && t.orientation !== 'h') || t.type === 'scatter') && Array.isArray(t.x))
  if (vx.length) { const xs = [...new Set(vx.flatMap(t => t.x as unknown[]))]; const cat = xs.length && xs.every(v => typeof v === 'string' && !/^\d{4}-\d{2}/.test(v as string)) && (L.xaxis as Record<string, unknown>).type !== 'date'
    if (cat) { const per = (W - 90) / Math.max(1, xs.length), chars = Math.max(6, Math.floor(per / 7.4)), longest = Math.max(...xs.map(x => String(x).length))
      if (longest > chars) { if (per < 46) { (L.xaxis as Record<string, unknown>).tickangle = -40; L.height = ((L.height as number) || 260) + Math.min(80, longest * 3.2); if (per < 26) { const k = Math.ceil(26 / per), tv = xs.filter((_, i) => (xs.length - 1 - i) % k === 0); (L.xaxis as Record<string, unknown>).tickvals = tv; (L.xaxis as Record<string, unknown>).ticktext = tv.map(String) } } else { let lines = 1; const n = Math.max(8, chars); d = d.map(t => vx.includes(t) ? { ...t, x: (t.x as string[]).map(v => { const w = wrap(v, n); lines = Math.max(lines, w.split('<br>').length); return w }) } : t); L.height = ((L.height as number) || 260) + (lines - 1) * 15 } } } }
  if (L.showlegend) { const names = d.filter(t => t.showlegend !== false && t.name).map(t => String(t.name)); const px = (isMobile() ? 12 : 13) * 0.58; let rows = 1, x = 0; names.forEach(nm => { const w = nm.length * px + 44; if (x + w > W - 30 && x > 0) { rows++; x = 0 } x += w }); if (W < 520 && names.length > 2) { const per = Math.max(...names.map(n => n.length)) > 12 ? 1 : 2; L.legend = { ...L.legend, ...({ entrywidth: 1 / per, entrywidthmode: 'fraction' } as Record<string, unknown>) }; rows = Math.ceil(names.length / per) } L.margin = { ...L.margin, t: Math.max((L.margin?.t as number) || 0, big ? 46 : 34) + (rows - 1) * 21 }; L.height = ((L.height as number) || 260) + (rows - 1) * 21 }
  if ((L.margin?.l as number) > W * 0.4) L.margin = { ...L.margin, l: Math.round(W * 0.4) }
  return { data: d, layout: L }
}
export function Chart({ data, layout = {}, height = 260, title, expand = true, className = '' }: { data: Data; layout?: Layout; height?: number; title?: string; expand?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null); const { open } = useModal()
  useEffect(() => { const el = ref.current; if (!el) return; const draw = () => { const r = readable(el, data, { height, ...layout }, false); el.style.minHeight = (r.layout.height as number) + 'px'; Plotly.react(el, r.data as Plotly.Data[], r.layout, { displayModeBar: false, responsive: true }) }; draw()
    const ro = new ResizeObserver(() => draw()); ro.observe(el); return () => { ro.disconnect(); try { Plotly.purge(el) } catch { /* */ } } }, [data, layout, height])
  const big = () => open(<BigChart data={data} layout={layout} title={title || ''} />, { xwide: true })
  return <div className={className}>{expand && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -26, position: 'relative', zIndex: 2 }}><button className="ch-x" onClick={big} title="Open this chart full size (zoom, hover, download)" aria-label="Open chart full size">⤢</button></div>}<div ref={ref} className="chart" style={{ minHeight: height }} /></div>
}
function BigChart({ data, layout, title }: { data: Data; layout: Layout; title: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = ref.current; if (!el) return; const h = Math.round(Math.min(window.innerHeight * 0.72, 900)); const r = readable(el, data, { ...layout, height: h }, true); r.layout.height = Math.max(h, (r.layout.height as number) || 0); Plotly.newPlot(el, r.data as Plotly.Data[], r.layout, { displayModeBar: true, displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'], toImageButtonOptions: { filename: 'pocketledger-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), scale: 2 } }); return () => { try { Plotly.purge(el) } catch { /* */ } } }, [data, layout, title])
  return <><MHead title={title} /><MBody><div ref={ref} className="chart-big" /><div className="note">Hover for exact values · drag to zoom, double-click to reset · the camera icon saves a picture.</div></MBody></>
}
export function Gauge({ value, max, color, steps, label, note }: { value: number; max: number; color: string; steps: Array<{ range: [number, number]; color: string }>; label: string; note?: ReactNode }) {
  // a semicircular gauge drawn as SVG (no Plotly dependency): coloured bands for the steps, a thick arc for the value, ticks every max/4
  const cx = 150, cy = 150, R = 118, w = 22; const ang = (v: number) => Math.PI - (Math.min(max, Math.max(0, v)) / max) * Math.PI
  const pt = (v: number, r: number) => [cx + r * Math.cos(ang(v)), cy - r * Math.sin(ang(v))]
  const arc = (a: number, b: number, r: number) => { const [x1, y1] = pt(a, r), [x2, y2] = pt(b, r); const big = (b - a) / max > 0.5 ? 1 : 0; return `M ${x1} ${y1} A ${r} ${r} 0 ${big} 1 ${x2} ${y2}` }
  const c = C(); const ticks = [0, max / 4, max / 2, (3 * max) / 4, max]
  return <div style={{ position: 'relative' }}><svg viewBox="0 0 300 170" style={{ width: '100%', maxWidth: 360, display: 'block', margin: '0 auto' }} role="img" aria-label={label}>
    {steps.map((st, i) => <path key={i} d={arc(st.range[0], st.range[1], R)} stroke={st.color} strokeWidth={w} fill="none" />)}
    <path d={arc(0, Math.max(0.001, value), R)} stroke={color} strokeWidth={w * 0.6} fill="none" strokeLinecap="round" />
    {ticks.map(t => { const [x, y] = pt(t, R + w / 2 + 4), [x2, y2] = pt(t, R + w / 2 + 16); return <g key={t}><line x1={x} y1={y} x2={x2} y2={y2} stroke={c.ink3} strokeWidth={1} /><text x={pt(t, R + w / 2 + 28)[0]} y={pt(t, R + w / 2 + 28)[1] + 4} textAnchor="middle" fontSize="12" fill={c.ink2}>{Number.isInteger(t) ? t : t.toFixed(1)}</text></g> })}
    <text x={cx} y={cy - 6} textAnchor="middle" fontSize="30" fontWeight="600" fill={c.ink2} fontFamily="IBM Plex Mono, monospace" style={{ fill: 'var(--ink)' }}>{label}</text>
  </svg>{note}</div>
}
