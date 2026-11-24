// 0.39.1 — one press, one piece of work. On Nov 22 two presses on Save a second apart recorded one bill payment twice: two
// transactions, and the amount taken off the balance twice. A button is now locked from the press that starts the work until it ends.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Btn } from './ui'
import { useStore } from '../app/store'

afterEach(() => { cleanup(); useStore.setState({ busy: 0 }) })
const gate = () => { let open = () => {}; const p = new Promise<void>(r => { open = r }); return { p, open } }

describe('a button cannot be pressed twice for one piece of work', () => {
  it('a handler that returns a promise runs once until it settles, then can run again', async () => {
    const g = gate(); let n = 0
    render(<Btn onClick={() => { n++; return g.p }}>Save</Btn>); const b = screen.getByText('Save')
    fireEvent.click(b); fireEvent.click(b); fireEvent.click(b)
    expect(n).toBe(1); await waitFor(() => expect(b.getAttribute('aria-disabled')).toBe('true'))
    g.open(); await waitFor(() => expect(b.getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(b); expect(n).toBe(2)
  })
  it('a handler that starts guarded work without returning it is locked for as long as the store is busy with it', async () => {
    const g = gate(); let n = 0
    render(<Btn onClick={() => { n++; void useStore.getState().guarded(() => g.p) }}>Save</Btn>); const b = screen.getByText('Save')
    fireEvent.click(b); fireEvent.click(b)
    expect(n).toBe(1); expect(useStore.getState().busy).toBe(1)
    g.open(); await waitFor(() => expect(useStore.getState().busy).toBe(0)); await waitFor(() => expect(b.getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(b); expect(n).toBe(2)
  })
  it('a press that starts no work locks nothing', () => {
    let n = 0; render(<Btn onClick={() => { n++ }}>Open</Btn>); const b = screen.getByText('Open')
    fireEvent.click(b); fireEvent.click(b); expect(n).toBe(2); expect(b.getAttribute('aria-disabled')).toBeNull()
  })
  it('work that fails frees the button too', async () => {
    let n = 0; render(<Btn onClick={() => { n++; return Promise.reject(new Error('no')) }}>Save</Btn>); const b = screen.getByText('Save')
    fireEvent.click(b); await waitFor(() => expect(b.getAttribute('aria-disabled')).toBeNull()); fireEvent.click(b); expect(n).toBe(2)
  })
})
