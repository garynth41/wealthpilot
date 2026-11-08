import { describe, it, expect } from 'vitest'
import { LS, APP_NAME } from './config'

describe('app name and storage keys (0.25.2 rename)', () => {
  it('shows the new name', () => { expect(APP_NAME).toBe('Cresari') })
  it('keeps the stored-data prefix, so saved settings and demo data survive the rename', () => {
    expect(LS('demo')).toBe('wealthpilot.demo')
    expect(LS('household')).toBe('wealthpilot.household')
  })
})
