import { describe, expect, it } from 'vitest'
import { installFrozenEdge, setFrozenLefts } from './frozenCol'

const table = (widths: number[], extra = 0) => {
  const t = document.createElement('table'); const head = t.createTHead().insertRow()
  widths.forEach(w => { const th = document.createElement('th'); th.className = 'fz'; Object.defineProperty(th, 'offsetWidth', { value: w }); head.appendChild(th) })
  for (let i = 0; i < extra; i++) head.appendChild(document.createElement('th'))
  return t
}

describe('frozen first column', () => {
  it('places each frozen cell after the frozen cells before it', () => {
    const t = table([34, 36, 180], 4)
    expect(setFrozenLefts(t)).toEqual([0, 34, 70])
    expect(t.style.getPropertyValue('--fz1')).toBe('34px')
    expect(t.style.getPropertyValue('--fz2')).toBe('70px')
  })
  it('without a tick box the row number is first and the first column follows it', () => {
    expect(setFrozenLefts(table([36, 150]))).toEqual([0, 36])
  })
  it('marks a table area scrolled sideways, and unmarks it back at the start', () => {
    const stop = installFrozenEdge(document)
    const w = document.createElement('div'); w.className = 'tblwrap'; document.body.appendChild(w)
    w.scrollLeft = 0; Object.defineProperty(w, 'scrollLeft', { value: 120, configurable: true }); w.dispatchEvent(new Event('scroll'))
    expect(w.classList.contains('sx')).toBe(true)
    Object.defineProperty(w, 'scrollLeft', { value: 0, configurable: true }); w.dispatchEvent(new Event('scroll'))
    expect(w.classList.contains('sx')).toBe(false)
    const other = document.createElement('div'); document.body.appendChild(other); Object.defineProperty(other, 'scrollLeft', { value: 50 }); other.dispatchEvent(new Event('scroll'))
    expect(other.classList.contains('sx')).toBe(false)
    stop(); w.remove(); other.remove()
  })
})
